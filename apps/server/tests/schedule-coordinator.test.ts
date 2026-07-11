import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScheduleCoordinator,
  type ScheduleCoordinatorPorts,
} from "../src/steam/schedule-coordinator.js";
import type {
  OpenScheduleWindow,
  ScheduleRecord,
  ScheduleRepository,
  StartedScheduleWindow,
} from "../src/steam/schedule-repository.js";

const activeAt = new Date(Date.UTC(2026, 6, 8, 10, 30));
const afterWindow = new Date(Date.UTC(2026, 6, 8, 11, 30));

describe("ScheduleCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes the full start transition and commits its marker after the runtime action", async () => {
    const harness = createHarness([scheduleRecord()]);

    await harness.coordinator.tick(activeAt);

    expect(harness.order).toEqual([
      "lock:start:account-a",
      "apply:schedule-a",
      "runtime:account-a",
      "commit:schedule-a",
      "info:steam.schedule.start",
      "lock:end:account-a",
    ]);
    expect(harness.repository.schedules[0]?.lastStartedWindow).toBe(
      "schedule-a:2026-07-08:10:00-11:00",
    );

    await harness.coordinator.tick(activeAt);
    expect(
      harness.order.filter((entry) => entry.startsWith("apply:")),
    ).toHaveLength(1);
  });

  it("leaves the marker uncommitted after a runtime failure and retries on the next tick", async () => {
    const harness = createHarness([scheduleRecord()]);
    let shouldFail = true;
    harness.ports.resumeOrStart = async (accountId) => {
      harness.order.push(`runtime:${accountId}`);
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Steam unavailable");
      }
    };

    await harness.coordinator.tick(activeAt);

    expect(harness.repository.schedules[0]?.lastStartedWindow).toBeNull();
    expect(harness.order).not.toContain("commit:schedule-a");
    expect(harness.order).toContain("error:steam.schedule.error");

    await harness.coordinator.tick(activeAt);

    expect(
      harness.order.filter((entry) => entry === "apply:schedule-a"),
    ).toHaveLength(2);
    expect(
      harness.order.filter((entry) => entry === "runtime:account-a"),
    ).toHaveLength(2);
    expect(harness.repository.schedules[0]?.lastStartedWindow).toBe(
      "schedule-a:2026-07-08:10:00-11:00",
    );
  });

  it("pauses and closes an active window after it ends", async () => {
    const harness = createHarness([scheduleRecord()]);
    await harness.coordinator.tick(activeAt);
    harness.order.length = 0;

    await harness.coordinator.tick(afterWindow);

    expect(harness.order).toEqual([
      "lock:start:account-a",
      "pause:account-a",
      "stop:schedule-a",
      "info:steam.schedule.pause",
      "lock:end:account-a",
    ]);
    expect(harness.repository.schedules[0]?.lastStoppedWindow).toBe(
      "schedule-a:2026-07-08:10:00-11:00",
    );
  });

  it("switches to the later winner and atomically closes the previous window", async () => {
    const harness = createHarness([
      scheduleRecord({ endTime: "12:00" }),
      scheduleRecord({
        id: "schedule-b",
        presetId: "preset-b",
        name: "Schedule B",
        startTime: "10:15",
        endTime: "12:00",
      }),
    ]);

    await harness.coordinator.tick(new Date(Date.UTC(2026, 6, 8, 10, 5)));
    const previousWindow =
      harness.repository.schedules[0]?.lastStartedWindow ?? null;
    expect(previousWindow).toBe("schedule-a:2026-07-08:10:00-12:00");
    harness.order.length = 0;

    await harness.coordinator.tick(activeAt);

    expect(harness.order).toEqual([
      "lock:start:account-a",
      "apply:schedule-b",
      "runtime:account-a",
      `commit:schedule-b:${previousWindow}`,
      "info:steam.schedule.start",
      "lock:end:account-a",
    ]);
    expect(harness.repository.schedules[0]?.lastStoppedWindow).toBe(
      previousWindow,
    );
    expect(harness.repository.schedules[1]?.lastStartedWindow).toBe(
      "schedule-b:2026-07-08:10:15-12:00",
    );
  });

  it("hydrates an already committed window after restart without replaying start", async () => {
    const windowId = "schedule-a:2026-07-08:10:00-11:00";
    const harness = createHarness([
      scheduleRecord({ lastStartedWindow: windowId }),
    ]);

    await harness.coordinator.tick(activeAt);

    expect(harness.order).toEqual([
      "lock:start:account-a",
      "lock:end:account-a",
    ]);

    await harness.coordinator.tick(afterWindow);
    expect(harness.order).toContain("pause:account-a");
    expect(harness.repository.schedules[0]?.lastStoppedWindow).toBe(windowId);
  });

  it("reopens a closed window when the schedule is enabled again", async () => {
    const windowId = "schedule-a:2026-07-08:10:00-11:00";
    const harness = createHarness([
      scheduleRecord({
        lastStartedWindow: windowId,
        lastStoppedWindow: windowId,
      }),
    ]);

    await harness.coordinator.tick(activeAt);

    expect(harness.order).toEqual([
      "lock:start:account-a",
      "apply:schedule-a",
      "runtime:account-a",
      "commit:schedule-a",
      "info:steam.schedule.start",
      "lock:end:account-a",
    ]);
    expect(harness.repository.schedules[0]).toMatchObject({
      lastStartedWindow: windowId,
      lastStoppedWindow: null,
    });
  });

  it("closes every persisted predecessor when a later winner starts after restart", async () => {
    const firstWindow = "schedule-a:2026-07-08:10:00-12:00";
    const harness = createHarness([
      scheduleRecord({
        endTime: "12:00",
        lastStartedWindow: firstWindow,
      }),
      scheduleRecord({
        id: "schedule-b",
        presetId: "preset-b",
        name: "Schedule B",
        startTime: "10:15",
        endTime: "12:00",
      }),
    ]);

    await harness.coordinator.tick(activeAt);

    expect(harness.order).toContain(`commit:schedule-b:${firstWindow}`);
    expect(harness.repository.schedules[0]?.lastStoppedWindow).toBe(
      firstWindow,
    );
    expect(harness.repository.schedules[1]?.lastStartedWindow).toBe(
      "schedule-b:2026-07-08:10:15-12:00",
    );
  });

  it("closes an older open window before restarting the same schedule", async () => {
    const olderWindow = "schedule-a:2026-07-01:10:00-11:00";
    const harness = createHarness([
      scheduleRecord({ lastStartedWindow: olderWindow }),
    ]);

    await harness.coordinator.tick(activeAt);

    expect(harness.order).toContain(`commit:schedule-a:${olderWindow}`);
    expect(harness.repository.schedules[0]).toMatchObject({
      lastStartedWindow: "schedule-a:2026-07-08:10:00-11:00",
      lastStoppedWindow: olderWindow,
    });
  });

  it.each(["disable", "delete"] as const)(
    "uses a fresh account-scoped read after a queued %s",
    async (mutation) => {
      const harness = createHarness([scheduleRecord()]);
      let releaseOperation = () => {};
      let operationEntered = () => {};
      const operationGate = new Promise<void>((resolve) => {
        releaseOperation = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        operationEntered = resolve;
      });
      harness.ports.runForAccount = async (accountId, operation) => {
        harness.order.push(`lock:start:${accountId}`);
        operationEntered();
        await operationGate;
        try {
          return await operation();
        } finally {
          harness.order.push(`lock:end:${accountId}`);
        }
      };

      const tick = harness.coordinator.tick(activeAt);
      await entered;
      if (mutation === "disable") {
        harness.repository.schedules[0]!.enabled = false;
        harness.repository.schedules[0]!.updatedAt += 1;
      } else {
        harness.repository.schedules.splice(0, 1);
      }
      releaseOperation();
      await tick;

      expect(harness.order).not.toContain("apply:schedule-a");
      expect(harness.order).not.toContain("runtime:account-a");
      expect(harness.repository.listForAccountCalls).toBe(1);
    },
  );

  it("processes accounts independently while preserving each account lock", async () => {
    const harness = createHarness([
      scheduleRecord(),
      scheduleRecord({
        id: "schedule-b",
        accountId: "account-b",
        presetId: "preset-b",
        name: "Schedule B",
      }),
    ]);
    let releaseAccountA = () => {};
    let accountBFinished = () => {};
    const accountAGate = new Promise<void>((resolve) => {
      releaseAccountA = resolve;
    });
    const accountBDone = new Promise<void>((resolve) => {
      accountBFinished = resolve;
    });
    harness.ports.runForAccount = async (accountId, operation) => {
      harness.order.push(`lock:start:${accountId}`);
      if (accountId === "account-a") await accountAGate;
      try {
        return await operation();
      } finally {
        harness.order.push(`lock:end:${accountId}`);
        if (accountId === "account-b") accountBFinished();
      }
    };

    const tick = harness.coordinator.tick(activeAt);
    await accountBDone;
    expect(harness.order).toContain("apply:schedule-b");
    expect(harness.order).not.toContain("apply:schedule-a");

    releaseAccountA();
    await tick;
    expect(harness.order).toContain("apply:schedule-a");
  });

  it("isolates an invalid schedule while processing valid accounts", async () => {
    const harness = createHarness([
      scheduleRecord({ timezone: "Invalid/Timezone" }),
      scheduleRecord({
        id: "schedule-b",
        accountId: "account-b",
        presetId: "preset-b",
        name: "Schedule B",
      }),
    ]);

    await harness.coordinator.tick(activeAt);

    expect(harness.order).toContain("error:steam.schedule.invalid");
    expect(harness.order).toContain("apply:schedule-b");
    expect(harness.repository.schedules[1]?.lastStartedWindow).toBe(
      "schedule-b:2026-07-08:10:00-11:00",
    );
  });

  it("coalesces overlapping ticks into one trailing run with the latest time", async () => {
    const harness = createHarness([scheduleRecord()]);
    const nextActiveWindow = new Date(Date.UTC(2026, 6, 15, 10, 30));
    let releaseList = () => {};
    harness.repository.listAccountGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });

    const first = harness.coordinator.tick(activeAt);
    const second = harness.coordinator.tick(afterWindow);
    const third = harness.coordinator.tick(nextActiveWindow);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(harness.repository.listAccountCalls).toBe(1);
    releaseList();
    await first;

    expect(harness.repository.listAccountCalls).toBe(2);
    expect(
      harness.order.filter((entry) => entry === "apply:schedule-a"),
    ).toHaveLength(2);
    expect(
      harness.order.filter((entry) => entry === "pause:account-a"),
    ).toHaveLength(0);
    expect(harness.repository.schedules[0]?.lastStartedWindow).toBe(
      "schedule-a:2026-07-15:10:00-11:00",
    );
    expect(harness.repository.schedules[0]?.lastStoppedWindow).toBe(
      "schedule-a:2026-07-08:10:00-11:00",
    );
  });

  it("starts its timer once and stops future interval ticks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(activeAt);
    const harness = createHarness([scheduleRecord()]);

    harness.coordinator.start();
    harness.coordinator.start();
    expect(harness.repository.listAccountCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.repository.listAccountCalls).toBe(2);

    await harness.coordinator.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.repository.listAccountCalls).toBe(2);
  });
});

class FakeScheduleRepository implements ScheduleRepository {
  readonly schedules: ScheduleRecord[];
  listAccountCalls = 0;
  listForAccountCalls = 0;
  listAccountGate: Promise<void> | null = null;

  constructor(
    schedules: ScheduleRecord[],
    private readonly order: string[],
  ) {
    this.schedules = schedules.map((schedule) => ({ ...schedule }));
  }

  async listAccountIds() {
    this.listAccountCalls += 1;
    await this.listAccountGate;
    return [...new Set(this.schedules.map((schedule) => schedule.accountId))];
  }

  async listSchedulesForAccount(accountId: string) {
    this.listForAccountCalls += 1;
    return this.schedules
      .filter((schedule) => schedule.accountId === accountId)
      .map((schedule) => ({ ...schedule }));
  }

  async markWindowsStopped(accountId: string, windows: OpenScheduleWindow[]) {
    for (const window of windows) {
      this.order.push(`stop:${window.scheduleId}`);
      const schedule = this.schedules.find(
        (candidate) =>
          candidate.id === window.scheduleId &&
          candidate.accountId === accountId &&
          candidate.lastStartedWindow === window.windowId,
      );
      if (!schedule) throw new Error("stale stop marker");
      schedule.lastStoppedWindow = window.windowId;
    }
  }

  async commitStartedWindow(window: StartedScheduleWindow) {
    this.order.push(
      `commit:${window.scheduleId}${
        window.previousWindows[0]
          ? `:${window.previousWindows[0].windowId}`
          : ""
      }`,
    );
    const nextSchedules = this.schedules.map((schedule) => ({ ...schedule }));
    const schedule = nextSchedules.find(
      (candidate) =>
        candidate.id === window.scheduleId &&
        candidate.accountId === window.accountId &&
        candidate.enabled &&
        candidate.updatedAt === window.expectedUpdatedAt,
    );
    if (!schedule) throw new Error("stale start marker");

    for (const previousWindow of window.previousWindows) {
      if (
        previousWindow.scheduleId === window.scheduleId &&
        previousWindow.windowId === window.windowId
      ) {
        continue;
      }
      const previous = nextSchedules.find(
        (candidate) =>
          candidate.id === previousWindow.scheduleId &&
          candidate.accountId === window.accountId &&
          candidate.lastStartedWindow === previousWindow.windowId,
      );
      if (!previous) throw new Error("stale previous marker");
      previous.lastStoppedWindow = previousWindow.windowId;
    }

    schedule.lastStartedWindow = window.windowId;
    if (schedule.lastStoppedWindow === window.windowId) {
      schedule.lastStoppedWindow = null;
    }

    this.schedules.splice(0, this.schedules.length, ...nextSchedules);
  }
}

function createHarness(schedules: ScheduleRecord[]) {
  const order: string[] = [];
  const repository = new FakeScheduleRepository(schedules, order);
  const ports: ScheduleCoordinatorPorts = {
    repository,
    runForAccount: async (accountId, operation) => {
      order.push(`lock:start:${accountId}`);
      try {
        return await operation();
      } finally {
        order.push(`lock:end:${accountId}`);
      }
    },
    getDesiredState: async () => "running",
    applyPreset: async (_accountId, _presetId, context) => {
      order.push(`apply:${String(context.scheduleId)}`);
    },
    pause: async (accountId) => {
      order.push(`pause:${accountId}`);
    },
    resumeOrStart: async (accountId) => {
      order.push(`runtime:${accountId}`);
    },
    recordInfo: async (_accountId, type) => {
      order.push(`info:${type}`);
    },
    recordError: async (_accountId, type) => {
      order.push(`error:${type}`);
    },
    onTickError: (error) => {
      order.push(`tick-error:${String(error)}`);
    },
  };
  return {
    coordinator: new ScheduleCoordinator(ports),
    order,
    ports,
    repository,
  };
}

function scheduleRecord(
  overrides: Partial<ScheduleRecord> = {},
): ScheduleRecord {
  return {
    id: "schedule-a",
    accountId: "account-a",
    presetId: "preset-a",
    name: "Schedule A",
    enabled: true,
    weekdaysJson: "[3]",
    startTime: "10:00",
    endTime: "11:00",
    timezone: "UTC",
    lastStartedWindow: null,
    lastStoppedWindow: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
