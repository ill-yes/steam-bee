import { ACCOUNT_STATUS_CAPABILITIES, ERROR_CODES } from "@steam-bee/contracts";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { boostPreset, boostPresetGame, steamAccount } from "../db/schema.js";
import {
  broadcast,
  recordErrorEventSafely,
  recordInfoEventSafely,
} from "../http/events.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { safeErrorMessage } from "../util/redact.js";
import { appError } from "../http/errors.js";
import type { OperationContext } from "../operation-context.js";
import { hasAccountLibrary, replaceSelectedGames } from "./repository.js";
import { enforceGameLimit } from "./validation.js";
import { SteamWorker } from "./worker.js";
import { getAccountOrThrow } from "./account-repository.js";
import { trackBoostSession } from "./boost-session-tracker.js";
import { SteamStatusEventRecorder } from "./status-event-recorder.js";
import { AccountOperationState } from "./account-operation-state.js";
import type { WorkerStatusPayload } from "./types.js";
import { ScheduleCoordinator } from "./schedule-coordinator.js";
import { scheduleRepository } from "./schedule-repository.js";
import { AutoLibraryImporter } from "./auto-library-importer.js";

class SteamManager {
  private workers = new Map<string, SteamWorker>();
  private shutdownPromise: Promise<void> | null = null;
  private readonly logger = createLogger("steam-manager");
  private readonly accountOperations = new AccountOperationState();
  private readonly statusEventRecorder = new SteamStatusEventRecorder(
    (accountId) => this.accountOperations.metadata(accountId),
  );
  private readonly autoLibraryImporter = new AutoLibraryImporter({
    hasLibrary: hasAccountLibrary,
    importLibrary: async (accountId) => {
      const worker = await this.getWorkerForAccount(accountId);
      return worker.importLibrary();
    },
    metadataFor: (accountId) => this.accountOperations.metadata(accountId),
    recordInfo: (accountId, type, message, metadata) =>
      this.recordInfo(accountId, type, message, metadata),
    recordError: (accountId, type, message, metadata) =>
      this.recordError(accountId, type, message, metadata),
  });
  private readonly scheduleCoordinator = new ScheduleCoordinator({
    repository: scheduleRepository,
    runForAccount: (accountId, operation) =>
      this.accountOperations.run(accountId, operation),
    getDesiredState: async (accountId) =>
      (await getAccountOrThrow(accountId)).desiredState,
    applyPreset: (accountId, presetId, context) =>
      this.applyPresetNow(accountId, presetId, context),
    pause: (accountId, context) => this.pauseNow(accountId, context),
    resumeOrStart: (accountId, context) =>
      this.resumeOrStartFromScheduleNow(accountId, context),
    recordInfo: (accountId, type, message, metadata) =>
      this.recordInfo(accountId, type, message, metadata),
    recordError: (accountId, type, message, metadata) =>
      this.recordError(accountId, type, message, metadata),
    onTickError: (error, phase) => {
      this.logger.error(
        errorLogFields(error),
        phase === "initial"
          ? "Initial schedule tick failed"
          : "Schedule tick failed",
      );
    },
  });

  async init() {
    const accounts = await db.select().from(steamAccount);
    this.logger.info(
      { accountCount: accounts.length },
      "Initializing Steam workers",
    );
    for (const account of accounts) {
      const worker = this.getOrCreateWorker(account);
      if (account.desiredState === "running") {
        this.logger.info({ accountId: account.id }, "Auto-starting account");
        void worker.start().catch((error) => {
          this.logger.error(
            errorLogFields(error, { accountId: account.id }),
            "Auto-start failed",
          );
        });
      }
    }
    this.scheduleCoordinator.start();
  }

  runAccountOperation<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.accountOperations.run(accountId, operation);
  }

  async start(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, () =>
      this.startNow(accountId, context),
    );
  }

  private async startNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "start", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Starting Steam session",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.start();
    await this.recordInfo(
      accountId,
      "steam.start",
      "Steam session is starting.",
      this.accountOperations.metadata(accountId),
    );
  }

  async stop(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, () =>
      this.stopNow(accountId, context),
    );
  }

  private async stopNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "stop", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Stopping Steam session",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.stop();
    await this.recordInfo(
      accountId,
      "steam.stop",
      "Boosting was stopped.",
      this.accountOperations.metadata(accountId),
    );
  }

  async forget(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, () =>
      this.forgetNow(accountId, context),
    );
  }

  async deleteAccount(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, async () => {
      await this.forgetNow(accountId, context);
      await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
    });
  }

  private async forgetNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "forget", context);
    this.logger.info({ accountId }, "Forgetting Steam account worker");
    const worker = this.workers.get(accountId);
    try {
      if (worker) {
        worker.removeAllListeners("status");
        try {
          await worker.stop();
        } catch (error) {
          try {
            await worker.shutdown();
          } catch (shutdownError) {
            this.logger.error(
              errorLogFields(shutdownError, { accountId }),
              "Fallback Steam worker shutdown failed",
            );
          }
          throw error;
        }
      }
    } finally {
      await this.closeBoostSession(accountId);
      if (worker) {
        worker.removeAllListeners();
        this.workers.delete(accountId);
      }
      this.clearAccountState(accountId);
    }
  }

  async pause(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, () =>
      this.pauseNow(accountId, context),
    );
  }

  private async pauseNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "pause", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Pausing Steam boost",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.pause();
    await this.recordInfo(
      accountId,
      "steam.pause",
      "Boosting was paused.",
      this.accountOperations.metadata(accountId),
    );
  }

  async resume(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, () =>
      this.resumeNow(accountId, context),
    );
  }

  private async resumeNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "resume", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Resuming Steam boost",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.resume();
    await this.recordInfo(
      accountId,
      "steam.resume",
      "Boosting was resumed.",
      this.accountOperations.metadata(accountId),
    );
  }

  async refreshWorker(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, () =>
      this.refreshWorkerNow(accountId, context),
    );
  }

  private async refreshWorkerNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "refresh", context);
    this.logger.debug({ accountId }, "Refreshing Steam worker account state");
    const account = await getAccountOrThrow(accountId);
    const worker = this.getOrCreateWorker(account);
    await worker.updateAccount(account);
  }

  async applyPreset(
    accountId: string,
    presetId: string,
    context: OperationContext = {},
  ) {
    return this.accountOperations.run(accountId, () =>
      this.applyPresetNow(accountId, presetId, context),
    );
  }

  private async applyPresetNow(
    accountId: string,
    presetId: string,
    context: OperationContext,
  ) {
    this.accountOperations.remember(accountId, "preset-apply", context);
    const preset = await db.query.boostPreset.findFirst({
      where: and(
        eq(boostPreset.id, presetId),
        eq(boostPreset.accountId, accountId),
      ),
    });
    if (!preset) {
      throw appError("Preset was not found.", 404, ERROR_CODES.presetNotFound);
    }

    const games = await db
      .select()
      .from(boostPresetGame)
      .where(eq(boostPresetGame.presetId, presetId));
    const appIds = games.map((game) => game.appId);
    enforceGameLimit(appIds, preset.customTitle);

    const now = Date.now();
    replaceSelectedGames({
      accountId,
      appIds,
      source: "preset",
      activePresetId: preset.id,
      personaState: preset.personaState,
      customTitle: preset.customTitle,
      now,
    });

    await this.recordInfo(
      accountId,
      "steam.preset.apply",
      `Preset "${preset.name}" applied.`,
      {
        ...this.accountOperations.metadata(accountId),
        presetId,
        appCount: appIds.length,
        customTitleEnabled: Boolean(preset.customTitle?.trim()),
      },
    );
    await this.refreshWorkerNow(accountId, context);
  }

  async importLibrary(accountId: string, context: OperationContext = {}) {
    return this.accountOperations.run(accountId, () =>
      this.importLibraryNow(accountId, context),
    );
  }

  private async importLibraryNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "library-import", context);
    const worker = await this.getWorkerForAccount(accountId);
    await this.recordInfo(
      accountId,
      "steam.library.import.start",
      "Library import started.",
      { ...this.accountOperations.metadata(accountId), mode: "manual" },
    );

    try {
      const apps = await worker.importLibrary();
      await this.recordInfo(
        accountId,
        "steam.library.import",
        `${apps.length} games imported.`,
        {
          ...this.accountOperations.metadata(accountId),
          appCount: apps.length,
          mode: "manual",
        },
      );
      return apps;
    } catch (error) {
      await this.recordError(
        accountId,
        "steam.library.import.error",
        `Library import failed: ${safeErrorMessage(error)}`,
        { ...this.accountOperations.metadata(accountId), mode: "manual" },
      );
      throw error;
    }
  }

  getStatus(accountId: string) {
    return this.workers.get(accountId)?.currentStatus ?? "disconnected";
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;

    const shutdownPromise = this.shutdownNow().finally(() => {
      if (this.shutdownPromise === shutdownPromise) {
        this.shutdownPromise = null;
      }
    });
    this.shutdownPromise = shutdownPromise;
    return shutdownPromise;
  }

  private async shutdownNow() {
    await this.scheduleCoordinator.stop();
    const entries = [...this.workers.entries()];
    this.logger.info(
      { workerCount: entries.length },
      "Shutting down Steam workers",
    );
    for (const [, worker] of entries) {
      worker.removeAllListeners("status");
    }
    await this.accountOperations.drain();
    await Promise.allSettled(
      entries.map(async ([accountId, worker]) => {
        try {
          await worker.shutdown();
        } catch (error) {
          this.logger.error(
            errorLogFields(error, { accountId }),
            "Steam worker shutdown failed",
          );
        } finally {
          await this.closeBoostSession(accountId);
          worker.removeAllListeners();
          this.workers.delete(accountId);
        }
      }),
    );
    this.accountOperations.clearContexts();
    this.statusEventRecorder.clearAll();
    this.autoLibraryImporter.clearAll();
    this.scheduleCoordinator.clearAll();
  }

  private async getWorkerForAccount(accountId: string) {
    const account = await getAccountOrThrow(accountId);
    return this.getOrCreateWorker(account);
  }

  private getOrCreateWorker(account: typeof steamAccount.$inferSelect) {
    let worker = this.workers.get(account.id);
    if (!worker) {
      const createdWorker = new SteamWorker(account);
      this.logger.debug({ accountId: account.id }, "Created Steam worker");
      createdWorker.on("status", (payload) =>
        this.handleWorkerStatus(createdWorker, payload),
      );
      this.workers.set(account.id, createdWorker);
      worker = createdWorker;
    }
    return worker;
  }

  private handleWorkerStatus(
    worker: SteamWorker,
    payload: WorkerStatusPayload,
  ) {
    const accountId = worker.accountId;
    if (payload.accountId !== accountId) {
      this.logger.error(
        { accountId, payloadAccountId: payload.accountId },
        "Ignoring status with a mismatched Steam account ID",
      );
      return;
    }
    void this.accountOperations
      .run(accountId, async () => {
        if (this.workers.get(accountId) !== worker) {
          this.logger.debug(
            { accountId, status: payload.status },
            "Ignoring status from a stale Steam worker",
          );
          return;
        }
        await this.processWorkerStatus(accountId, payload);
      })
      .catch((error) => {
        this.logger.error(
          errorLogFields(error, { accountId, status: payload.status }),
          "Worker status processing failed",
        );
      });
  }

  private async processWorkerStatus(
    accountId: string,
    payload: WorkerStatusPayload,
  ) {
    const fields = {
      accountId,
      status: payload.status,
      hasError: Boolean(payload.error),
    };

    if (payload.error) {
      this.logger.error({ ...fields, error: payload.error }, "Worker status");
    } else {
      this.logger.info(fields, "Worker status");
    }

    broadcast("status", payload);
    await this.statusEventRecorder.record(payload);
    await trackBoostSession(accountId, payload.status);

    if (
      !payload.error &&
      ACCOUNT_STATUS_CAPABILITIES[payload.status].importable
    ) {
      await this.autoLibraryImporter.import(accountId);
    }
  }

  private clearAccountState(accountId: string) {
    this.accountOperations.clearContext(accountId);
    this.statusEventRecorder.clearAccount(accountId);
    this.autoLibraryImporter.clearAccount(accountId);
    this.scheduleCoordinator.clearAccount(accountId);
  }

  private async closeBoostSession(accountId: string) {
    try {
      await trackBoostSession(accountId, "disconnected");
    } catch (error) {
      this.logger.error(
        errorLogFields(error, { accountId }),
        "Failed to close the tracked boost session",
      );
    }
  }

  tickSchedules(now = new Date()) {
    return this.scheduleCoordinator.tick(now);
  }

  private async resumeOrStartFromScheduleNow(
    accountId: string,
    context: OperationContext,
  ) {
    const account = await getAccountOrThrow(accountId);
    if (account.desiredState === "paused") {
      await this.resumeNow(accountId, context);
      return;
    }
    await this.startNow(accountId, context);
  }

  private async recordInfo(
    accountId: string,
    type: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ) {
    await recordInfoEventSafely({
      accountId,
      type,
      message,
      metadata,
    });
  }

  private async recordError(
    accountId: string,
    type: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ) {
    await recordErrorEventSafely({
      accountId,
      type,
      message,
      metadata,
    });
  }
}

export const steamManager = new SteamManager();
