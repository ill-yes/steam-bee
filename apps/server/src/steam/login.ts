import { randomUUID } from "node:crypto";
import { EAuthTokenPlatformType, LoginSession } from "steam-session";
import { decodeJwtExpiry, encryptSecret } from "../util/crypto.js";
import { db } from "../db/client.js";
import { steamAccount } from "../db/schema.js";
import { recordInfoEventSafely } from "../http/events.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { safeErrorMessage } from "../util/redact.js";
import type { OperationContext } from "../operation-context.js";
import { steamIdToString } from "./steam-id.js";

type LoginState =
  | { status: "pending"; qrUrl?: string; message?: string }
  | {
      status: "authenticated";
      accountId: string;
      accountName: string;
      steamId: string | null;
      connectedAt: number;
      message?: string;
    }
  | { status: "error"; message: string };

type LoginPhase = "pending" | "completing" | "terminal";

type LoginRecord = {
  session: LoginSession;
  state: LoginState;
  phase: LoginPhase;
  createdAt: number;
  terminalAt: number | null;
  cleanedUp: boolean;
  context: OperationContext;
};

const qrLogins = new Map<string, LoginRecord>();
const loginLogger = createLogger("steam-login");
const qrPendingTtlMs = 10 * 60_000;
const qrTerminalTtlMs = 10 * 60_000;
const qrCleanupInterval = setInterval(() => cleanupQrLogins(), 60_000);
qrCleanupInterval.unref();

function cleanupQrLoginSession(loginId: string, record: LoginRecord) {
  if (record.cleanedUp) return;
  record.cleanedUp = true;

  try {
    record.session.cancelLoginAttempt();
  } catch (error) {
    loginLogger.warn(
      errorLogFields(error, { loginId }),
      "Failed to cancel QR Steam login polling",
    );
  } finally {
    record.session.removeAllListeners();
  }
}

function setQrLoginTerminal(
  loginId: string,
  record: LoginRecord,
  state: Exclude<LoginState, { status: "pending" }>,
  now = Date.now(),
) {
  if (record.phase === "terminal") return false;

  record.phase = "terminal";
  record.state = state;
  record.terminalAt ??= now;
  cleanupQrLoginSession(loginId, record);
  return true;
}

function expireQrLogin(loginId: string, record: LoginRecord, now: number) {
  if (record.phase !== "pending" || record.state.status !== "pending") {
    return false;
  }

  const expired = setQrLoginTerminal(
    loginId,
    record,
    { status: "error", message: "Login session expired." },
    now,
  );
  if (expired) loginLogger.warn({ loginId }, "QR login record expired");
  return expired;
}

export class CredentialLoginFlow {
  readonly id = randomUUID();
  private session: LoginSession | null = null;
  private persistPromise: ReturnType<CredentialLoginFlow["persist"]> | null =
    null;
  private readonly context: OperationContext;

  constructor(context: OperationContext = {}) {
    this.context = context;
  }

  async start(accountName: string, password: string, guardCode?: string) {
    loginLogger.info(
      {
        flowId: this.id,
        accountName,
        guardCodeProvided: Boolean(guardCode),
      },
      "Starting credential Steam login",
    );
    this.session = new LoginSession(EAuthTokenPlatformType.SteamClient);
    this.session.on("authenticated", () => {
      void this.persistOnce().catch((error) => {
        loginLogger.error(
          errorLogFields(error, { flowId: this.id, accountName }),
          "Failed to persist credential Steam login",
        );
      });
    });
    this.session.on("timeout", () => {
      loginLogger.warn({ flowId: this.id, accountName }, "Steam login timeout");
    });
    this.session.on("error", (error) => {
      loginLogger.error(
        errorLogFields(error, { flowId: this.id, accountName }),
        "Steam login error",
      );
    });

    const response = (await this.session.startWithCredentials({
      accountName,
      password,
      steamGuardCode: guardCode,
    } as never)) as { actionRequired?: boolean };

    if (response.actionRequired) {
      loginLogger.info(
        { flowId: this.id, accountName },
        "Steam Guard required for credential login",
      );
      return { status: "guard_required" as const };
    }

    if (this.session.refreshToken) {
      return this.persistOnce();
    }

    return { status: "pending" as const };
  }

  private persistOnce() {
    this.persistPromise ??= this.persist();
    return this.persistPromise;
  }

  private async persist() {
    if (!this.session?.refreshToken)
      throw new Error("No refresh token received.");
    const result = await persistAccountToken(
      this.session.accountName ?? "unknown",
      this.session.refreshToken,
      steamIdToString(this.session.steamID),
      this.context,
    );
    await startAccountAfterLogin(result.accountId, {
      ...this.context,
      action: this.context.action ?? "steam-login-credentials",
    });
    loginLogger.info(
      {
        flowId: this.id,
        accountId: result.accountId,
        accountName: result.accountName,
        steamId: result.steamId,
      },
      "Credential Steam login authenticated",
    );
    return {
      status: "authenticated" as const,
      message: "Connection saved. Steam is connecting.",
      ...result,
    };
  }
}

export async function startQrLogin(context: OperationContext = {}) {
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  const loginId = randomUUID();
  loginLogger.info({ loginId }, "Starting QR Steam login");
  const challenge = (await session.startWithQR()) as {
    actionRequired?: boolean;
    qrChallengeUrl?: string;
  };
  if (!challenge.qrChallengeUrl) {
    throw new Error("Steam did not provide a QR login URL.");
  }

  const record: LoginRecord = {
    session,
    state: {
      status: "pending",
      qrUrl: challenge.qrChallengeUrl,
      message: "QR-Code mit der Steam Mobile App scannen.",
    },
    phase: "pending",
    createdAt: Date.now(),
    terminalAt: null,
    cleanedUp: false,
    context,
  };

  qrLogins.set(loginId, record);

  session.on("authenticated", () => {
    const now = Date.now();
    if (record.phase !== "pending" || record.state.status !== "pending") return;
    if (now - record.createdAt >= qrPendingTtlMs) {
      expireQrLogin(loginId, record, now);
      return;
    }

    record.phase = "completing";
    cleanupQrLoginSession(loginId, record);
    void (async () => {
      if (!session.refreshToken) {
        loginLogger.warn(
          { loginId },
          "QR Steam login authenticated without token",
        );
        setQrLoginTerminal(loginId, record, {
          status: "error",
          message: "No refresh token received.",
        });
        return;
      }

      const result = await persistAccountToken(
        session.accountName ?? "unknown",
        session.refreshToken,
        steamIdToString(session.steamID),
        record.context,
      );
      await startAccountAfterLogin(result.accountId, {
        ...record.context,
        action: record.context.action ?? "steam-login-qr",
      });
      loginLogger.info(
        {
          loginId,
          accountId: result.accountId,
          accountName: result.accountName,
          steamId: result.steamId,
        },
        "QR Steam login authenticated",
      );
      setQrLoginTerminal(loginId, record, {
        status: "authenticated",
        message: "Connection saved. Steam is connecting.",
        ...result,
      });
    })().catch((error) => {
      loginLogger.error(
        errorLogFields(error, { loginId }),
        "Failed to persist QR Steam login",
      );
      setQrLoginTerminal(loginId, record, {
        status: "error",
        message: safeErrorMessage(error),
      });
    });
  });

  session.on("timeout", () => {
    if (record.phase !== "pending" || record.state.status !== "pending") return;
    loginLogger.warn({ loginId }, "QR Steam login timeout");
    setQrLoginTerminal(loginId, record, {
      status: "error",
      message: "QR login timed out.",
    });
  });

  session.on("error", (error) => {
    if (record.phase !== "pending" || record.state.status !== "pending") return;
    loginLogger.error(
      errorLogFields(error, { loginId }),
      "QR Steam login error",
    );
    setQrLoginTerminal(loginId, record, {
      status: "error",
      message: safeErrorMessage(error),
    });
  });

  return {
    loginId,
    qrUrl: challenge.qrChallengeUrl,
  };
}

export function getQrLogin(loginId: string): LoginState | null {
  cleanupQrLogins();
  const record = qrLogins.get(loginId);
  if (!record) return null;

  return record.state;
}

export function cleanupQrLogins(now = Date.now()) {
  for (const [loginId, record] of qrLogins) {
    if (
      record.phase === "pending" &&
      record.state.status === "pending" &&
      now - record.createdAt >= qrPendingTtlMs
    ) {
      expireQrLogin(loginId, record, now);
      continue;
    }

    if (
      record.terminalAt !== null &&
      now - record.terminalAt >= qrTerminalTtlMs
    ) {
      qrLogins.delete(loginId);
    }
  }
}

async function persistAccountToken(
  accountName: string,
  refreshToken: string,
  steamId: string | null,
  context: OperationContext = {},
) {
  const now = Date.now();
  const encrypted = encryptSecret(refreshToken);
  const tokenExpiresAt = decodeJwtExpiry(refreshToken);
  const id = randomUUID();
  const tokenUpdate = {
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    tokenKeyVersion: encrypted.keyVersion,
    tokenExpiresAt,
    desiredState: "running",
    updatedAt: now,
    ...(steamId ? { steamId } : {}),
  };

  await db
    .insert(steamAccount)
    .values({
      id,
      accountName,
      steamId,
      status: "disconnected",
      desiredState: "running",
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenKeyVersion: encrypted.keyVersion,
      tokenExpiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: steamAccount.accountName,
      set: tokenUpdate,
    });

  const account = await db.query.steamAccount.findFirst({
    where: (fields, operators) => operators.eq(fields.accountName, accountName),
  });

  await recordInfoEventSafely({
    accountId: account?.id ?? id,
    type: "steam.login",
    message: `Steam account ${accountName} was connected. Steam session is starting.`,
    metadata: {
      ...context,
      accountName,
      steamId: account?.steamId ?? steamId,
      tokenExpiresAt,
    },
  });

  loginLogger.info(
    {
      accountId: account?.id ?? id,
      accountName,
      steamId: account?.steamId ?? steamId,
      tokenExpiresAt,
      correlationId: context.correlationId,
    },
    "Persisted Steam account login token",
  );

  return {
    accountId: account?.id ?? id,
    accountName,
    steamId: account?.steamId ?? steamId,
    connectedAt: now,
  };
}

async function startAccountAfterLogin(
  accountId: string,
  context: OperationContext,
) {
  const { steamManager } = await import("./manager.js");
  await steamManager.start(accountId, context);
}
