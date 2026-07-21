import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import SteamUser from "steam-user";
import { eq } from "drizzle-orm";
import { paths } from "../config.js";
import { db } from "../db/client.js";
import {
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
} from "../db/schema.js";
import {
  decryptSecret,
  decodeJwtExpiry,
  encryptSecret,
} from "../util/crypto.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { safeErrorMessage } from "../util/redact.js";
import type {
  AccountStatus,
  DesiredState,
  OwnedApp,
  WorkerStatusPayload,
} from "./types.js";
import { replaceAccountLibrary } from "./repository.js";
import { enforceGameLimit } from "./validation.js";
import { steamIdToString } from "./steam-id.js";
import {
  clearRecoveryHealth,
  clearSafetyHold,
  getAccountSafetyPolicy,
  setRecoveryHealth,
  setSafetyHold,
  touchSteamContact,
  type SafetyHoldOwner,
} from "./operations-repository.js";
import { classifySteamFailure, type RetryDecision } from "./retry-policy.js";

type SteamAccountRow = typeof steamAccount.$inferSelect;
type SteamWorkerOptions = {
  runAccountOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  canResumeOtherSessionDelay?: () => Promise<boolean>;
  getOtherSessionDelayOwner?: () => Promise<SafetyHoldOwner>;
};

export class SteamWorker extends EventEmitter {
  readonly accountId: string;
  private readonly client: SteamUser;
  private account: SteamAccountRow;
  private status: AccountStatus;
  private connected = false;
  private manuallyPaused = false;
  private blockedByOtherSession = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private otherSessionResumeTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private startInFlight = false;
  private quiescing = false;
  private intentGeneration = 0;
  private eventQueue: Promise<void> = Promise.resolve();
  private lastPersistedRefreshToken: string | null = null;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly runAccountOperation: NonNullable<
    SteamWorkerOptions["runAccountOperation"]
  >;
  private readonly canResumeOtherSessionDelay: NonNullable<
    SteamWorkerOptions["canResumeOtherSessionDelay"]
  >;
  private readonly getOtherSessionDelayOwner: NonNullable<
    SteamWorkerOptions["getOtherSessionDelayOwner"]
  >;

  constructor(account: SteamAccountRow, options: SteamWorkerOptions = {}) {
    super();
    this.account = account;
    this.accountId = account.id;
    this.status = account.status as AccountStatus;
    this.logger = createLogger("steam-worker", {
      accountId: account.id,
      accountName: account.accountName,
    });
    this.runAccountOperation =
      options.runAccountOperation ?? (async (operation) => operation());
    this.canResumeOtherSessionDelay =
      options.canResumeOtherSessionDelay ?? (async () => true);
    this.getOtherSessionDelayOwner =
      options.getOtherSessionDelayOwner ??
      (async () => ({ kind: "unscheduled" }));

    const dataDirectory = join(paths.steamData, account.id);
    mkdirSync(dataDirectory, { recursive: true });

    this.client = new SteamUser({
      autoRelogin: false,
      dataDirectory,
      protocol: SteamUser.EConnectionProtocol.WebSocket,
      renewRefreshTokens: true,
    });

    this.attachListeners();
  }

  get currentStatus() {
    return this.status;
  }

  get isConnected() {
    return this.connected;
  }

  async start() {
    return this.runSerial("command:start", () => this.startNow());
  }

  private async startNow() {
    if (this.quiescing) return;
    if (
      this.startInFlight ||
      this.status === "connecting" ||
      (this.connected && ["online", "boosting"].includes(this.status))
    ) {
      this.logger.debug(
        { status: this.status },
        "Ignoring redundant Steam worker start",
      );
      return;
    }

    const token = this.getRefreshToken();
    if (!token) {
      this.logger.warn("Cannot start Steam worker without refresh token");
      await this.setStatus(
        "login_required",
        "Refresh token is missing or incomplete.",
      );
      return;
    }

    this.logger.info({ desiredState: "running" }, "Starting Steam worker");
    this.manuallyPaused = false;
    this.startInFlight = true;
    await this.setDesiredState("running");
    await this.setStatus("connecting");

    try {
      this.client.logOn({
        refreshToken: token,
        machineName: "SteamBee",
      });
    } finally {
      this.startInFlight = false;
    }
  }

  async stop() {
    return this.runSerial("command:stop", () => this.stopNow());
  }

  private async stopNow() {
    this.logger.info("Stopping Steam worker");
    this.clearReconnect();
    this.clearOtherSessionResume();
    await clearRecoveryHealth(this.accountId);
    await clearSafetyHold(this.accountId);
    await this.setDesiredState("stopped");
    this.client.gamesPlayed([]);
    this.client.logOff();
    this.connected = false;
    await this.setStatus("disconnected");
  }

  async shutdown() {
    this.beginShutdown();
    return this.runSerial("command:shutdown", () => this.shutdownNow());
  }

  beginShutdown() {
    if (this.quiescing) return;
    this.quiescing = true;
    this.clearReconnect();
    this.clearOtherSessionResume();
    this.client.removeAllListeners();
  }

  private async shutdownNow() {
    this.logger.info("Gracefully shutting down Steam worker");
    this.clearReconnect();
    this.clearOtherSessionResume();
    this.client.gamesPlayed([]);
    this.client.logOff();
    this.connected = false;
    await this.setStatus("disconnected");
  }

  async pause() {
    return this.runSerial("command:pause", () => this.pauseNow());
  }

  private async pauseNow() {
    this.logger.info("Pausing Steam worker");
    this.clearReconnect();
    this.clearOtherSessionResume();
    this.manuallyPaused = true;
    await this.setDesiredState("paused");
    this.client.gamesPlayed([]);
    await this.setStatus("paused_manual");
  }

  async resume() {
    return this.runSerial("command:resume", () => this.resumeNow());
  }

  private async resumeNow() {
    this.logger.info("Resuming Steam worker");
    this.manuallyPaused = false;
    await this.setDesiredState("running");
    if (!this.connected) {
      await this.startNow();
      return;
    }
    await this.applyGames();
  }

  async updateAccount(account: SteamAccountRow) {
    return this.runSerial("command:update-account", () =>
      this.updateAccountNow(account),
    );
  }

  private async updateAccountNow(account: SteamAccountRow) {
    this.logger.debug(
      {
        personaState: account.personaState,
        customTitleEnabled: Boolean(account.customTitle?.trim()),
      },
      "Updating Steam worker account state",
    );
    if (account.desiredState !== this.account.desiredState) {
      this.intentGeneration += 1;
    }
    this.account = account;
    this.client.setPersona(account.personaState);
    await this.applyGames();
  }

  async importLibrary(): Promise<OwnedApp[]> {
    return this.runSerial("command:import-library", () =>
      this.importLibraryNow(),
    );
  }

  private async importLibraryNow(): Promise<OwnedApp[]> {
    if (!this.client.steamID) {
      throw new Error("The account is not connected.");
    }

    this.logger.info("Importing owned Steam apps");
    const response = (await this.client.getUserOwnedApps(this.client.steamID, {
      includePlayedFreeGames: true,
      includeFreeSub: true,
    })) as {
      apps?: Array<{ appid: number; name?: string; playtime_forever?: number }>;
    };

    const apps =
      response.apps?.map((app) => ({
        appId: app.appid,
        name: app.name || `App ${app.appid}`,
        playtimeForever: app.playtime_forever ?? 0,
      })) ?? [];

    const now = Date.now();
    const previousMeta = new Map(
      (
        await db
          .select({
            appId: steamAccountLibrary.appId,
            favorite: steamAccountLibrary.favorite,
            hidden: steamAccountLibrary.hidden,
            tagsJson: steamAccountLibrary.tagsJson,
          })
          .from(steamAccountLibrary)
          .where(eq(steamAccountLibrary.accountId, this.accountId))
      ).map((app) => [app.appId, app]),
    );

    replaceAccountLibrary(this.accountId, apps, previousMeta, now);

    this.logger.info({ appCount: apps.length }, "Imported owned Steam apps");
    return apps;
  }

  private attachListeners() {
    this.onClientEvent("loggedOn", async () => {
      this.logger.info("Steam client logged on");
      this.connected = true;
      this.clearReconnect();
      this.reconnectAttempt = 0;
      await touchSteamContact(this.accountId);
      await clearRecoveryHealth(this.accountId);
      await this.persistSteamId();
      this.client.setPersona(this.account.personaState);
      await this.setStatus("online");
      if (await this.honorOtherSessionDelayAfterLogin()) return;
      await this.applyGames();
    });

    this.onClientEvent("refreshToken", async (token: string) => {
      this.logger.debug("Steam refresh token renewed");
      await this.persistRefreshToken(token);
      await touchSteamContact(this.accountId);
    });

    this.onClientEvent("playingState", async (blocked: boolean) => {
      await touchSteamContact(this.accountId);
      const wasBlocked = this.blockedByOtherSession;
      this.blockedByOtherSession = blocked;
      if (blocked) {
        this.clearOtherSessionResume();
        if (!wasBlocked) {
          this.logger.warn(
            "Steam account is active elsewhere; pausing reported games",
          );
        }
        this.client.gamesPlayed([]);
        await this.setStatus("paused_other_session");
        return;
      }

      if (!wasBlocked) {
        this.logger.debug("Steam playing state confirmed available");
        return;
      }

      this.logger.info("Steam account is available for boosting again");
      if (!this.manuallyPaused && this.account.desiredState === "running") {
        await this.resumeAfterOtherSession();
      }
    });

    this.onClientEvent(
      "disconnected",
      async (eresult?: number, message?: string) => {
        this.connected = false;
        if (eresult !== undefined) await touchSteamContact(this.accountId);
        const decision = classifySteamFailure(eresult);
        if (decision.terminal) {
          await this.handleTerminalFailure(
            decision,
            message ?? "Steam disconnected permanently.",
          );
          return;
        }
        if (this.account.desiredState === "running") {
          this.logger.warn("Steam client disconnected; scheduling reconnect");
          await this.setStatus("reconnecting");
          await this.scheduleReconnect(decision);
        } else {
          this.logger.info("Steam client disconnected");
          await this.setStatus("disconnected");
        }
      },
    );

    this.onClientEvent("error", async (error: unknown) => {
      this.logger.error(
        errorLogFields(error, { desiredState: this.account.desiredState }),
        "Steam client error",
      );
      const decision = classifySteamFailure(error);
      if (decision.terminal) {
        await this.handleTerminalFailure(decision, safeErrorMessage(error));
        return;
      }
      await this.setStatus("error", safeErrorMessage(error));
      if (this.account.desiredState === "running") {
        await this.scheduleReconnect(decision);
      }
    });
  }

  private onClientEvent<T extends unknown[]>(
    event: string,
    handler: (...args: T) => Promise<void>,
  ) {
    this.client.on(
      event as never,
      ((...args: T) => {
        if (this.quiescing) return;
        const eventIntentGeneration = this.intentGeneration;
        void this.runAccountOperation(() =>
          this.runSerial(`event:${event}`, async () => {
            if (this.quiescing) return;
            if (eventIntentGeneration !== this.intentGeneration) {
              this.logger.debug(
                {
                  event,
                  eventIntentGeneration,
                  intentGeneration: this.intentGeneration,
                },
                "Ignoring Steam event from a superseded account intent",
              );
              return;
            }
            if (
              event === "loggedOn" &&
              this.account.desiredState !== "running"
            ) {
              this.logger.debug(
                { event, desiredState: this.account.desiredState },
                "Ignoring Steam login for an inactive account intent",
              );
              return;
            }
            await handler(...args);
          }),
        ).catch(() => undefined);
      }) as never,
    );
  }

  private runSerial<T>(source: string, handler: () => Promise<T>): Promise<T> {
    const operation = this.eventQueue.then(handler);
    this.eventQueue = operation.then(
      () => undefined,
      (error) => {
        this.logger.error(
          errorLogFields(error, { source }),
          "Serialized Steam operation failed",
        );
      },
    );
    return operation;
  }

  private async applyGames() {
    if (!this.connected) {
      this.logger.debug("Deferring gamesPlayed until Steam is connected");
      return;
    }

    if (this.manuallyPaused) {
      this.client.gamesPlayed([]);
      await this.setStatus("paused_manual");
      return;
    }

    if (this.blockedByOtherSession) {
      this.client.gamesPlayed([]);
      await this.setStatus("paused_other_session");
      return;
    }

    const games = await db
      .select()
      .from(steamAccountGame)
      .where(eq(steamAccountGame.accountId, this.accountId));
    const appIds = games
      .filter((game) => game.enabled)
      .map((game) => game.appId);
    enforceGameLimit(appIds, this.account.customTitle);

    const payload: Array<number | string> = [...appIds];
    if (this.account.customTitle?.trim()) {
      payload.unshift(this.account.customTitle.trim());
    }

    this.logger.info(
      {
        appCount: appIds.length,
        customTitleEnabled: Boolean(this.account.customTitle?.trim()),
      },
      "Applying gamesPlayed payload",
    );
    this.client.gamesPlayed(payload);
    await this.setStatus(payload.length > 0 ? "boosting" : "online");
  }

  private async scheduleReconnect(decision: RetryDecision) {
    this.clearReconnect();
    this.reconnectAttempt += 1;
    const scheduledIntentGeneration = this.intentGeneration;
    const backoff = Math.min(
      15 * 60_000,
      10_000 * 2 ** Math.min(this.reconnectAttempt, 6),
    );
    const delay = Math.max(backoff, decision.minimumDelayMs);
    const jitter = Math.floor(Math.random() * 2500);
    const nextRetryAt = Date.now() + delay + jitter;
    await setRecoveryHealth(this.accountId, {
      nextRetryAt,
      retryAttempt: this.reconnectAttempt,
      errorClass: decision.errorClass,
      errorCode: decision.errorCode,
      recoveryAction: decision.recoveryAction,
    });
    this.logger.warn(
      { reconnectAttempt: this.reconnectAttempt, delayMs: delay },
      "Scheduling Steam reconnect",
    );
    const timer = setTimeout(() => {
      if (this.reconnectTimer !== timer) return;
      this.reconnectTimer = null;
      if (this.quiescing) return;
      void this.runAccountOperation(async () => {
        if (
          this.quiescing ||
          this.account.desiredState !== "running" ||
          this.intentGeneration !== scheduledIntentGeneration
        ) {
          this.logger.debug(
            {
              desiredState: this.account.desiredState,
              scheduledIntentGeneration,
              intentGeneration: this.intentGeneration,
            },
            "Ignoring Steam reconnect from a superseded account intent",
          );
          return;
        }
        try {
          await this.start();
        } catch (error) {
          this.logger.error(
            errorLogFields(error, {
              reconnectAttempt: this.reconnectAttempt,
            }),
            "Steam reconnect failed",
          );
          if (
            this.account.desiredState === "running" &&
            this.intentGeneration === scheduledIntentGeneration
          ) {
            await this.scheduleReconnect(decision);
          }
        }
      }).catch(() => undefined);
    }, delay + jitter);
    this.reconnectTimer = timer;
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async handleTerminalFailure(
    decision: RetryDecision,
    message: string,
  ) {
    this.clearReconnect();
    this.clearOtherSessionResume();
    this.connected = false;
    this.blockedByOtherSession = false;
    await setRecoveryHealth(this.accountId, {
      nextRetryAt: null,
      retryAttempt: this.reconnectAttempt,
      errorClass: decision.errorClass,
      errorCode: decision.errorCode,
      recoveryAction: decision.recoveryAction,
    });
    await this.setDesiredState("paused");
    await this.setStatus(
      decision.errorClass === "authentication" ? "login_required" : "error",
      message,
    );
  }

  private async resumeAfterOtherSession() {
    const policy = await getAccountSafetyPolicy(this.accountId);
    if (policy.resumePolicy === "manual") {
      await this.requireManualResumeAfterOtherSession();
      return;
    }
    if (policy.resumePolicy === "delayed") {
      const resumeAt = Date.now() + policy.resumeDelayMinutes * 60_000;
      const owner = await this.getOtherSessionDelayOwner();
      await setSafetyHold(
        this.accountId,
        "other_session_delay",
        resumeAt,
        owner,
      );
      this.scheduleOtherSessionResume(resumeAt);
      return;
    }
    await clearSafetyHold(this.accountId);
    await this.applyGames();
  }

  private async honorOtherSessionDelayAfterLogin() {
    const policy = await getAccountSafetyPolicy(this.accountId);
    if (policy.holdReason !== "other_session_delay") return false;
    await this.resumeOtherSessionDelayNow();
    return true;
  }

  async resumeOtherSessionDelay() {
    return this.runSerial("safety:other-session-resume", () =>
      this.resumeOtherSessionDelayNow(),
    );
  }

  private async resumeOtherSessionDelayNow() {
    const policy = await getAccountSafetyPolicy(this.accountId);
    if (policy.holdReason !== "other_session_delay") return;
    if (policy.resumePolicy === "manual") {
      await this.requireManualResumeAfterOtherSession();
      return;
    }
    if (policy.pauseUntil !== null && policy.pauseUntil > Date.now()) {
      this.client.gamesPlayed([]);
      await this.setStatus("paused_other_session");
      this.scheduleOtherSessionResume(policy.pauseUntil);
      return;
    }
    if (
      !this.connected ||
      this.blockedByOtherSession ||
      this.manuallyPaused ||
      this.account.desiredState !== "running"
    ) {
      this.client.gamesPlayed([]);
      return;
    }
    if (!(await this.canResumeOtherSessionDelay())) {
      await clearSafetyHold(this.accountId);
      this.manuallyPaused = true;
      await this.setDesiredState("paused");
      this.client.gamesPlayed([]);
      await this.setStatus("paused_manual");
      return;
    }

    await clearSafetyHold(this.accountId);
    await this.applyGames();
  }

  private async requireManualResumeAfterOtherSession() {
    await setSafetyHold(this.accountId, "other_session_manual");
    this.manuallyPaused = true;
    await this.setDesiredState("paused");
    this.client.gamesPlayed([]);
    await this.setStatus("paused_manual");
  }

  private scheduleOtherSessionResume(resumeAt: number) {
    this.clearOtherSessionResume();
    const delay = Math.max(0, resumeAt - Date.now());
    this.otherSessionResumeTimer = setTimeout(() => {
      this.otherSessionResumeTimer = null;
      if (this.quiescing) return;
      void this.runAccountOperation(() =>
        this.runSerial("safety:other-session-resume", async () => {
          if (this.quiescing) return;
          await this.resumeOtherSessionDelayNow();
        }),
      ).catch(() => undefined);
    }, delay);
    this.otherSessionResumeTimer.unref();
  }

  private clearOtherSessionResume() {
    if (this.otherSessionResumeTimer)
      clearTimeout(this.otherSessionResumeTimer);
    this.otherSessionResumeTimer = null;
  }

  private getRefreshToken() {
    if (
      !this.account.tokenCiphertext ||
      !this.account.tokenIv ||
      !this.account.tokenAuthTag
    ) {
      return null;
    }

    return decryptSecret({
      ciphertext: this.account.tokenCiphertext,
      iv: this.account.tokenIv,
      authTag: this.account.tokenAuthTag,
      keyVersion: this.account.tokenKeyVersion,
    });
  }

  private async persistRefreshToken(token: string) {
    if (
      token === this.lastPersistedRefreshToken ||
      (this.lastPersistedRefreshToken === null &&
        token === this.getRefreshToken())
    ) {
      this.lastPersistedRefreshToken = token;
      this.logger.debug("Skipping unchanged Steam refresh token");
      return;
    }

    const encrypted = encryptSecret(token);
    const tokenExpiresAt = decodeJwtExpiry(token);
    const now = Date.now();
    this.account = {
      ...this.account,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenKeyVersion: encrypted.keyVersion,
      tokenExpiresAt,
      updatedAt: now,
    };
    await db
      .update(steamAccount)
      .set({
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
        tokenKeyVersion: encrypted.keyVersion,
        tokenExpiresAt,
        updatedAt: now,
      })
      .where(eq(steamAccount.id, this.accountId));
    this.lastPersistedRefreshToken = token;
    this.logger.info({ tokenExpiresAt }, "Persisted renewed refresh token");
  }

  private async persistSteamId() {
    const steamId = steamIdToString(this.client.steamID);
    if (!steamId || steamId === this.account.steamId) return;

    const now = Date.now();
    this.account = { ...this.account, steamId, updatedAt: now };
    await db
      .update(steamAccount)
      .set({ steamId, updatedAt: now })
      .where(eq(steamAccount.id, this.accountId));
    this.logger.info({ steamId }, "Persisted SteamID");
  }

  private async setDesiredState(desiredState: DesiredState) {
    if (this.account.desiredState !== desiredState) {
      this.intentGeneration += 1;
    }
    this.account = { ...this.account, desiredState };
    await db
      .update(steamAccount)
      .set({ desiredState, updatedAt: Date.now() })
      .where(eq(steamAccount.id, this.accountId));
  }

  private async setStatus(status: AccountStatus, error?: string) {
    const previousStatus = this.status;
    const nextError = error ?? null;
    if (
      this.status === status &&
      (this.account.lastError ?? null) === nextError
    ) {
      return;
    }

    this.status = status;
    const now = Date.now();
    const latestBoostStartedAt =
      status === "boosting" ? (this.account.latestBoostStartedAt ?? now) : null;

    this.account = {
      ...this.account,
      status,
      lastError: nextError,
      latestBoostStartedAt,
      updatedAt: now,
    };

    await db
      .update(steamAccount)
      .set({
        status,
        lastError: nextError,
        latestBoostStartedAt,
        updatedAt: now,
      })
      .where(eq(steamAccount.id, this.accountId));

    const fields = {
      previousStatus,
      status,
      desiredState: this.account.desiredState,
      hasError: Boolean(nextError),
    };
    if (nextError) {
      this.logger.error(
        { ...fields, error: nextError },
        "Steam status changed",
      );
    } else {
      this.logger.info(fields, "Steam status changed");
    }

    this.emit("status", {
      accountId: this.accountId,
      status,
      ...(nextError === null ? {} : { error: nextError }),
    } satisfies WorkerStatusPayload);
  }
}
