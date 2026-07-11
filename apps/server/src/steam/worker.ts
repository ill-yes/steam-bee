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

type SteamAccountRow = typeof steamAccount.$inferSelect;

export class SteamWorker extends EventEmitter {
  readonly accountId: string;
  private readonly client: SteamUser;
  private account: SteamAccountRow;
  private status: AccountStatus;
  private manuallyPaused = false;
  private blockedByOtherSession = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private startInFlight = false;
  private eventQueue: Promise<void> = Promise.resolve();
  private lastPersistedRefreshToken: string | null = null;
  private readonly logger: ReturnType<typeof createLogger>;

  constructor(account: SteamAccountRow) {
    super();
    this.account = account;
    this.accountId = account.id;
    this.status = account.status as AccountStatus;
    this.logger = createLogger("steam-worker", {
      accountId: account.id,
      accountName: account.accountName,
    });

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

  async start() {
    return this.runSerial("command:start", () => this.startNow());
  }

  private async startNow() {
    if (
      this.startInFlight ||
      ["connecting", "online", "boosting"].includes(this.status)
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
    await this.setDesiredState("stopped");
    this.client.gamesPlayed([]);
    this.client.logOff();
    await this.setStatus("disconnected");
  }

  async shutdown() {
    return this.runSerial("command:shutdown", () => this.shutdownNow());
  }

  private async shutdownNow() {
    this.logger.info("Gracefully shutting down Steam worker");
    this.clearReconnect();
    this.client.gamesPlayed([]);
    this.client.logOff();
    await this.setStatus("disconnected");
  }

  async pause() {
    return this.runSerial("command:pause", () => this.pauseNow());
  }

  private async pauseNow() {
    this.logger.info("Pausing Steam worker");
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
      this.clearReconnect();
      this.reconnectAttempt = 0;
      await this.persistSteamId();
      this.client.setPersona(this.account.personaState);
      await this.setStatus("online");
      await this.applyGames();
    });

    this.onClientEvent("refreshToken", async (token: string) => {
      this.logger.debug("Steam refresh token renewed");
      await this.persistRefreshToken(token);
    });

    this.onClientEvent("playingState", async (blocked: boolean) => {
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
        return;
      }

      if (!wasBlocked) {
        this.logger.debug("Steam playing state confirmed available");
        return;
      }

      this.logger.info("Steam account is available for boosting again");
      if (!this.manuallyPaused && this.account.desiredState === "running") {
        await this.applyGames();
      }
    });

    this.onClientEvent("disconnected", async () => {
      if (this.account.desiredState === "running") {
        this.logger.warn("Steam client disconnected; scheduling reconnect");
        await this.setStatus("reconnecting");
        this.scheduleReconnect();
      } else {
        this.logger.info("Steam client disconnected");
        await this.setStatus("disconnected");
      }
    });

    this.onClientEvent("error", async (error: unknown) => {
      this.logger.error(
        errorLogFields(error, { desiredState: this.account.desiredState }),
        "Steam client error",
      );
      await this.setStatus("error", safeErrorMessage(error));
      if (this.account.desiredState === "running") {
        this.scheduleReconnect();
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
        void this.runSerial(`event:${event}`, () => handler(...args)).catch(
          () => undefined,
        );
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

  private scheduleReconnect() {
    this.clearReconnect();
    this.reconnectAttempt += 1;
    const delay = Math.min(
      15 * 60_000,
      10_000 * 2 ** Math.min(this.reconnectAttempt, 6),
    );
    this.logger.warn(
      { reconnectAttempt: this.reconnectAttempt, delayMs: delay },
      "Scheduling Steam reconnect",
    );
    this.reconnectTimer = setTimeout(
      () => {
        void this.start().catch((error) => {
          this.logger.error(
            errorLogFields(error, {
              reconnectAttempt: this.reconnectAttempt,
            }),
            "Steam reconnect failed",
          );
          if (this.account.desiredState === "running") {
            this.scheduleReconnect();
          }
        });
      },
      delay + Math.floor(Math.random() * 2500),
    );
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
