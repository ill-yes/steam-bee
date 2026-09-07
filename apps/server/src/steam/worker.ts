import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import SteamUser from "steam-user";
import { and, eq, isNull } from "drizzle-orm";
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
  setRecoveryHealth,
  touchSteamContact,
} from "./operations-repository.js";
import {
  classifySteamFailure,
  sessionConflictDelay,
  type RetryDecision,
} from "./retry-policy.js";

type SteamAccountRow = typeof steamAccount.$inferSelect;
type RenewedCredential = {
  refreshToken: string;
  previousRefreshToken: string;
  steamId: string;
};
type LifecycleSteamUser = SteamUser & {
  steamBeeBeginShutdown(): void;
  steamBeeDrainRefreshTokens(): Promise<void>;
  steamBeeLogOffAndDrain(): Promise<void>;
};
type SteamWorkerOptions = {
  runAccountOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  recordSessionConflict?: (input: {
    attempt: number;
    nextRetryAt: number;
    cooldown: boolean;
    source: "login" | "live";
    errorCode: number | null;
  }) => Promise<void>;
};

export class SteamWorker extends EventEmitter {
  readonly accountId: string;
  private readonly client: LifecycleSteamUser;
  private account: SteamAccountRow;
  private status: AccountStatus;
  private connected = false;
  private manuallyPaused = false;
  private blockedByOtherSession = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sessionConflictTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private sessionConflictAttempt = 0;
  private sessionConflictMode: "login" | "live" | null = null;
  private loginAttemptId = 0;
  private handledConflictLoginAttemptId: number | null = null;
  private startInFlight = false;
  private quiescing = false;
  private intentGeneration = 0;
  private eventQueue: Promise<void> = Promise.resolve();
  private credentialQueue: Promise<void> = Promise.resolve();
  private credentialError: unknown;
  private shutdownPromise: Promise<void> | null = null;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly runAccountOperation: NonNullable<
    SteamWorkerOptions["runAccountOperation"]
  >;
  private readonly recordSessionConflict: NonNullable<
    SteamWorkerOptions["recordSessionConflict"]
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
    this.recordSessionConflict =
      options.recordSessionConflict ?? (async () => undefined);

    const dataDirectory = join(paths.steamData, account.id);
    mkdirSync(dataDirectory, { recursive: true });

    this.client = new SteamUser({
      autoRelogin: false,
      dataDirectory,
      protocol: SteamUser.EConnectionProtocol.WebSocket,
      renewRefreshTokens: true,
    }) as LifecycleSteamUser;

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
      if (this.quiescing) return;
      this.loginAttemptId += 1;
      this.handledConflictLoginAttemptId = null;
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
    this.clearRetryTimers();
    this.resetSessionConflict();
    await clearRecoveryHealth(this.accountId);
    await clearSafetyHold(this.accountId);
    await this.setDesiredState("stopped");
    this.client.gamesPlayed([]);
    this.client.logOff();
    this.connected = false;
    await this.setStatus("disconnected");
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.beginShutdown();
    this.shutdownPromise = (async () => {
      await this.client.steamBeeDrainRefreshTokens();
      await this.credentialQueue;
      await this.runSerial("command:shutdown", () => this.shutdownNow());
      this.client.removeAllListeners();
      if (this.credentialError) throw this.credentialError;
    })();
    return this.shutdownPromise;
  }

  beginShutdown() {
    if (this.quiescing) return;
    this.quiescing = true;
    this.clearRetryTimers();
    this.resetSessionConflict();
    this.client.steamBeeBeginShutdown();
  }

  private async shutdownNow() {
    this.logger.info("Gracefully shutting down Steam worker");
    this.clearRetryTimers();
    this.resetSessionConflict();
    this.client.gamesPlayed([]);
    await this.client.steamBeeLogOffAndDrain();
    // A timed-out renewal can still publish its credential while the transport closes.
    await this.credentialQueue;
    this.connected = false;
    await this.setStatus("disconnected");
  }

  async pause() {
    return this.runSerial("command:pause", () => this.pauseNow());
  }

  private async pauseNow() {
    this.logger.info("Pausing Steam worker");
    this.clearRetryTimers();
    this.resetSessionConflict();
    await clearRecoveryHealth(this.accountId);
    this.manuallyPaused = true;
    await this.setDesiredState("paused");
    this.client.gamesPlayed([]);
    await this.setStatus("paused_manual");
  }

  async forceDisconnectForSafety(message: string) {
    return this.runSerial("safety:force-disconnect", async () => {
      this.logger.warn("Force-disconnecting Steam worker for safety");
      this.clearRetryTimers();
      this.resetSessionConflict();
      this.manuallyPaused = true;
      const failures: unknown[] = [];
      try {
        await clearRecoveryHealth(this.accountId);
      } catch (error) {
        failures.push(error);
      }
      try {
        await this.setDesiredState("paused");
      } catch (error) {
        failures.push(error);
      }
      try {
        this.client.gamesPlayed([]);
      } catch (error) {
        failures.push(error);
      }
      try {
        this.client.logOff();
      } catch (error) {
        failures.push(error);
      }
      this.connected = false;
      try {
        await this.setStatus("paused_manual", message);
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw failures[0];
      }
    });
  }

  async markSafetyAttention(message: string) {
    return this.runSerial("safety:attention", async () => {
      this.clearRetryTimers();
      this.resetSessionConflict();
      this.connected = false;
      this.manuallyPaused = true;
      await this.setDesiredState("paused");
      await setRecoveryHealth(this.accountId, {
        nextRetryAt: null,
        retryAttempt: 0,
        errorClass: "terminal",
        errorCode: null,
        recoveryAction: "attention",
      });
      await this.setStatus("error", message);
    });
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
      if (account.desiredState !== "running") {
        this.clearRetryTimers();
        this.resetSessionConflict();
        await clearRecoveryHealth(this.accountId);
      }
    }
    this.account = account;
    if (this.quiescing) return;
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
      this.clearSessionConflictTimer();
      this.resetSessionConflict();
      await touchSteamContact(this.accountId);
      await clearRecoveryHealth(this.accountId);
      await this.persistSteamId();
      if (this.quiescing) return;
      this.client.setPersona(this.account.personaState);
      await this.setStatus("online");
      await this.applyGames();
    });

    // Credentials belong to the login that renewed them, not the current UI intent.
    this.client.on(
      "steamBeeRefreshToken" as never,
      ((credential: RenewedCredential) => {
        this.credentialQueue = this.credentialQueue
          .then(() => {
            this.persistRefreshToken(credential);
          })
          .catch(() => {
            // Database errors may include SQL parameters containing encrypted credentials.
            this.credentialError = new Error(
              "Could not persist a renewed Steam credential.",
            );
            this.logger.error("Could not persist a renewed Steam credential");
          });
      }) as never,
    );

    this.onClientEvent("playingState", async (blocked: boolean) => {
      await touchSteamContact(this.accountId);
      const wasBlocked = this.blockedByOtherSession;
      this.blockedByOtherSession = blocked;
      if (blocked) {
        if (!wasBlocked) {
          this.logger.warn(
            "Steam account is active elsewhere; pausing reported games",
          );
        }
        this.client.gamesPlayed([]);
        await this.setStatus("paused_other_session");
        if (!wasBlocked && this.account.desiredState === "running") {
          await this.registerSessionConflict("live", null);
        }
        return;
      }

      if (!wasBlocked) {
        this.logger.debug("Steam playing state confirmed available");
        return;
      }

      this.logger.info("Steam account is available for boosting again");
      if (!this.manuallyPaused && this.account.desiredState === "running") {
        this.clearSessionConflictTimer();
        this.resetSessionConflict();
        await clearRecoveryHealth(this.accountId);
        await this.applyGames();
      }
    });

    this.onClientEvent(
      "disconnected",
      async (eresult?: number, message?: string) => {
        this.connected = false;
        if (eresult !== undefined) await touchSteamContact(this.accountId);
        if (this.handledConflictLoginAttemptId === this.loginAttemptId) return;
        const decision = classifySteamFailure(eresult);
        if (decision.errorClass === "session_replaced") {
          await this.handleLoginSessionConflict(decision);
          return;
        }
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
      if (this.handledConflictLoginAttemptId === this.loginAttemptId) return;
      const decision = classifySteamFailure(error);
      if (decision.errorClass === "session_replaced") {
        await this.handleLoginSessionConflict(decision);
        return;
      }
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
    if (this.quiescing && source !== "command:shutdown") {
      return Promise.reject(new Error("Steam worker is shutting down."));
    }
    const operation = this.eventQueue.then(() => {
      if (this.quiescing && source !== "command:shutdown") {
        throw new Error("Steam worker is shutting down.");
      }
      return handler();
    });
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
    if (this.quiescing || !this.connected) {
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

    const payload = await this.selectedGamesPayload();
    if (this.quiescing) return;

    this.logger.info(
      {
        appCount: payload.filter((entry) => typeof entry === "number").length,
        customTitleEnabled: Boolean(this.account.customTitle?.trim()),
      },
      "Applying gamesPlayed payload",
    );
    this.client.gamesPlayed(payload);
    await this.setStatus(payload.length > 0 ? "boosting" : "online");
  }

  private async selectedGamesPayload() {
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

    return payload;
  }

  private async scheduleReconnect(decision: RetryDecision) {
    this.clearReconnect();
    this.clearSessionConflictTimer();
    this.resetSessionConflict();
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
    this.clearRetryTimers();
    this.resetSessionConflict();
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

  private async handleLoginSessionConflict(decision: RetryDecision) {
    if (this.handledConflictLoginAttemptId === this.loginAttemptId) return;
    this.handledConflictLoginAttemptId = this.loginAttemptId;
    this.connected = false;
    this.blockedByOtherSession = false;
    await this.setStatus("reconnecting");
    await this.registerSessionConflict("login", decision.errorCode);
  }

  private async registerSessionConflict(
    source: "login" | "live",
    errorCode: number | null,
  ) {
    this.clearReconnect();
    this.clearSessionConflictTimer();
    this.sessionConflictMode = source;
    this.sessionConflictAttempt += 1;
    const attempt = this.sessionConflictAttempt;
    const cooldown = attempt >= 3;
    const delay = sessionConflictDelay(attempt);
    const nextRetryAt = Date.now() + delay;
    await setRecoveryHealth(this.accountId, {
      nextRetryAt,
      retryAttempt: attempt,
      errorClass: "session_replaced",
      errorCode,
      recoveryAction: cooldown ? "wait" : "retry",
    });
    await this.recordSessionConflict({
      attempt,
      nextRetryAt,
      cooldown,
      source,
      errorCode,
    });
    this.scheduleSessionConflictRetry(delay, cooldown);
  }

  private scheduleSessionConflictRetry(delay: number, resetCycle: boolean) {
    const scheduledIntentGeneration = this.intentGeneration;
    const timer = setTimeout(() => {
      if (this.sessionConflictTimer !== timer) return;
      this.sessionConflictTimer = null;
      if (this.quiescing) return;
      void this.runAccountOperation(() =>
        this.runSerial("session-conflict:retry", async () => {
          if (
            this.quiescing ||
            this.account.desiredState !== "running" ||
            this.intentGeneration !== scheduledIntentGeneration
          ) {
            return;
          }
          if (resetCycle) this.sessionConflictAttempt = 0;
          if (this.sessionConflictMode === "live") {
            await this.retryLiveSessionConflict();
            return;
          }
          await this.startNow();
        }),
      ).catch(() => undefined);
    }, delay);
    this.sessionConflictTimer = timer;
    timer.unref();
  }

  private async retryLiveSessionConflict() {
    if (!this.blockedByOtherSession) {
      this.resetSessionConflict();
      await clearRecoveryHealth(this.accountId);
      await this.applyGames();
      return;
    }
    const payload = await this.selectedGamesPayload();
    if (this.quiescing) return;
    this.client.gamesPlayed(payload);
    await this.registerSessionConflict("live", null);
  }

  private clearSessionConflictTimer() {
    if (this.sessionConflictTimer) clearTimeout(this.sessionConflictTimer);
    this.sessionConflictTimer = null;
  }

  private resetSessionConflict() {
    this.sessionConflictAttempt = 0;
    this.sessionConflictMode = null;
    this.handledConflictLoginAttemptId = null;
    this.blockedByOtherSession = false;
  }

  private clearRetryTimers() {
    this.clearReconnect();
    this.clearSessionConflictTimer();
  }

  private getRefreshToken() {
    // Account snapshots can predate a renewal or QR replacement committed meanwhile.
    const account = db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.id, this.accountId))
      .get();
    if (
      !account ||
      account.createdAt !== this.account.createdAt ||
      !account.tokenCiphertext ||
      !account.tokenIv ||
      !account.tokenAuthTag
    ) {
      return null;
    }

    return decryptSecret({
      ciphertext: account.tokenCiphertext,
      iv: account.tokenIv,
      authTag: account.tokenAuthTag,
      keyVersion: account.tokenKeyVersion,
    });
  }

  private persistRefreshToken(credential: RenewedCredential) {
    const { refreshToken, previousRefreshToken, steamId } = credential;
    const stored = db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.id, this.accountId))
      .get();
    if (
      !stored ||
      !stored.tokenCiphertext ||
      !stored.tokenIv ||
      !stored.tokenAuthTag
    )
      return;
    if (
      stored.accountName !== this.account.accountName ||
      stored.createdAt !== this.account.createdAt
    )
      return;
    if (!/^765\d{14}$/.test(steamId)) return;
    if (stored.steamId !== steamId) {
      if (stored.steamId !== null) return;
      try {
        const payload = JSON.parse(
          Buffer.from(
            previousRefreshToken.split(".")[1] ?? "",
            "base64url",
          ).toString("utf8"),
        );
        if (payload.sub !== steamId) return;
      } catch {
        return;
      }
    }
    const storedToken = decryptSecret({
      ciphertext: stored.tokenCiphertext,
      iv: stored.tokenIv,
      authTag: stored.tokenAuthTag,
      keyVersion: stored.tokenKeyVersion,
    });
    if (storedToken !== previousRefreshToken || refreshToken === storedToken)
      return;
    const encrypted = encryptSecret(refreshToken);
    const tokenExpiresAt = decodeJwtExpiry(refreshToken);
    const now = Date.now();
    const update = {
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenKeyVersion: encrypted.keyVersion,
      tokenExpiresAt,
      updatedAt: now,
    };
    const result = db
      .update(steamAccount)
      .set(update)
      .where(
        and(
          eq(steamAccount.id, this.accountId),
          eq(steamAccount.accountName, stored.accountName),
          eq(steamAccount.createdAt, stored.createdAt),
          stored.steamId === null
            ? isNull(steamAccount.steamId)
            : eq(steamAccount.steamId, steamId),
          eq(steamAccount.tokenCiphertext, stored.tokenCiphertext),
          eq(steamAccount.tokenIv, stored.tokenIv),
          eq(steamAccount.tokenAuthTag, stored.tokenAuthTag),
          eq(steamAccount.tokenKeyVersion, stored.tokenKeyVersion),
        ),
      )
      .run();
    if (result.changes !== 1) return;
    this.account = { ...this.account, ...update };
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
