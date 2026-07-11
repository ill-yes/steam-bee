import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  boostPreset,
  boostPresetGame,
  boostSchedule,
  boostSession,
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
  steamAppCache,
  steamEvent,
} from "../src/db/schema.js";
import { getAdminOverview } from "../src/http/read-models/admin.js";
import {
  getAccountAnalytics,
  getAccountPresets,
  getAccountSchedules,
} from "../src/http/read-models/automation.js";

describe("HTTP read models", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM boost_session;
      DELETE FROM boost_schedule;
      DELETE FROM boost_preset_game;
      DELETE FROM boost_preset;
      DELETE FROM steam_account_library;
      DELETE FROM steam_account_game;
      DELETE FROM steam_app_cache;
      DELETE FROM steam_account;
      DELETE FROM admin_session;
    `);
  });

  it("hydrates all account presets with one scoped query", async () => {
    const now = Date.now();
    const accountA = await insertAccount("preset-read-a", now);
    const accountB = await insertAccount("preset-read-b", now);
    await db.insert(steamAppCache).values({
      appId: 730,
      name: "Counter-Strike 2",
      playtimeForever: 10,
      source: "library",
      updatedAt: now,
    });
    const presetA = await insertPreset(accountA, "First", now + 2);
    const emptyPreset = await insertPreset(accountA, "Empty", now + 1);
    const foreignPreset = await insertPreset(accountB, "Foreign", now + 3);
    await db.insert(boostPresetGame).values([
      { presetId: presetA, appId: 730, createdAt: now },
      { presetId: presetA, appId: 440, createdAt: now + 1 },
      { presetId: foreignPreset, appId: 570, createdAt: now },
    ]);

    const prepareSpy = vi.spyOn(sqlite, "prepare");
    try {
      const presets = await getAccountPresets(accountA);

      expect(prepareSpy).toHaveBeenCalledTimes(1);
      expect(presets.map((preset) => preset.id)).toEqual([
        presetA,
        emptyPreset,
      ]);
      expect(presets[0]).toMatchObject({
        appIds: [730, 440],
        games: [
          { appId: 730, name: "Counter-Strike 2" },
          { appId: 440, name: "App 440" },
        ],
      });
      expect(presets[1]).toMatchObject({ appIds: [], games: [] });
      expect(await getAccountPresets(crypto.randomUUID())).toEqual([]);
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it("keeps admin overview query count constant as accounts are added", async () => {
    const prepareSpy = vi.spyOn(sqlite, "prepare");
    try {
      const emptyOverview = await getAdminOverview(crypto.randomUUID());
      const emptyQueryCount = prepareSpy.mock.calls.length;
      expect(emptyOverview.accounts).toEqual([]);
      expect(emptyQueryCount).toBe(8);

      const now = Date.now();
      const accountA = await insertAccount("admin-read-a", now);
      const accountB = await insertAccount("admin-read-b", now + 1);
      await db.insert(steamAppCache).values([
        {
          appId: 730,
          name: "Counter-Strike 2",
          playtimeForever: 10,
          source: "library",
          updatedAt: now,
        },
        {
          appId: 440,
          name: "Team Fortress 2",
          playtimeForever: 20,
          source: "library",
          updatedAt: now,
        },
      ]);
      await db
        .insert(steamAccountLibrary)
        .values([
          libraryEntry(accountA, 730, now),
          libraryEntry(accountB, 730, now),
        ]);
      await db
        .insert(steamAccountGame)
        .values([
          selectedGame(accountA, 730, now),
          selectedGame(accountA, 440, now),
          selectedGame(accountB, 730, now),
        ]);
      const presetA = await insertPreset(accountA, "Account A", now);
      const presetB = await insertPreset(accountB, "Account B", now);
      await db.insert(boostPresetGame).values([
        { presetId: presetA, appId: 730, createdAt: now },
        { presetId: presetB, appId: 730, createdAt: now },
      ]);
      await db
        .insert(boostSchedule)
        .values(scheduleRecord(accountA, presetA, "[1,2,3]", now));
      await db
        .insert(steamEvent)
        .values([
          eventRecord(accountA, "a", now),
          eventRecord(accountB, "b-1", now),
          eventRecord(accountB, "b-2", now),
        ]);

      prepareSpy.mockClear();
      const overview = await getAdminOverview(crypto.randomUUID());
      const populatedQueryCount = prepareSpy.mock.calls.length;

      expect(populatedQueryCount).toBe(emptyQueryCount);
      expect(overview.totals).toMatchObject({
        accounts: 2,
        events: 3,
        presets: 2,
        schedules: 1,
        appCache: 2,
        libraryEntries: 2,
        selectedGames: 3,
      });
      expect(
        overview.accounts.find((item) => item.id === accountA),
      ).toMatchObject({
        selectedGameCount: 2,
        libraryAppCount: 1,
        presetCount: 1,
        scheduleCount: 1,
        eventCount: 1,
      });
      expect(
        overview.accounts.find((item) => item.id === accountB),
      ).toMatchObject({
        selectedGameCount: 1,
        libraryAppCount: 1,
        presetCount: 1,
        scheduleCount: 0,
        eventCount: 2,
      });
      expect(overview.apps.find((item) => item.appId === 730)).toMatchObject({
        libraryAccountCount: 2,
        selectedAccountCount: 2,
        presetCount: 2,
      });
      expect(overview.accounts[0]).not.toHaveProperty("tokenCiphertext");
      expect(overview.accounts[0]).not.toHaveProperty("games");
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it("projects malformed schedule and analytics JSON without leaking storage fields", async () => {
    const now = Date.now();
    const accountId = await insertAccount("projection-read", now);
    const presetId = await insertPreset(accountId, "Projection", now);
    await db
      .insert(boostSchedule)
      .values(scheduleRecord(accountId, presetId, "not-json", now));
    await db.insert(steamAppCache).values({
      appId: 730,
      name: "Counter-Strike 2",
      playtimeForever: 10,
      source: "library",
      updatedAt: now,
    });
    await db.insert(boostSession).values({
      id: crypto.randomUUID(),
      accountId,
      presetId,
      appIdsJson: '[730,"invalid",440]',
      startedAt: now - 1_000,
      endedAt: null,
      stopReason: null,
      createdAt: now - 1_000,
    });

    const [schedule] = await getAccountSchedules(accountId);
    const analytics = await getAccountAnalytics(accountId, now);

    expect(schedule).toMatchObject({ weekdays: [], presetName: "Projection" });
    expect(schedule).not.toHaveProperty("weekdaysJson");
    expect(analytics.openSession).toMatchObject({
      appIds: [730, 440],
      apps: [
        { appId: 730, name: "Counter-Strike 2" },
        { appId: 440, name: "App 440" },
      ],
      durationMs: 1_000,
    });
    expect(analytics.openSession).not.toHaveProperty("appIdsJson");
    expect(await getAccountSchedules(crypto.randomUUID())).toEqual([]);
  });

  it("rejects unsupported persisted persona states", async () => {
    const now = Date.now();
    const accountId = await insertAccount("invalid-persona-read", now);
    await db.insert(boostPreset).values({
      id: crypto.randomUUID(),
      accountId,
      name: "Invalid",
      personaState: 99,
      customTitle: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(getAccountPresets(accountId)).rejects.toThrow(
      "Unsupported Steam persona state: 99",
    );
  });
});

async function insertAccount(label: string, now: number) {
  const id = crypto.randomUUID();
  await db.insert(steamAccount).values({
    id,
    accountName: `${label}-${id}`,
    steamId: null,
    status: "disconnected",
    desiredState: "stopped",
    personaState: 7,
    customTitle: null,
    tokenCiphertext: null,
    tokenIv: null,
    tokenAuthTag: null,
    tokenExpiresAt: null,
    tokenKeyVersion: 1,
    lastError: null,
    latestBoostStartedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertPreset(accountId: string, name: string, now: number) {
  const id = crypto.randomUUID();
  await db.insert(boostPreset).values({
    id,
    accountId,
    name,
    personaState: 7,
    customTitle: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function selectedGame(accountId: string, appId: number, now: number) {
  return { accountId, appId, enabled: true, source: "manual", createdAt: now };
}

function libraryEntry(accountId: string, appId: number, now: number) {
  return {
    accountId,
    appId,
    playtimeForever: 10,
    source: "library",
    importedAt: now,
  };
}

function scheduleRecord(
  accountId: string,
  presetId: string,
  weekdaysJson: string,
  now: number,
) {
  return {
    id: crypto.randomUUID(),
    accountId,
    presetId,
    name: "Schedule",
    enabled: true,
    weekdaysJson,
    startTime: "09:00",
    endTime: "10:00",
    timezone: "UTC",
    lastStartedWindow: null,
    lastStoppedWindow: null,
    createdAt: now,
    updatedAt: now,
  };
}

function eventRecord(accountId: string, type: string, now: number) {
  return {
    accountId,
    level: "info",
    type,
    message: type,
    metadataJson: "{}",
    createdAt: now,
  };
}
