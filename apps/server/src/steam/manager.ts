import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "@steam-bee/contracts";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  boostPreset,
  boostPresetGame,
  boostSchedule,
  boostSession,
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
  steamEvent,
} from "../db/schema.js";
import {
  broadcast,
  logEventFailure,
  recordErrorEvent,
  recordEvent,
  recordInfoEvent,
} from "../http/events.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { safeErrorMessage } from "../util/redact.js";
import { appError } from "../http/errors.js";
import { evaluateScheduleWindow, selectScheduleWinner } from "./scheduler.js";
import { replaceSelectedGames } from "./repository.js";
import { enforceGameLimit } from "./validation.js";
import { SteamWorker } from "./worker.js";

type WorkerStatusPayload = {
  accountId: string;
  status: string;
  error?: string;
};

export type OperationContext = {
  correlationId?: string;
  source?: string;
  action?: string;
};

type StoredOperationContext = OperationContext & {
  expiresAt: number;
};

type RecordedStatus = {
  signature: string;
  createdAt: number;
};

const operationContextTtlMs = 2 * 60_000;
const statusDedupeWindowMs = 5 * 60_000;

class SteamManager {
  private workers = new Map<string, SteamWorker>();
  private autoImportInFlight = new Set<string>();
  private autoImportDone = new Set<string>();
  private lastOperationContexts = new Map<string, StoredOperationContext>();
  private lastRecordedStatuses = new Map<string, RecordedStatus>();
  private accountQueues = new Map<string, Promise<void>>();
  private activeScheduleWindows = new Map<string, string>();
  private scheduleTimer: NodeJS.Timeout | null = null;
  private shutdownStarted = false;
  private readonly logger = createLogger("steam-manager");

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
    this.startScheduler();
  }

  async start(accountId: string, context: OperationContext = {}) {
    return this.withAccountLock(accountId, () =>
      this.startNow(accountId, context),
    );
  }

  private async startNow(accountId: string, context: OperationContext) {
    this.rememberOperation(accountId, "start", context);
    this.logger.info(
      { accountId, ...this.operationMetadata(accountId) },
      "Starting Steam session",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.start();
    await this.recordInfo(
      accountId,
      "steam.start",
      "Steam session is starting.",
      this.operationMetadata(accountId),
    );
  }

  async stop(accountId: string, context: OperationContext = {}) {
    return this.withAccountLock(accountId, () =>
      this.stopNow(accountId, context),
    );
  }

  private async stopNow(accountId: string, context: OperationContext) {
    this.rememberOperation(accountId, "stop", context);
    this.logger.info(
      { accountId, ...this.operationMetadata(accountId) },
      "Stopping Steam session",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.stop();
    await this.recordInfo(
      accountId,
      "steam.stop",
      "Boosting was stopped.",
      this.operationMetadata(accountId),
    );
  }

  async forget(accountId: string, context: OperationContext = {}) {
    return this.withAccountLock(accountId, () =>
      this.forgetNow(accountId, context),
    );
  }

  private async forgetNow(accountId: string, context: OperationContext) {
    this.rememberOperation(accountId, "forget", context);
    this.logger.info({ accountId }, "Forgetting Steam account worker");
    const worker = this.workers.get(accountId);
    if (worker) {
      await worker.stop();
      worker.removeAllListeners();
      this.workers.delete(accountId);
    }
  }

  async pause(accountId: string, context: OperationContext = {}) {
    return this.withAccountLock(accountId, () =>
      this.pauseNow(accountId, context),
    );
  }

  private async pauseNow(accountId: string, context: OperationContext) {
    this.rememberOperation(accountId, "pause", context);
    this.logger.info(
      { accountId, ...this.operationMetadata(accountId) },
      "Pausing Steam boost",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.pause();
    await this.recordInfo(
      accountId,
      "steam.pause",
      "Boosting was paused.",
      this.operationMetadata(accountId),
    );
  }

  async resume(accountId: string, context: OperationContext = {}) {
    return this.withAccountLock(accountId, () =>
      this.resumeNow(accountId, context),
    );
  }

  private async resumeNow(accountId: string, context: OperationContext) {
    this.rememberOperation(accountId, "resume", context);
    this.logger.info(
      { accountId, ...this.operationMetadata(accountId) },
      "Resuming Steam boost",
    );
    const worker = await this.getWorkerForAccount(accountId);
    await worker.resume();
    await this.recordInfo(
      accountId,
      "steam.resume",
      "Boosting was resumed.",
      this.operationMetadata(accountId),
    );
  }

  async refreshWorker(accountId: string, context: OperationContext = {}) {
    return this.withAccountLock(accountId, () =>
      this.refreshWorkerNow(accountId, context),
    );
  }

  private async refreshWorkerNow(accountId: string, context: OperationContext) {
    this.rememberOperation(accountId, "refresh", context);
    this.logger.debug({ accountId }, "Refreshing Steam worker account state");
    const account = await this.findAccount(accountId);
    const worker = this.getOrCreateWorker(account);
    await worker.updateAccount(account);
  }

  async applyPreset(
    accountId: string,
    presetId: string,
    context: OperationContext = {},
  ) {
    return this.withAccountLock(accountId, () =>
      this.applyPresetNow(accountId, presetId, context),
    );
  }

  private async applyPresetNow(
    accountId: string,
    presetId: string,
    context: OperationContext,
  ) {
    this.rememberOperation(accountId, "preset-apply", context);
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
        ...this.operationMetadata(accountId),
        presetId,
        appCount: appIds.length,
        customTitleEnabled: Boolean(preset.customTitle?.trim()),
      },
    );
    await this.refreshWorkerNow(accountId, context);
  }

  async importLibrary(accountId: string, context: OperationContext = {}) {
    return this.withAccountLock(accountId, () =>
      this.importLibraryNow(accountId, context),
    );
  }

  private async importLibraryNow(accountId: string, context: OperationContext) {
    this.rememberOperation(accountId, "library-import", context);
    const worker = await this.getWorkerForAccount(accountId);
    await this.recordInfo(
      accountId,
      "steam.library.import.start",
      "Library import started.",
      { ...this.operationMetadata(accountId), mode: "manual" },
    );

    try {
      const apps = await worker.importLibrary();
      await this.recordInfo(
        accountId,
        "steam.library.import",
        `${apps.length} games imported.`,
        {
          ...this.operationMetadata(accountId),
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
        { ...this.operationMetadata(accountId), mode: "manual" },
      );
      throw error;
    }
  }

  getStatus(accountId: string) {
    return this.workers.get(accountId)?.currentStatus ?? "disconnected";
  }

  async shutdown() {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    const entries = [...this.workers.entries()];
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
    this.logger.info(
      { workerCount: entries.length },
      "Shutting down Steam workers",
    );
    await Promise.allSettled(this.accountQueues.values());
    await Promise.allSettled(
      entries.map(async ([accountId, worker]) => {
        await worker.shutdown();
        worker.removeAllListeners();
        this.workers.delete(accountId);
      }),
    );
    this.lastOperationContexts.clear();
    this.lastRecordedStatuses.clear();
    this.accountQueues.clear();
    this.activeScheduleWindows.clear();
    this.shutdownStarted = false;
  }

  private async getWorkerForAccount(accountId: string) {
    const account = await this.findAccount(accountId);
    return this.getOrCreateWorker(account);
  }

  private getOrCreateWorker(account: typeof steamAccount.$inferSelect) {
    let worker = this.workers.get(account.id);
    if (!worker) {
      worker = new SteamWorker(account);
      this.logger.debug({ accountId: account.id }, "Created Steam worker");
      worker.on("status", (payload) =>
        this.handleWorkerStatus(account.id, payload),
      );
      this.workers.set(account.id, worker);
    }
    return worker;
  }

  private handleWorkerStatus(accountId: string, payload: WorkerStatusPayload) {
    void this.withAccountLock(accountId, () =>
      this.processWorkerStatus(accountId, payload),
    ).catch((error) => {
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
    await this.recordStatusEvent(accountId, payload);
    await this.trackBoostSession(accountId, payload.status);

    if (
      !payload.error &&
      (payload.status === "online" || payload.status === "boosting")
    ) {
      await this.autoImportLibrary(accountId);
    }
  }

  private withAccountLock<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.accountQueues.get(accountId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.accountQueues.set(accountId, tail);
    void tail.finally(() => {
      if (this.accountQueues.get(accountId) === tail) {
        this.accountQueues.delete(accountId);
      }
    });
    return result;
  }

  private async recordStatusEvent(
    accountId: string,
    payload: WorkerStatusPayload,
  ) {
    const message = steamStatusEventMessage(payload.status, payload.error);
    if (await this.shouldSkipStatusEvent(accountId, payload, message)) return;

    try {
      await recordEvent({
        accountId,
        level: payload.error ? "error" : "info",
        type: "steam.status",
        message,
        metadata: {
          ...this.operationMetadata(accountId),
          status: payload.status,
          hasError: Boolean(payload.error),
        },
      });
    } catch (error) {
      logEventFailure(error, {
        accountId,
        eventType: "steam.status",
        status: payload.status,
      });
    }
  }

  private async autoImportLibrary(accountId: string) {
    if (
      this.autoImportDone.has(accountId) ||
      this.autoImportInFlight.has(accountId)
    ) {
      return;
    }

    this.autoImportInFlight.add(accountId);

    try {
      const existingLibraryEntry = await db
        .select({ appId: steamAccountLibrary.appId })
        .from(steamAccountLibrary)
        .where(eq(steamAccountLibrary.accountId, accountId))
        .limit(1);

      if (existingLibraryEntry.length > 0) {
        this.autoImportDone.add(accountId);
        this.logger.debug(
          { accountId },
          "Skipping auto-import because library already exists",
        );
        return;
      }

      await this.recordInfo(
        accountId,
        "steam.library.import.start",
        "Automatic library import started.",
        { ...this.operationMetadata(accountId), mode: "auto" },
      );

      const worker = await this.getWorkerForAccount(accountId);
      const apps = await worker.importLibrary();
      this.autoImportDone.add(accountId);
      await this.recordInfo(
        accountId,
        "steam.library.import",
        `${apps.length} games imported.`,
        {
          ...this.operationMetadata(accountId),
          appCount: apps.length,
          mode: "auto",
        },
      );
    } catch (error) {
      await this.recordError(
        accountId,
        "steam.library.import.error",
        `Library import failed: ${safeErrorMessage(error)}`,
        { ...this.operationMetadata(accountId), mode: "auto" },
      );
    } finally {
      this.autoImportInFlight.delete(accountId);
    }
  }

  private rememberOperation(
    accountId: string,
    fallbackAction: string,
    context: OperationContext,
  ) {
    const action = context.action ?? fallbackAction;
    if (!context.correlationId && !context.source && !action) return;
    this.lastOperationContexts.set(accountId, {
      ...context,
      action,
      expiresAt: Date.now() + operationContextTtlMs,
    });
  }

  private operationMetadata(accountId: string) {
    const context = this.lastOperationContexts.get(accountId);
    if (!context) return {};
    if (context.expiresAt <= Date.now()) {
      this.lastOperationContexts.delete(accountId);
      return {};
    }
    const { expiresAt, ...metadata } = context;
    void expiresAt;
    return metadata;
  }

  private async shouldSkipStatusEvent(
    accountId: string,
    payload: WorkerStatusPayload,
    message: string,
  ) {
    const signature = `${payload.status}:${payload.error ?? ""}`;
    const now = Date.now();
    const previous = this.lastRecordedStatuses.get(accountId);
    if (
      previous?.signature === signature &&
      now - previous.createdAt < statusDedupeWindowMs
    ) {
      this.logger.debug(
        { accountId, status: payload.status },
        "Skipping duplicate status event",
      );
      return true;
    }

    this.lastRecordedStatuses.set(accountId, {
      signature,
      createdAt: now,
    });
    return this.isRecentStoredStatusDuplicate(
      accountId,
      payload.status,
      message,
      now,
    );
  }

  private async isRecentStoredStatusDuplicate(
    accountId: string,
    status: string,
    message: string,
    now: number,
  ) {
    const [latest] = await db
      .select({
        message: steamEvent.message,
        createdAt: steamEvent.createdAt,
      })
      .from(steamEvent)
      .where(
        and(
          eq(steamEvent.accountId, accountId),
          eq(steamEvent.type, "steam.status"),
        ),
      )
      .orderBy(desc(steamEvent.createdAt))
      .limit(1);

    if (
      latest?.message === message &&
      now - latest.createdAt < statusDedupeWindowMs
    ) {
      this.logger.debug(
        { accountId, status },
        "Skipping recently stored duplicate status event",
      );
      return true;
    }

    return false;
  }

  private async findAccount(accountId: string) {
    const account = await db.query.steamAccount.findFirst({
      where: eq(steamAccount.id, accountId),
    });
    if (!account) {
      throw appError(
        "Steam account was not found.",
        404,
        ERROR_CODES.accountNotFound,
      );
    }
    return account;
  }

  private startScheduler() {
    if (this.scheduleTimer) return;
    this.scheduleTimer = setInterval(() => {
      void this.tickSchedules().catch((error) => {
        this.logger.error(errorLogFields(error), "Schedule tick failed");
      });
    }, 60_000);
    void this.tickSchedules().catch((error) => {
      this.logger.error(errorLogFields(error), "Initial schedule tick failed");
    });
  }

  async tickSchedules(now = new Date()) {
    const schedules = await db.select().from(boostSchedule);
    const byAccount = new Map<
      string,
      Array<{
        schedule: (typeof schedules)[number];
        state: ReturnType<typeof evaluateScheduleWindow> | null;
      }>
    >();

    for (const schedule of schedules) {
      const entries = byAccount.get(schedule.accountId) ?? [];
      let state: ReturnType<typeof evaluateScheduleWindow> | null = null;
      if (schedule.enabled) {
        try {
          state = evaluateScheduleWindow(schedule, now);
        } catch (error) {
          await this.recordError(
            schedule.accountId,
            "steam.schedule.invalid",
            `Schedule "${schedule.name}" was skipped: ${safeErrorMessage(error)}`,
            {
              source: "scheduler",
              action: "schedule-validate",
              scheduleId: schedule.id,
            },
          );
        }
      }
      entries.push({ schedule, state });
      byAccount.set(schedule.accountId, entries);
    }

    for (const accountId of this.activeScheduleWindows.keys()) {
      if (!byAccount.has(accountId)) byAccount.set(accountId, []);
    }

    for (const [accountId, entries] of byAccount) {
      const winner = selectScheduleWinner(entries);
      const previousWindow = this.activeScheduleWindows.get(accountId);

      if (!winner?.state?.windowId) {
        const hadOpenWindow =
          Boolean(previousWindow) ||
          entries.some(
            ({ schedule }) =>
              schedule.lastStartedWindow &&
              schedule.lastStartedWindow !== schedule.lastStoppedWindow,
          );
        if (!hadOpenWindow) continue;

        const context = {
          source: "scheduler",
          action: "schedule-pause",
        };
        try {
          const account = await this.findAccount(accountId);
          if (account.desiredState !== "stopped") {
            await this.pause(accountId, context);
          }
          for (const { schedule } of entries) {
            if (
              schedule.lastStartedWindow &&
              schedule.lastStartedWindow !== schedule.lastStoppedWindow
            ) {
              await db
                .update(boostSchedule)
                .set({ lastStoppedWindow: schedule.lastStartedWindow })
                .where(eq(boostSchedule.id, schedule.id));
            }
          }
          this.activeScheduleWindows.delete(accountId);
          await this.recordInfo(
            accountId,
            "steam.schedule.pause",
            "No schedule window remains active; boosting was paused.",
            context,
          );
        } catch (error) {
          await this.recordError(
            accountId,
            "steam.schedule.error",
            `Schedules could not pause: ${safeErrorMessage(error)}`,
            context,
          );
        }
        continue;
      }

      const nextWindow = winner.state.windowId;
      if (previousWindow === nextWindow) continue;

      if (
        !previousWindow &&
        winner.schedule.lastStartedWindow === winner.state.windowId
      ) {
        this.activeScheduleWindows.set(accountId, nextWindow);
        continue;
      }

      const context = {
        source: "scheduler",
        action: "schedule-start",
        scheduleId: winner.schedule.id,
        presetId: winner.schedule.presetId,
      };
      try {
        await this.applyPreset(accountId, winner.schedule.presetId, context);
        await db
          .update(boostSchedule)
          .set({ lastStartedWindow: winner.state.windowId })
          .where(eq(boostSchedule.id, winner.schedule.id));
        await this.resumeOrStartFromSchedule(accountId, context);
        await this.closePreviousScheduleWindow(previousWindow);
        this.activeScheduleWindows.set(accountId, nextWindow);
        await this.recordInfo(
          accountId,
          "steam.schedule.start",
          `Schedule "${winner.schedule.name}" started.`,
          context,
        );
      } catch (error) {
        await this.recordError(
          accountId,
          "steam.schedule.error",
          `Schedule could not start: ${safeErrorMessage(error)}`,
          context,
        );
      }
    }
  }

  private async closePreviousScheduleWindow(previousWindow?: string) {
    if (!previousWindow) return;
    const scheduleId = previousWindow.slice(0, previousWindow.indexOf(":"));
    const schedule = await db.query.boostSchedule.findFirst({
      where: eq(boostSchedule.id, scheduleId),
    });
    if (!schedule?.lastStartedWindow) return;
    await db
      .update(boostSchedule)
      .set({ lastStoppedWindow: schedule.lastStartedWindow })
      .where(eq(boostSchedule.id, scheduleId));
  }

  private async resumeOrStartFromSchedule(
    accountId: string,
    context: OperationContext,
  ) {
    const account = await this.findAccount(accountId);
    if (account.desiredState === "paused") {
      await this.resume(accountId, context);
      return;
    }
    await this.start(accountId, context);
  }

  private async trackBoostSession(accountId: string, status: string) {
    if (status === "boosting") {
      await this.startBoostSession(accountId);
      return;
    }
    await this.endBoostSession(accountId, status);
  }

  private async startBoostSession(accountId: string) {
    const existing = await db
      .select()
      .from(boostSession)
      .where(
        and(
          eq(boostSession.accountId, accountId),
          isNull(boostSession.endedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    const [account] = await db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.id, accountId))
      .limit(1);
    if (!account) return;

    let activePresetId = account.activePresetId;
    if (activePresetId) {
      const activePreset = await db.query.boostPreset.findFirst({
        where: and(
          eq(boostPreset.id, activePresetId),
          eq(boostPreset.accountId, accountId),
        ),
      });
      if (!activePreset) {
        activePresetId = null;
        await db
          .update(steamAccount)
          .set({ activePresetId: null, updatedAt: Date.now() })
          .where(eq(steamAccount.id, accountId));
      }
    }

    const games = await db
      .select()
      .from(steamAccountGame)
      .where(eq(steamAccountGame.accountId, accountId));
    const appIds = games
      .filter((game) => game.enabled)
      .map((game) => game.appId);
    await db.insert(boostSession).values({
      id: randomUUID(),
      accountId,
      presetId: activePresetId,
      appIdsJson: JSON.stringify(appIds),
      startedAt: Date.now(),
      endedAt: null,
      stopReason: null,
      createdAt: Date.now(),
    });
    await this.recordInfo(
      accountId,
      "steam.boost.session.start",
      "Boost session started.",
      {
        appCount: appIds.length,
        presetId: activePresetId,
      },
    );
  }

  private async endBoostSession(accountId: string, reason: string) {
    const openSessions = await db
      .select()
      .from(boostSession)
      .where(
        and(
          eq(boostSession.accountId, accountId),
          isNull(boostSession.endedAt),
        ),
      );
    if (openSessions.length === 0) return;

    const endedAt = Date.now();
    for (const session of openSessions) {
      await db
        .update(boostSession)
        .set({ endedAt, stopReason: reason })
        .where(eq(boostSession.id, session.id));
    }
    await this.recordInfo(
      accountId,
      "steam.boost.session.end",
      "Boost session ended.",
      {
        reason,
        sessionCount: openSessions.length,
      },
    );
  }

  private async recordInfo(
    accountId: string,
    type: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ) {
    await recordInfoEvent({
      accountId,
      type,
      message,
      metadata,
    }).catch((error) => {
      logEventFailure(error, { accountId, eventType: type });
    });
  }

  private async recordError(
    accountId: string,
    type: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ) {
    await recordErrorEvent({
      accountId,
      type,
      message,
      metadata,
    }).catch((error) => {
      logEventFailure(error, { accountId, eventType: type });
    });
  }
}

export const steamManager = new SteamManager();

function steamStatusEventMessage(status: string, error?: string) {
  if (error) {
    return `${statusLabel(status)}: ${error}`;
  }

  const messages: Record<string, string> = {
    disconnected: "Steam session is disconnected.",
    connecting: "Steam connection is starting.",
    online: "Steam session is online.",
    boosting: "Active game selection is being reported to Steam.",
    paused_manual: "Boosting was paused manually.",
    paused_other_session: "Paused because another Steam client is active.",
    login_required: "Steam login must be renewed.",
    reconnecting: "Steam connection is reconnecting.",
    error: "Steam session is in an error state.",
  };
  return messages[status] ?? `Steam status: ${status}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    disconnected: "Not connected",
    connecting: "Connecting",
    online: "Online",
    boosting: "Boosting active",
    paused_manual: "Paused manually",
    paused_other_session: "Another Steam client active",
    login_required: "Login required",
    reconnecting: "Reconnect",
    error: "Error",
  };
  return labels[status] ?? status;
}
