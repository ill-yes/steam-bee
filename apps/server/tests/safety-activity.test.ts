import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, migrate } from "../src/db/client.js";
import {
  accountSafetyPolicy,
  boostSession,
  steamAccount,
} from "../src/db/schema.js";
import { trackBoostSession } from "../src/steam/boost-session-tracker.js";
import { SafetyCoordinator } from "../src/steam/safety-coordinator.js";

describe("safety caps across activity target changes", () => {
  let accountId: string;
  let timestamp: number;
  beforeEach(async () => {
    migrate();
    timestamp = Date.UTC(2026, 0, 1, 12);
    vi.spyOn(Date, "now").mockImplementation(() => timestamp);
    accountId = randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `safety-activity-${accountId}`,
      status: "boosting",
      desiredState: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(accountSafetyPolicy).values({
      accountId,
      maxSessionMinutes: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  afterEach(async () => {
    await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
    vi.restoreAllMocks();
  });

  function coordinator() {
    const pause = vi.fn(async () => undefined);
    return {
      pause,
      coordinator: new SafetyCoordinator({
        runForAccount: async (_id, operation) => operation(),
        pause,
        recordInfo: vi.fn(async () => undefined),
        onTickError: vi.fn(),
      }),
    };
  }

  it("enforces the full session cap despite multiple farming target rotations", async () => {
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [10, 20],
    });
    timestamp += 45_000;
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [20],
    });
    timestamp += 45_000;
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [30],
    });
    const { coordinator: safety, pause } = coordinator();
    await safety.tick(timestamp + 29_999);
    expect(pause).not.toHaveBeenCalled();
    await safety.tick(timestamp + 30_000);
    expect(pause).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({ cap: "session_limit", consumedMinutes: 2 }),
    );
  });

  it("starts a new session after an explicit pause even at the same timestamp", async () => {
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [10],
    });
    timestamp += 90_000;
    await trackBoostSession(accountId, "paused_manual", {
      activityMode: "idle",
      activeAppIds: [],
    });
    await trackBoostSession(accountId, "boosting", {
      activityMode: "manual",
      activeAppIds: [20],
    });
    const { coordinator: safety, pause } = coordinator();
    await safety.tick(timestamp + 60_000);
    expect(pause).not.toHaveBeenCalled();
    await safety.tick(timestamp + 120_000);
    expect(pause).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({ cap: "session_limit", consumedMinutes: 2 }),
    );
  });

  it("never joins a historical selection change across a real inactive gap", async () => {
    await db.insert(boostSession).values([
      {
        id: randomUUID(),
        accountId,
        appIdsJson: "[10]",
        startedAt: timestamp - 300_000,
        endedAt: timestamp - 1,
        stopReason: "selection_changed",
        createdAt: timestamp - 300_000,
      },
      {
        id: randomUUID(),
        accountId,
        appIdsJson: "[20]",
        startedAt: timestamp,
        endedAt: null,
        stopReason: null,
        createdAt: timestamp,
      },
    ]);
    const { coordinator: safety, pause } = coordinator();
    await safety.tick(timestamp + 60_000);
    expect(pause).not.toHaveBeenCalled();
  });

  it("still sums rotated intervals for the daily cap after a separate pause", async () => {
    await db
      .update(accountSafetyPolicy)
      .set({ maxSessionMinutes: null, maxDailyMinutes: 2 })
      .where(eq(accountSafetyPolicy.accountId, accountId));
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [10],
    });
    timestamp += 45_000;
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [20],
    });
    timestamp += 45_000;
    await trackBoostSession(accountId, "paused_manual", {
      activityMode: "idle",
      activeAppIds: [],
    });
    timestamp += 60_000;
    await trackBoostSession(accountId, "boosting", {
      activityMode: "manual",
      activeAppIds: [30],
    });
    const { coordinator: safety, pause } = coordinator();
    await safety.tick(timestamp + 29_999);
    expect(pause).not.toHaveBeenCalled();
    await safety.tick(timestamp + 30_000);
    expect(pause).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({ cap: "daily_limit", consumedMinutes: 2 }),
    );
  });
});
