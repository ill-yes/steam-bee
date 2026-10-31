import {
  ACCOUNT_STATUS_CAPABILITIES,
  ERROR_CODES,
  gameSelectionLimit,
} from "@steam-bee/contracts";
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
import {
  closeInterruptedBoostSessions,
  markOpenBoostSessionsSeen,
  trackBoostSession,
} from "./boost-session-tracker.js";

const boostSessionHeartbeatMs = 60_000;
import { SteamStatusEventRecorder } from "./status-event-recorder.js";
import { AccountOperationState } from "./account-operation-state.js";
import type { WorkerStatusPayload } from "./types.js";
import { ScheduleCoordinator } from "./schedule-coordinator.js";
import { scheduleRepository } from "./schedule-repository.js";
import { AutoLibraryImporter } from "./auto-library-importer.js";
import {
  clearRecoveryHealth,
  clearSafetyHold,
  getAccountSafetyPolicy,
  getActiveAutomationHold,
  getSafetyHoldOwner,
  setSafetyHold,
} from "./operations-repository.js";
import { SafetyCoordinator } from "./safety-coordinator.js";
import { closeWithLeaseCleanup } from "../startup.js";
import {
  farmingController,
  farmingResumesAfterRestart,
  resumeInterruptedFarming,
} from "../farming/service.js";
import { stopAccountBatches, shutdownBatches } from "../inventory/runtime.js";

class SteamManager {
  private workers = new Map<string, SteamWorker>();
  private farmingCleanupAccounts = new Set<string>();
  private safetyResumeTimers = new Map<string, NodeJS.Timeout>();
  private boostSessionHeartbeat: NodeJS.Timeout | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private quiescing = false;
  private terminalShutdown = false;
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
      this.runAccountOperation(accountId, operation),
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
    getActiveHold: (accountId) => getActiveAutomationHold(accountId),
  });
  private readonly safetyCoordinator = new SafetyCoordinator({
    runForAccount: (accountId, operation) =>
      this.runAccountOperation(accountId, operation),
    pause: (accountId, context) => this.pauseForSafety(accountId, context),
    recordInfo: (accountId, type, message, metadata) =>
      this.recordInfo(accountId, type, message, metadata),
    onTickError: (error) => {
      this.logger.error(errorLogFields(error), "Safety limit tick failed");
    },
  });

  async init() {
    farmingController.initialize();
    // Sessions still open here were cut off by a crash or kill, not boosted.
    const interrupted = await closeInterruptedBoostSessions();
    if (interrupted > 0)
      this.logger.warn(
        { sessionCount: interrupted },
        "Closed boost sessions left open by an unexpected stop",
      );
    const accounts = await db.select().from(steamAccount);
    this.logger.info(
      { accountCount: accounts.length },
      "Initializing Steam workers",
    );
    for (const account of accounts) this.getOrCreateWorker(account);

    await this.scheduleCoordinator.tick(new Date());

    const reconciledAccounts = await db.select().from(steamAccount);
    for (const account of reconciledAccounts) {
      const worker = this.getOrCreateWorker(account);
      const policy = await getAccountSafetyPolicy(account.id);
      if (policy.holdReason === "pause_until" && policy.pauseUntil !== null) {
        this.logger.info(
          {
            accountId: account.id,
            holdReason: policy.holdReason,
            until: policy.pauseUntil,
          },
          "Restoring a timed safety hold",
        );
        this.scheduleSafetyResume(
          account.id,
          policy.pauseUntil,
          policy.holdReason,
        );
        continue;
      }
      if (account.desiredState === "running") {
        const hold = await getActiveAutomationHold(account.id);
        if (hold) {
          this.logger.info(
            {
              accountId: account.id,
              holdReason: hold.reason,
              until: hold.until,
            },
            "Deferring account auto-start because an operational hold is active",
          );
          continue;
        }
        await clearRecoveryHealth(account.id);
        this.logger.info({ accountId: account.id }, "Auto-starting account");
        void worker.start().catch((error) => {
          this.logger.error(
            errorLogFields(error, { accountId: account.id }),
            "Auto-start failed",
          );
        });
      }
    }
    this.scheduleCoordinator.start({ runInitialTick: false });
    this.safetyCoordinator.start();
    this.startBoostSessionHeartbeat();
  }

  private startBoostSessionHeartbeat() {
    if (this.boostSessionHeartbeat) return;
    this.boostSessionHeartbeat = setInterval(() => {
      markOpenBoostSessionsSeen().catch((error) => {
        this.logger.error(
          errorLogFields(error),
          "Failed to stamp open boost sessions",
        );
      });
    }, boostSessionHeartbeatMs);
    this.boostSessionHeartbeat.unref();
  }

  private stopBoostSessionHeartbeat() {
    if (this.boostSessionHeartbeat) clearInterval(this.boostSessionHeartbeat);
    this.boostSessionHeartbeat = null;
  }

  runAccountOperation<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.quiescing)
      return Promise.reject(new Error("Steam manager is shutting down."));
    return this.accountOperations.run(accountId, async () => {
      if (this.quiescing) throw new Error("Steam manager is shutting down.");
      return operation();
    });
  }

  async start(accountId: string, context: OperationContext = {}) {
    const worker = this.workers.get(accountId);
    // Preserve supervision when an already-running farm receives a redundant start.
    if (
      worker?.isConnected &&
      worker.isFarming &&
      ["online", "boosting"].includes(worker.currentStatus)
    )
      return;
    return this.runFarmingInterruption(accountId, "manual-start", () =>
      this.startNow(accountId, context),
    );
  }

  private async startNow(
    accountId: string,
    context: OperationContext,
    options: { preserveSafetyHold?: boolean } = {},
  ) {
    const worker = await this.getWorkerForAccount(accountId);
    this.clearSafetyResume(accountId);
    this.accountOperations.remember(accountId, "start", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Starting Steam session",
    );
    if (!options.preserveSafetyHold) await clearSafetyHold(accountId);
    await clearRecoveryHealth(accountId);
    await worker.start();
    await this.recordInfo(
      accountId,
      "steam.start",
      "Steam session is starting.",
      this.accountOperations.metadata(accountId),
    );
  }

  async stop(accountId: string, context: OperationContext = {}) {
    stopAccountBatches(accountId);
    return this.runFarmingInterruption(accountId, "stopped", () =>
      this.stopNow(accountId, context),
    );
  }

  private async stopNow(accountId: string, context: OperationContext) {
    const worker = await this.getWorkerForAccount(accountId);
    this.clearSafetyResume(accountId);
    this.accountOperations.remember(accountId, "stop", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Stopping Steam session",
    );
    await worker.stop();
    await this.recordInfo(
      accountId,
      "steam.stop",
      "Boosting was stopped.",
      this.accountOperations.metadata(accountId),
    );
  }

  async forget(accountId: string, context: OperationContext = {}) {
    stopAccountBatches(accountId);
    this.haltFarming(accountId, "account-removed");
    return this.runAccountOperation(accountId, () =>
      this.forgetNow(accountId, context),
    );
  }

  async deleteAccount(accountId: string, context: OperationContext = {}) {
    stopAccountBatches(accountId);
    this.haltFarming(accountId, "account-removed");
    return this.runAccountOperation(accountId, async () => {
      await this.forgetNow(accountId, context);
      await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
    });
  }

  private async forgetNow(accountId: string, context: OperationContext) {
    this.accountOperations.remember(accountId, "forget", context);
    this.logger.info({ accountId }, "Forgetting Steam account worker");
    const worker = this.workers.get(accountId);
    let safelyClosed = !worker;
    try {
      if (worker) {
        worker.removeAllListeners("status");
        await closeWithLeaseCleanup(
          {
            close: async () => {
              try {
                await worker.stop();
              } finally {
                await worker.shutdown();
                safelyClosed = true;
              }
            },
          },
          { release: () => undefined },
        );
      }
    } finally {
      // A timed-out transport must retain its quiesced worker, never admit a replacement.
      if (safelyClosed) {
        await this.closeBoostSession(accountId);
        if (worker) {
          worker.removeAllListeners();
          this.workers.delete(accountId);
        }
        this.clearAccountState(accountId);
      } else {
        worker?.beginShutdown();
      }
    }
  }

  async pause(accountId: string, context: OperationContext = {}) {
    stopAccountBatches(accountId);
    return this.runFarmingInterruption(accountId, "paused", () =>
      this.pauseNow(accountId, context),
    );
  }

  async pauseUntil(
    accountId: string,
    until: number,
    context: OperationContext = {},
  ) {
    return this.runAccountOperation(accountId, async () => {
      const account = await getAccountOrThrow(accountId);
      if (account.desiredState !== "running") {
        throw appError(
          "Only a running account can be paused until a later time.",
          409,
          ERROR_CODES.conflict,
        );
      }

      const owner = await this.scheduleCoordinator.getHoldOwner(accountId);
      await setSafetyHold(accountId, "pause_until", until, owner);
      await this.pauseForSafety(accountId, {
        ...context,
        source: "safety",
        action: "pause-until",
        until,
      });
      const policy = await getAccountSafetyPolicy(accountId);
      if (policy.holdReason === "pause_until") {
        this.scheduleSafetyResume(accountId, until, "pause_until");
      }
    });
  }

  private async pauseNow(
    accountId: string,
    context: OperationContext,
    shouldPause: () => boolean = () => true,
  ) {
    if (!shouldPause()) return;
    stopAccountBatches(accountId);
    if (context.source !== "farming") this.haltFarming(accountId, "paused");
    const worker = await this.getWorkerForAccount(accountId);
    if (!shouldPause()) return;
    this.clearSafetyResume(accountId);
    this.accountOperations.remember(accountId, "pause", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Pausing Steam boost",
    );
    if (context.source !== "scheduler" && context.source !== "safety") {
      await setSafetyHold(accountId, "manual");
      this.scheduleCoordinator.clearAccount(accountId);
    }
    if (!shouldPause()) return;
    await worker.pause(shouldPause);
    if (!shouldPause()) return;
    await this.recordInfo(
      accountId,
      "steam.pause",
      "Boosting was paused.",
      this.accountOperations.metadata(accountId),
    );
  }

  private async pauseForSafety(
    accountId: string,
    context: OperationContext,
    shouldPause: () => boolean = () => true,
  ) {
    if (!shouldPause()) return;
    const worker =
      this.workers.get(accountId) ??
      (await this.getWorkerForAccount(accountId));
    if (!shouldPause()) return;
    try {
      await this.pauseNow(accountId, context, shouldPause);
      return;
    } catch (pauseError) {
      if (!shouldPause()) return;
      const pauseMessage = safeErrorMessage(pauseError);
      try {
        await worker.forceDisconnectForSafety(
          "SteamBee force-disconnected after the safety pause failed.",
          shouldPause,
        );
        if (!shouldPause()) return;
        await this.recordError(
          accountId,
          "steam.safety.fallback",
          `Safety pause failed; SteamBee force-disconnected its client: ${pauseMessage}`,
          context,
        );
        return;
      } catch (disconnectError) {
        if (!shouldPause()) return;
        const disconnectMessage = safeErrorMessage(disconnectError);
        await setSafetyHold(accountId, "safety_failure");
        await worker.markSafetyAttention(
          "Safety enforcement could not confirm that the Steam client stopped.",
        );
        await this.recordError(
          accountId,
          "steam.safety.failure",
          `Safety enforcement failed and needs attention: ${disconnectMessage}`,
          {
            ...context,
            pauseError: pauseMessage,
          },
        );
        throw disconnectError;
      }
    }
  }

  async resume(accountId: string, context: OperationContext = {}) {
    return this.runFarmingInterruption(accountId, "manual-resume", () =>
      this.resumeNow(accountId, context),
    );
  }

  private async resumeNow(accountId: string, context: OperationContext) {
    const worker = await this.getWorkerForAccount(accountId);
    this.clearSafetyResume(accountId);
    this.accountOperations.remember(accountId, "resume", context);
    this.logger.info(
      { accountId, ...this.accountOperations.metadata(accountId) },
      "Resuming Steam boost",
    );
    await clearSafetyHold(accountId);
    await clearRecoveryHealth(accountId);
    await worker.resume();
    await this.recordInfo(
      accountId,
      "steam.resume",
      "Boosting was resumed.",
      this.accountOperations.metadata(accountId),
    );
  }

  async refreshWorker(accountId: string, context: OperationContext = {}) {
    return this.runFarmingInterruption(accountId, "settings-changed", () =>
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
    return this.runFarmingInterruption(accountId, "preset-applied", () =>
      this.applyPresetNow(accountId, presetId, context),
    );
  }

  private async applyPresetNow(
    accountId: string,
    presetId: string,
    context: OperationContext,
  ) {
    this.haltFarming(accountId, "preset-applied");
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
    return this.runAccountOperation(accountId, () =>
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

  getActivity(accountId: string) {
    return (
      this.workers.get(accountId)?.getActivity() ?? {
        activityMode: "idle" as const,
        activeAppIds: [] as number[],
      }
    );
  }

  getStatus(accountId: string) {
    return this.workers.get(accountId)?.currentStatus ?? "disconnected";
  }

  async getCommunitySession(accountId: string) {
    const worker = await this.getWorkerForAccount(accountId);
    return worker.getCommunitySession();
  }

  /** The next Community request signs in again instead of reusing rejected cookies. */
  discardCommunitySession(accountId: string, sessionId: string) {
    this.workers.get(accountId)?.discardCommunitySession(sessionId);
  }

  async getAcquisitionTimes(accountId: string, appIds: number[]) {
    const worker = await this.getWorkerForAccount(accountId);
    return worker.acquisitionTimes(appIds);
  }

  async getFarmingAvailability(accountId: string) {
    const account = await getAccountOrThrow(accountId);
    const worker = this.workers.get(accountId);
    const hold = await getActiveAutomationHold(accountId);
    const reason = this.quiescing
      ? "shutting_down"
      : hold
        ? hold.reason
        : account.desiredState !== "running"
          ? "not_running"
          : !worker?.isConnected ||
              !["online", "boosting"].includes(worker.currentStatus)
            ? "not_connected"
            : null;
    return {
      allowed: reason === null,
      reason,
      // A manual pause or stop is no obstacle: starting farming resumes the session.
      resumable:
        !this.quiescing &&
        (hold === null || hold.reason === "manual") &&
        account.desiredState !== "running",
      gameLimit: gameSelectionLimit(account.customTitle),
    };
  }

  /** Resumes a manually paused or stopped account so card farming can start. */
  async resumeForFarming(
    accountId: string,
    context: OperationContext = {},
    timeoutMs = 30_000,
  ) {
    const resumed = await this.runAccountOperation(accountId, async () => {
      const availability = await this.getFarmingAvailability(accountId);
      if (availability.allowed || !availability.resumable) return false;
      const worker = await this.getWorkerForAccount(accountId);
      this.clearSafetyResume(accountId);
      this.accountOperations.remember(accountId, "resume", context);
      await clearSafetyHold(accountId);
      await clearRecoveryHealth(accountId);
      await worker.resumeForFarming();
      await this.recordInfo(
        accountId,
        "steam.resume",
        "The account was resumed for card farming.",
        this.accountOperations.metadata(accountId),
      );
      return true;
    });
    if (!resumed) return this.getFarmingAvailability(accountId);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const availability = await this.getFarmingAvailability(accountId);
      if (availability.allowed || Date.now() >= deadline) return availability;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async beginFarming(
    accountId: string,
    shouldApply: () => boolean = () => true,
  ) {
    // Reserve the single Steam activity stream before the asynchronous badge scan.
    // The persisted manual selection remains available for an explicit resume.
    return this.applyFarmingGames(accountId, [], shouldApply);
  }

  async applyFarmingGames(
    accountId: string,
    appIds: number[],
    shouldApply: () => boolean = () => true,
  ) {
    return this.runAccountOperation(accountId, async () => {
      const availability = await this.getFarmingAvailability(accountId);
      if (!shouldApply() || !availability.allowed)
        throw appError("The account is unavailable for card farming.", 409);
      const worker = await this.getWorkerForAccount(accountId);
      if (!shouldApply()) return;
      await worker.applyFarmingSelection(appIds, shouldApply);
    });
  }

  async endFarming(accountId: string, shouldEnd: () => boolean = () => true) {
    if (!shouldEnd()) return;
    return this.runAccountOperation(accountId, async () => {
      const worker = this.workers.get(accountId);
      // Stopping a read-only badge preview must not pause manual playtime idling.
      if (!shouldEnd() || !worker?.isFarming) return;
      this.farmingCleanupAccounts.add(accountId);
      try {
        await this.pauseForSafety(
          accountId,
          {
            source: "farming",
            action: "farming-stop",
          },
          shouldEnd,
        );
      } finally {
        this.farmingCleanupAccounts.delete(accountId);
      }
      if (!shouldEnd()) return;
      await this.recordInfo(
        accountId,
        "steam.farming.stop",
        "Card farming stopped; the account was paused.",
        { source: "manual", action: "farming-stop" },
      );
    });
  }

  private haltFarming(
    accountId: string,
    reason: string,
    keepAwaitingFarming = false,
  ) {
    farmingController.halt(accountId, reason);
    this.workers.get(accountId)?.clearFarmingSelection(keepAwaitingFarming);
  }

  private runFarmingInterruption<T>(
    accountId: string,
    reason: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const wasFarming = this.workers.get(accountId)?.isFarming ?? false;
    this.haltFarming(accountId, reason);
    return this.runAccountOperation(accountId, async () => {
      try {
        return await operation();
      } catch (error) {
        if (wasFarming) {
          try {
            await this.pauseForSafety(accountId, {
              source: "manual",
              action: "farming-interrupted",
            });
          } catch {
            this.logger.error(
              { accountId },
              "Farming interruption required a disconnect; inspect the account safety hold",
            );
          }
        }
        throw error;
      }
    });
  }

  beginShutdown(terminal = false) {
    farmingController.beginShutdown();
    shutdownBatches();
    this.terminalShutdown ||= terminal;
    this.quiescing = true;
    this.clearAllSafetyResumes();
    for (const worker of this.workers.values()) worker.beginShutdown();
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.beginShutdown();
    const shutdownPromise = this.shutdownNow().finally(() => {
      if (this.shutdownPromise === shutdownPromise) {
        this.shutdownPromise = null;
        this.quiescing = this.terminalShutdown;
      }
    });
    this.shutdownPromise = shutdownPromise;
    return shutdownPromise;
  }

  private async shutdownNow() {
    this.clearAllSafetyResumes();
    this.stopBoostSessionHeartbeat();
    const entries = [...this.workers.entries()];
    this.logger.info(
      { workerCount: entries.length },
      "Shutting down Steam workers",
    );
    for (const [, worker] of entries) {
      worker.removeAllListeners("status");
      worker.beginShutdown();
    }
    await this.scheduleCoordinator.stop();
    await this.safetyCoordinator.stop();
    await this.accountOperations.drain();
    const shutdownErrors: unknown[] = [];
    await Promise.all(
      entries.map(async ([accountId, worker]) => {
        try {
          await worker.shutdown();
        } catch (error) {
          shutdownErrors.push(error);
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
    if (shutdownErrors.length > 0) {
      throw new AggregateError(
        shutdownErrors,
        "One or more Steam workers failed to shut down cleanly.",
      );
    }
  }

  private async getWorkerForAccount(accountId: string) {
    const account = await getAccountOrThrow(accountId);
    return this.getOrCreateWorker(account);
  }

  private getOrCreateWorker(account: typeof steamAccount.$inferSelect) {
    if (this.quiescing) throw new Error("Steam manager is shutting down.");
    let worker = this.workers.get(account.id);
    if (!worker) {
      const createdWorker = new SteamWorker(account, {
        runAccountOperation: (operation) =>
          this.runAccountOperation(account.id, operation),
        farmingResumesAfterShutdown: () =>
          farmingResumesAfterRestart(account.id),
        recordSessionConflict: ({ source: conflictSource, ...input }) =>
          this.recordInfo(
            account.id,
            "steam.session.conflict",
            input.cooldown
              ? "Another Steam session is still active; retrying after a 60-minute cooldown."
              : `Another Steam session is active; retry ${input.attempt} of 3 is scheduled.`,
            {
              source: "recovery",
              action: "session-conflict-retry",
              conflictSource,
              ...input,
            },
          ),
      });
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
    if (this.workers.get(accountId) !== worker) return;
    if (payload.accountId !== accountId) {
      this.logger.error(
        { accountId, payloadAccountId: payload.accountId },
        "Ignoring status with a mismatched Steam account ID",
      );
      return;
    }
    if (!["online", "boosting"].includes(payload.status)) {
      // A successful farming cleanup must not invalidate its own generation.
      if (!(
        payload.status === "paused_manual" &&
        this.farmingCleanupAccounts.has(accountId)
      )) {
        // A reconnect keeps manual games off until interrupted farming resumes.
        this.haltFarming(accountId, payload.status, true);
      }
      stopAccountBatches(accountId);
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
      .then(() => {
        if (!["online", "boosting"].includes(payload.status)) return;
        if (this.workers.get(accountId) !== worker || this.quiescing) return;
        // Outside the account queue: farming takes the queue itself.
        void resumeInterruptedFarming(accountId).catch((error) => {
          this.logger.warn(
            errorLogFields(error, { accountId }),
            "Interrupted card farming could not resume",
          );
        });
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
    await trackBoostSession(accountId, payload.status, payload);

    if (
      !payload.error &&
      ACCOUNT_STATUS_CAPABILITIES[payload.status].importable
    ) {
      await this.autoLibraryImporter.import(accountId);
    }
  }

  private clearAccountState(accountId: string) {
    this.clearSafetyResume(accountId);
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

  tickSafety(now = Date.now()) {
    return this.safetyCoordinator.tick(now);
  }

  invalidateSchedules(accountId: string) {
    this.scheduleCoordinator.clearAccount(accountId);
  }

  private scheduleSafetyResume(
    accountId: string,
    resumeAt: number,
    expectedReason: "pause_until",
  ) {
    this.clearSafetyResume(accountId);
    const delay = Math.max(0, Math.min(resumeAt - Date.now(), 2_147_483_647));
    const timer = setTimeout(() => {
      this.safetyResumeTimers.delete(accountId);
      void this.accountOperations
        .run(accountId, async () => {
          const policy = await getAccountSafetyPolicy(accountId);
          if (policy.holdReason !== expectedReason) return;
          if (policy.pauseUntil !== null && policy.pauseUntil > Date.now()) {
            this.scheduleSafetyResume(
              accountId,
              policy.pauseUntil,
              expectedReason,
            );
            return;
          }
          const account = await getAccountOrThrow(accountId);
          if (account.desiredState !== "paused") {
            await clearSafetyHold(accountId);
            return;
          }
          if (
            expectedReason === "pause_until" &&
            !(await this.scheduleCoordinator.canResumeHeldAccount(
              accountId,
              await getSafetyHoldOwner(accountId),
            ))
          ) {
            await clearSafetyHold(accountId);
            return;
          }

          const context = {
            source: "safety",
            action: "pause-until-expired",
          } satisfies OperationContext;
          const worker = await this.getWorkerForAccount(accountId);
          await clearSafetyHold(accountId);
          if (worker.isConnected) {
            await this.resumeNow(accountId, context);
          } else {
            await this.startNow(accountId, context);
          }
        })
        .catch((error) => {
          this.logger.error(
            errorLogFields(error, { accountId }),
            "Delayed safety resume after restart failed",
          );
        });
    }, delay);
    timer.unref();
    this.safetyResumeTimers.set(accountId, timer);
  }

  private clearSafetyResume(accountId: string) {
    const timer = this.safetyResumeTimers.get(accountId);
    if (timer) clearTimeout(timer);
    this.safetyResumeTimers.delete(accountId);
  }

  private clearAllSafetyResumes() {
    for (const timer of this.safetyResumeTimers.values()) clearTimeout(timer);
    this.safetyResumeTimers.clear();
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
