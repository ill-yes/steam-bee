import { randomUUID } from "node:crypto";
import { EAuthTokenPlatformType, LoginSession } from "steam-session";
import { decodeJwtExpiry, encryptSecret } from "../util/crypto.js";
import { db } from "../db/client.js";
import { steamAccount } from "../db/schema.js";
import { recordEvent } from "../http/events.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { safeErrorMessage } from "../util/redact.js";
import type { OperationContext } from "./manager.js";

type LoginState =
  | { status: "pending"; qrUrl?: string; message?: string }
  | {
      status: "authenticated";
      accountId: string;
      accountName: string;
      steamId: string | null;
      message?: string;
    }
  | { status: "error"; message: string };

type LoginRecord = {
  session: LoginSession;
  state: LoginState;
  createdAt: number;
  terminalAt: number | null;
  completion: Promise<void> | null;
  context: OperationContext;
};

const qrLogins = new Map<string, LoginRecord>();
const loginLogger = createLogger("steam-login");
const qrPendingTtlMs = 10 * 60_000;
const qrTerminalTtlMs = 10 * 60_000;
const qrCleanupInterval = setInterval(() => cleanupQrLogins(), 60_000);
qrCleanupInterval.unref();

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
    createdAt: Date.now(),
    terminalAt: null,
    completion: null,
    context,
  };

  qrLogins.set(loginId, record);

  session.on("authenticated", () => {
    if (record.completion) return;
    record.completion = (async () => {
      if (!session.refreshToken) {
        loginLogger.warn(
          { loginId },
          "QR Steam login authenticated without token",
        );
        record.state = {
          status: "error",
          message: "No refresh token received.",
        };
        record.terminalAt = Date.now();
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
      record.state = {
        status: "authenticated",
        message: "Connection saved. Steam is connecting.",
        ...result,
      };
      record.terminalAt = Date.now();
    })().catch((error) => {
      loginLogger.error(
        errorLogFields(error, { loginId }),
        "Failed to persist QR Steam login",
      );
      record.state = { status: "error", message: safeErrorMessage(error) };
      record.terminalAt = Date.now();
    });
  });

  session.on("timeout", () => {
    loginLogger.warn({ loginId }, "QR Steam login timeout");
    record.state = { status: "error", message: "QR login timed out." };
    record.terminalAt ??= Date.now();
  });

  session.on("error", (error) => {
    loginLogger.error(
      errorLogFields(error, { loginId }),
      "QR Steam login error",
    );
    record.state = { status: "error", message: safeErrorMessage(error) };
    record.terminalAt ??= Date.now();
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
      record.state.status === "pending" &&
      now - record.createdAt >= qrPendingTtlMs
    ) {
      record.state = { status: "error", message: "Login session expired." };
      record.terminalAt = now;
      loginLogger.warn({ loginId }, "QR login record expired");
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

  await recordEvent({
    accountId: account?.id ?? id,
    level: "info",
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
  };
}

async function startAccountAfterLogin(
  accountId: string,
  context: OperationContext,
) {
  const { steamManager } = await import("./manager.js");
  await steamManager.start(accountId, context);
}

function steamIdToString(value: unknown) {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "getSteamID64" in value) {
    const candidate = value as { getSteamID64?: () => string };
    if (typeof candidate.getSteamID64 === "function") {
      return String(candidate.getSteamID64());
    }
  }
  return String(value);
}
