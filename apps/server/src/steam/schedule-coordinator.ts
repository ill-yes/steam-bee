import type { OperationContext } from "../operation-context.js";
import { safeErrorMessage } from "../util/redact.js";
import { evaluateScheduleWindow, selectScheduleWinner } from "./scheduler.js";
import type {
  OpenScheduleWindow,
  ScheduleRecord,
  ScheduleRepository,
} from "./schedule-repository.js";
import type { SafetyHoldOwner } from "./operations-repository.js";

type ScheduleEntry = {
  schedule: ScheduleRecord;
  state: ReturnType<typeof evaluateScheduleWindow> | null;
};

type ScheduleEventWriter = (
  accountId: string,
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

export type ScheduleCoordinatorPorts = {
  repository: ScheduleRepository;
  runForAccount: <T>(
    accountId: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
  getDesiredState: (accountId: string) => Promise<string>;
  applyPreset: (
    accountId: string,
    presetId: string,
    context: OperationContext,
  ) => Promise<void>;
  pause: (accountId: string, context: OperationContext) => Promise<void>;
  resumeOrStart: (
    accountId: string,
    context: OperationContext,
  ) => Promise<void>;
  recordInfo: ScheduleEventWriter;
  recordError: ScheduleEventWriter;
  onTickError: (error: unknown, phase: "initial" | "interval") => void;
  getActiveHold?: (
    accountId: string,
  ) => Promise<{ reason: string; until: number | null } | null>;
};

const scheduleIntervalMs = 60_000;
const maxRetryDelayMs = 60 * 60_000;

type FailedTransition = {
  key: string;
  failures: number;
  retryAt: number;
};

export class ScheduleCoordinator {
  private readonly activeWindows = new Map<string, string>();
  // A start or pause that keeps failing waits 1, 2, 4 … 60 minutes between
  // attempts instead of retrying (and logging an error) on every tick.
  private readonly failedTransitions = new Map<string, FailedTransition>();
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight: Promise<void> | null = null;
  private trailingTickAt: Date | null = null;
  private latestRequestedTickAt: Date | null = null;

  constructor(private readonly ports: ScheduleCoordinatorPorts) {}

  start(options: { runInitialTick?: boolean } = {}) {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.runScheduledTick("interval");
    }, scheduleIntervalMs);
    if (options.runInitialTick !== false) this.runScheduledTick("initial");
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.tickInFlight?.catch(() => undefined);
  }

  tick(now = new Date()): Promise<void> {
    if (this.tickInFlight) {
      if (
        !this.latestRequestedTickAt ||
        now.getTime() > this.latestRequestedTickAt.getTime()
      ) {
        this.latestRequestedTickAt = now;
        this.trailingTickAt = now;
      }
      return this.tickInFlight;
    }

    this.latestRequestedTickAt = now;
    const tick = this.runTickLoop(now).finally(() => {
      if (this.tickInFlight === tick) {
        this.tickInFlight = null;
        this.trailingTickAt = null;
        this.latestRequestedTickAt = null;
      }
    });
    this.tickInFlight = tick;
    return tick;
  }

  clearAccount(accountId: string) {
    this.activeWindows.delete(accountId);
    this.failedTransitions.delete(accountId);
  }

  clearAll() {
    this.activeWindows.clear();
    this.failedTransitions.clear();
  }

  private isBackingOff(accountId: string, key: string, now: Date) {
    const failed = this.failedTransitions.get(accountId);
    return failed?.key === key && now.getTime() < failed.retryAt;
  }

  private recordTransitionFailure(accountId: string, key: string, now: Date) {
    const previous = this.failedTransitions.get(accountId);
    const failures = previous?.key === key ? previous.failures + 1 : 1;
    const delayMs = Math.min(
      scheduleIntervalMs * 2 ** (failures - 1),
      maxRetryDelayMs,
    );
    this.failedTransitions.set(accountId, {
      key,
      failures,
      retryAt: now.getTime() + delayMs,
    });
    return { failures, retryAt: now.getTime() + delayMs };
  }

  async getHoldOwner(
    accountId: string,
    now = new Date(),
  ): Promise<SafetyHoldOwner> {
    const schedules =
      await this.ports.repository.listSchedulesForAccount(accountId);
    const entries = await this.evaluateSchedules(schedules, now);
    const winner = selectScheduleWinner(entries);
    if (winner?.state?.windowId) {
      return {
        kind: "scheduled",
        scheduleId: winner.schedule.id,
        windowId: winner.state.windowId,
      };
    }
    const openWindows = openScheduleWindows(entries);
    if (openWindows.length === 0) return { kind: "unscheduled" };

    const inMemoryWindow = this.activeWindows.get(accountId);
    const inMemoryOwner = openWindows.find(
      (window) => window.windowId === inMemoryWindow,
    );
    if (inMemoryOwner) return scheduledOwner(inMemoryOwner);

    return scheduledOwner(
      openWindows.sort((left, right) =>
        `${left.scheduleId}:${left.windowId}`.localeCompare(
          `${right.scheduleId}:${right.windowId}`,
        ),
      )[0]!,
    );
  }

  async canResumeHeldAccount(
    accountId: string,
    owner: SafetyHoldOwner,
    now = new Date(),
  ) {
    if (owner.kind === "unscheduled") return true;
    if (owner.kind === "unknown") return false;

    const schedules =
      await this.ports.repository.listSchedulesForAccount(accountId);
    const entries = await this.evaluateSchedules(schedules, now);
    const winner = selectScheduleWinner(entries);
    return Boolean(
      winner?.schedule.id === owner.scheduleId &&
      winner.state?.windowId === owner.windowId,
    );
  }

  private runScheduledTick(phase: "initial" | "interval") {
    void this.tick().catch((error) => this.ports.onTickError(error, phase));
  }

  private async runTickLoop(initialNow: Date) {
    let now = initialNow;
    while (true) {
      await this.tickNow(now);
      const trailingTickAt = this.trailingTickAt;
      this.trailingTickAt = null;
      if (!trailingTickAt) return;
      now = trailingTickAt;
    }
  }

  private async tickNow(now: Date) {
    const accountIds = new Set(await this.ports.repository.listAccountIds());
    for (const accountId of this.activeWindows.keys())
      accountIds.add(accountId);

    const transitions = await Promise.allSettled(
      [...accountIds].map((accountId) =>
        this.ports.runForAccount(accountId, async () => {
          const schedules =
            await this.ports.repository.listSchedulesForAccount(accountId);
          const entries = await this.evaluateSchedules(schedules, now);
          await this.transitionAccount(accountId, entries, now);
        }),
      ),
    );
    const failedTransition = transitions.find(
      (transition): transition is PromiseRejectedResult =>
        transition.status === "rejected",
    );
    if (failedTransition) throw failedTransition.reason;
  }

  private async evaluateSchedules(schedules: ScheduleRecord[], now: Date) {
    const entries: ScheduleEntry[] = [];
    for (const schedule of schedules) {
      let state: ReturnType<typeof evaluateScheduleWindow> | null = null;
      if (schedule.enabled) {
        try {
          state = evaluateScheduleWindow(schedule, now);
          if (
            state.windowId &&
            (await this.ports.repository.isWindowSkipped?.(
              schedule.accountId,
              schedule.id,
              state.windowId,
            ))
          ) {
            state = { active: false, windowId: null, windowStartedAt: null };
          }
        } catch (error) {
          await this.ports.recordError(
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
    }
    return entries;
  }

  private async transitionAccount(
    accountId: string,
    entries: ScheduleEntry[],
    now: Date,
  ) {
    const hold = await this.ports.getActiveHold?.(accountId);
    if (hold) return;
    const winner = selectScheduleWinner(entries);
    const previousWindow = this.activeWindows.get(accountId);

    if (!winner?.state?.windowId) {
      await this.stopAccountWindow(accountId, entries, now, previousWindow);
      return;
    }

    const nextWindow = winner.state.windowId;
    const winnerWindowIsOpen =
      winner.schedule.lastStartedWindow === nextWindow &&
      winner.schedule.lastStoppedWindow !== nextWindow;
    const previousWindows = openScheduleWindows(entries).filter(
      (window) =>
        window.scheduleId !== winner.schedule.id ||
        window.windowId !== nextWindow,
    );

    if (winnerWindowIsOpen && previousWindow === nextWindow) {
      if (previousWindows.length > 0) {
        await this.ports.repository.commitStartedWindow({
          accountId,
          scheduleId: winner.schedule.id,
          windowId: nextWindow,
          expectedUpdatedAt: winner.schedule.updatedAt,
          previousWindows,
        });
      }
      return;
    }

    if (!previousWindow && winnerWindowIsOpen) {
      if (previousWindows.length > 0) {
        await this.ports.repository.commitStartedWindow({
          accountId,
          scheduleId: winner.schedule.id,
          windowId: nextWindow,
          expectedUpdatedAt: winner.schedule.updatedAt,
          previousWindows,
        });
      }
      this.activeWindows.set(accountId, nextWindow);
      return;
    }

    const context = {
      source: "scheduler",
      action: "schedule-start",
      scheduleId: winner.schedule.id,
      presetId: winner.schedule.presetId,
    } satisfies OperationContext;
    const retryKey = `start:${winner.schedule.id}:${nextWindow}`;
    if (this.isBackingOff(accountId, retryKey, now)) return;
    try {
      await this.ports.applyPreset(
        accountId,
        winner.schedule.presetId,
        context,
      );
      const holdAfterPreset = await this.ports.getActiveHold?.(accountId);
      if (holdAfterPreset) return;
      await this.ports.resumeOrStart(accountId, context);
      await this.ports.repository.commitStartedWindow({
        accountId,
        scheduleId: winner.schedule.id,
        windowId: nextWindow,
        expectedUpdatedAt: winner.schedule.updatedAt,
        previousWindows,
      });
      this.activeWindows.set(accountId, nextWindow);
      this.failedTransitions.delete(accountId);
      await this.ports.recordInfo(
        accountId,
        "steam.schedule.start",
        `Schedule "${winner.schedule.name}" started.`,
        context,
      );
    } catch (error) {
      const retry = this.recordTransitionFailure(accountId, retryKey, now);
      await this.ports.recordError(
        accountId,
        "steam.schedule.error",
        `Schedule could not start: ${safeErrorMessage(error)}`,
        { ...context, ...retry },
      );
    }
  }

  private async stopAccountWindow(
    accountId: string,
    entries: ScheduleEntry[],
    now: Date,
    previousWindow?: string,
  ) {
    const openWindows = openScheduleWindows(entries);
    if (!previousWindow && openWindows.length === 0) return;

    const context = {
      source: "scheduler",
      action: "schedule-pause",
    } satisfies OperationContext;
    const retryKey = "pause";
    if (this.isBackingOff(accountId, retryKey, now)) return;
    try {
      const desiredState = await this.ports.getDesiredState(accountId);
      if (desiredState !== "stopped") {
        await this.ports.pause(accountId, context);
      }
      await this.ports.repository.markWindowsStopped(accountId, openWindows);
      this.activeWindows.delete(accountId);
      this.failedTransitions.delete(accountId);
      await this.ports.recordInfo(
        accountId,
        "steam.schedule.pause",
        "No schedule window remains active; boosting was paused.",
        context,
      );
    } catch (error) {
      const retry = this.recordTransitionFailure(accountId, retryKey, now);
      await this.ports.recordError(
        accountId,
        "steam.schedule.error",
        `Schedules could not pause: ${safeErrorMessage(error)}`,
        { ...context, ...retry },
      );
    }
  }
}

function scheduledOwner(window: OpenScheduleWindow): SafetyHoldOwner {
  return {
    kind: "scheduled",
    scheduleId: window.scheduleId,
    windowId: window.windowId,
  };
}

function openScheduleWindows(entries: ScheduleEntry[]) {
  return entries.flatMap(({ schedule }) =>
    schedule.lastStartedWindow &&
    schedule.lastStartedWindow !== schedule.lastStoppedWindow
      ? [
          {
            scheduleId: schedule.id,
            windowId: schedule.lastStartedWindow,
          } satisfies OpenScheduleWindow,
        ]
      : [],
  );
}
