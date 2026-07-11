import type { OperationContext } from "../operation-context.js";
import { safeErrorMessage } from "../util/redact.js";
import { evaluateScheduleWindow, selectScheduleWinner } from "./scheduler.js";
import type {
  OpenScheduleWindow,
  ScheduleRecord,
  ScheduleRepository,
} from "./schedule-repository.js";

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
};

const scheduleIntervalMs = 60_000;

export class ScheduleCoordinator {
  private readonly activeWindows = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight: Promise<void> | null = null;
  private trailingTickAt: Date | null = null;
  private latestRequestedTickAt: Date | null = null;

  constructor(private readonly ports: ScheduleCoordinatorPorts) {}

  start() {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.runScheduledTick("interval");
    }, scheduleIntervalMs);
    this.runScheduledTick("initial");
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
  }

  clearAll() {
    this.activeWindows.clear();
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
          await this.transitionAccount(accountId, entries);
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

  private async transitionAccount(accountId: string, entries: ScheduleEntry[]) {
    const winner = selectScheduleWinner(entries);
    const previousWindow = this.activeWindows.get(accountId);

    if (!winner?.state?.windowId) {
      await this.stopAccountWindow(accountId, entries, previousWindow);
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
    try {
      await this.ports.applyPreset(
        accountId,
        winner.schedule.presetId,
        context,
      );
      await this.ports.resumeOrStart(accountId, context);
      await this.ports.repository.commitStartedWindow({
        accountId,
        scheduleId: winner.schedule.id,
        windowId: nextWindow,
        expectedUpdatedAt: winner.schedule.updatedAt,
        previousWindows,
      });
      this.activeWindows.set(accountId, nextWindow);
      await this.ports.recordInfo(
        accountId,
        "steam.schedule.start",
        `Schedule "${winner.schedule.name}" started.`,
        context,
      );
    } catch (error) {
      await this.ports.recordError(
        accountId,
        "steam.schedule.error",
        `Schedule could not start: ${safeErrorMessage(error)}`,
        context,
      );
    }
  }

  private async stopAccountWindow(
    accountId: string,
    entries: ScheduleEntry[],
    previousWindow?: string,
  ) {
    const openWindows = openScheduleWindows(entries);
    if (!previousWindow && openWindows.length === 0) return;

    const context = {
      source: "scheduler",
      action: "schedule-pause",
    } satisfies OperationContext;
    try {
      const desiredState = await this.ports.getDesiredState(accountId);
      if (desiredState !== "stopped") {
        await this.ports.pause(accountId, context);
      }
      await this.ports.repository.markWindowsStopped(accountId, openWindows);
      this.activeWindows.delete(accountId);
      await this.ports.recordInfo(
        accountId,
        "steam.schedule.pause",
        "No schedule window remains active; boosting was paused.",
        context,
      );
    } catch (error) {
      await this.ports.recordError(
        accountId,
        "steam.schedule.error",
        `Schedules could not pause: ${safeErrorMessage(error)}`,
        context,
      );
    }
  }
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
