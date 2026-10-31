import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, migrate } from "../src/db/client.js";
import {
  boostPreset,
  boostSession,
  steamAccount,
  steamAccountGame,
} from "../src/db/schema.js";
import { getAccountAnalytics } from "../src/http/read-models/automation.js";
import {
  closeInterruptedBoostSessions,
  markOpenBoostSessionsSeen,
  trackBoostSession,
} from "../src/steam/boost-session-tracker.js";

describe("boost session attribution to reported activity", () => {
  let accountId: string;
  let timestamp: number;
  beforeEach(async () => {
    migrate();
    timestamp = Date.UTC(2026, 0, 1, 12);
    vi.spyOn(Date, "now").mockImplementation(() => timestamp);
    accountId = randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `activity-${accountId}`,
      status: "disconnected",
      desiredState: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(steamAccountGame).values({
      accountId,
      appId: 730,
      enabled: true,
      source: "manual",
      createdAt: timestamp,
    });
  });
  afterEach(async () => {
    await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
    vi.restoreAllMocks();
  });

  it("attributes farming time to announced games and preserves the saved manual preset", async () => {
    const presetId = randomUUID();
    await db.insert(boostPreset).values({
      id: presetId,
      accountId,
      name: "Manual preset",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db
      .update(steamAccount)
      .set({ activePresetId: presetId })
      .where(eq(steamAccount.id, accountId));
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [570],
    });
    timestamp += 60_000;
    await trackBoostSession(accountId, "paused_manual", {
      activityMode: "idle",
      activeAppIds: [],
    });
    const analytics = await getAccountAnalytics(accountId, timestamp);
    expect(analytics.topGames).toEqual([
      { appId: 570, name: "App 570", durationMs: 60_000 },
    ]);
    expect(analytics.recentSessions[0]).toMatchObject({
      presetId: null,
      appIds: [570],
      durationMs: 60_000,
    });
    expect(
      (
        await db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, accountId))
      )[0]?.activePresetId,
    ).toBe(presetId);
    expect(
      (
        await db
          .select()
          .from(steamAccountGame)
          .where(eq(steamAccountGame.accountId, accountId))
      ).map((game) => game.appId),
    ).toEqual([730]);
  });

  it("rotates the session when farm targets change while status stays boosting", async () => {
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [10, 20],
    });
    timestamp += 60_000;
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [20],
    });
    timestamp += 60_000;
    await trackBoostSession(accountId, "paused_manual", {
      activityMode: "idle",
      activeAppIds: [],
    });
    const analytics = await getAccountAnalytics(accountId, timestamp);
    expect(analytics.totalSessions).toBe(2);
    expect(analytics.topGames).toEqual([
      { appId: 20, name: "App 20", durationMs: 120_000 },
      { appId: 10, name: "App 10", durationMs: 60_000 },
    ]);
    expect(
      analytics.recentSessions.find((session) => session.appIds.length === 2)
        ?.stopReason,
    ).toBe("selection_changed");
  });

  it("does not create extra sessions for the same reported set in a different order", async () => {
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [20, 10],
    });
    timestamp += 60_000;
    await trackBoostSession(accountId, "boosting", {
      activityMode: "farming",
      activeAppIds: [10, 20, 10],
    });
    expect(
      await db
        .select()
        .from(boostSession)
        .where(eq(boostSession.accountId, accountId)),
    ).toHaveLength(1);
  });

  it("uses reported manual IDs even if saved configuration changed before status processing", async () => {
    await trackBoostSession(accountId, "boosting", {
      activityMode: "manual",
      activeAppIds: [570],
    });
    const sessions = await db
      .select()
      .from(boostSession)
      .where(eq(boostSession.accountId, accountId));
    expect(JSON.parse(sessions[0]?.appIdsJson ?? "[]")).toEqual([570]);
  });

  it("ends manual attribution when farming preparation clears the reported payload", async () => {
    await trackBoostSession(accountId, "boosting", {
      activityMode: "manual",
      activeAppIds: [730],
    });
    timestamp += 60_000;
    await trackBoostSession(accountId, "online", {
      activityMode: "farming",
      activeAppIds: [],
    });
    timestamp += 60_000;
    const analytics = await getAccountAnalytics(accountId, timestamp);
    expect(analytics.openSession).toBeNull();
    expect(analytics.topGames[0]).toMatchObject({
      appId: 730,
      durationMs: 60_000,
    });
  });

  it("never guesses manual IDs when an incomplete farming snapshot lacks IDs", async () => {
    await trackBoostSession(accountId, "boosting", { activityMode: "farming" });
    const sessions = await db
      .select()
      .from(boostSession)
      .where(eq(boostSession.accountId, accountId));
    expect(JSON.parse(sessions[0]?.appIdsJson ?? "[]")).toEqual([]);
  });
});

describe("boost sessions cut off by a crash", () => {
  let accountId: string;
  let timestamp: number;
  beforeEach(async () => {
    migrate();
    timestamp = Date.UTC(2026, 0, 2, 12);
    vi.spyOn(Date, "now").mockImplementation(() => timestamp);
    accountId = randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `crash-${accountId}`,
      status: "disconnected",
      desiredState: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  afterEach(async () => {
    await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
    vi.restoreAllMocks();
  });

  it("ends an open session at its last heartbeat instead of counting the downtime", async () => {
    await trackBoostSession(accountId, "boosting", {
      activityMode: "manual",
      activeAppIds: [730],
    });
    timestamp += 5 * 60_000;
    await markOpenBoostSessionsSeen();
    // The process dies here; it restarts three hours later.
    timestamp += 3 * 60 * 60_000;
    expect(await closeInterruptedBoostSessions()).toBeGreaterThanOrEqual(1);

    const [session] = await db
      .select()
      .from(boostSession)
      .where(eq(boostSession.accountId, accountId));
    expect(session).toMatchObject({
      endedAt: Date.UTC(2026, 0, 2, 12, 5),
      stopReason: "interrupted",
    });
    const analytics = await getAccountAnalytics(accountId, timestamp, "UTC");
    expect(analytics.recentSessions[0]?.durationMs).toBe(5 * 60_000);
  });
});
