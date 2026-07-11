import {
  ERROR_CODES,
  isPersonaState,
  type BoostAnalytics,
  type BoostPreset,
  type BoostSchedule,
  type BoostSession,
} from "@steam-bee/contracts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  boostPreset,
  boostPresetGame,
  boostSchedule,
  boostSession,
  steamAppCache,
} from "../../db/schema.js";
import { parseIntegerArray } from "../../util/json.js";
import { appError } from "../errors.js";

export async function getAccountPresets(
  accountId: string,
): Promise<BoostPreset[]> {
  return queryAccountPresets(accountId);
}

export async function getAccountPreset(
  accountId: string,
  presetId: string,
): Promise<BoostPreset> {
  const [preset] = await queryAccountPresets(accountId, presetId);
  if (!preset) {
    throw appError("Preset was not found.", 404, ERROR_CODES.presetNotFound);
  }
  return preset;
}

export async function getAccountSchedules(
  accountId: string,
): Promise<BoostSchedule[]> {
  return queryAccountSchedules(accountId);
}

export async function getAccountSchedule(
  accountId: string,
  scheduleId: string,
): Promise<BoostSchedule> {
  const [schedule] = await queryAccountSchedules(accountId, scheduleId);
  if (!schedule) {
    throw appError(
      "Schedule was not found.",
      404,
      ERROR_CODES.scheduleNotFound,
    );
  }
  return schedule;
}

export async function getAccountAnalytics(
  accountId: string,
  now = Date.now(),
): Promise<BoostAnalytics> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const last7Days = now - 7 * 24 * 60 * 60_000;

  const storedSessions = await db
    .select({
      id: boostSession.id,
      presetId: boostSession.presetId,
      presetName: boostPreset.name,
      appIdsJson: boostSession.appIdsJson,
      startedAt: boostSession.startedAt,
      endedAt: boostSession.endedAt,
      stopReason: boostSession.stopReason,
    })
    .from(boostSession)
    .leftJoin(boostPreset, eq(boostPreset.id, boostSession.presetId))
    .where(eq(boostSession.accountId, accountId))
    .orderBy(desc(boostSession.startedAt))
    .limit(500);
  const sessions = storedSessions.map((session) => ({
    ...session,
    appIds: parseIntegerArray(session.appIdsJson),
  }));
  const appNames = await getAppNameMap([
    ...new Set(sessions.flatMap((session) => session.appIds)),
  ]);

  let todayMs = 0;
  let last7DaysMs = 0;
  const gameDurations = new Map<number, number>();

  for (const session of sessions) {
    const endedAt = session.endedAt ?? now;
    const durationMs = Math.max(0, endedAt - session.startedAt);
    if (endedAt >= startOfToday.getTime()) {
      todayMs += overlappingDurationMs(
        session.startedAt,
        endedAt,
        startOfToday.getTime(),
        now,
      );
    }
    if (endedAt >= last7Days) {
      last7DaysMs += overlappingDurationMs(
        session.startedAt,
        endedAt,
        last7Days,
        now,
      );
    }
    for (const appId of session.appIds) {
      gameDurations.set(appId, (gameDurations.get(appId) ?? 0) + durationMs);
    }
  }

  const presentedSessions: BoostSession[] = sessions.map((session) => {
    const { appIdsJson, ...publicSession } = session;
    void appIdsJson;
    return {
      ...publicSession,
      durationMs: Math.max(0, (session.endedAt ?? now) - session.startedAt),
      apps: session.appIds.map((appId) => ({
        appId,
        name: appNames.get(appId) ?? `App ${appId}`,
      })),
    } satisfies BoostSession;
  });

  return {
    todayMs,
    last7DaysMs,
    totalSessions: sessions.length,
    openSession:
      presentedSessions.find((session) => session.endedAt === null) ?? null,
    topGames: [...gameDurations.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([appId, durationMs]) => ({
        appId,
        name: appNames.get(appId) ?? `App ${appId}`,
        durationMs,
      })),
    recentSessions: presentedSessions.slice(0, 12),
  };
}

async function queryAccountPresets(accountId: string, presetId?: string) {
  const rows = await db
    .select({
      id: boostPreset.id,
      accountId: boostPreset.accountId,
      name: boostPreset.name,
      personaState: boostPreset.personaState,
      customTitle: boostPreset.customTitle,
      createdAt: boostPreset.createdAt,
      updatedAt: boostPreset.updatedAt,
      gameAppId: boostPresetGame.appId,
      gameName: steamAppCache.name,
    })
    .from(boostPreset)
    .leftJoin(boostPresetGame, eq(boostPresetGame.presetId, boostPreset.id))
    .leftJoin(steamAppCache, eq(steamAppCache.appId, boostPresetGame.appId))
    .where(
      presetId
        ? and(
            eq(boostPreset.accountId, accountId),
            eq(boostPreset.id, presetId),
          )
        : eq(boostPreset.accountId, accountId),
    )
    .orderBy(desc(boostPreset.updatedAt), asc(boostPresetGame.createdAt));

  const hydrated = new Map<string, BoostPreset>();
  for (const row of rows) {
    let preset = hydrated.get(row.id);
    if (!preset) {
      if (!isPersonaState(row.personaState)) {
        throw new Error(`Unsupported Steam persona state: ${row.personaState}`);
      }
      preset = {
        id: row.id,
        accountId: row.accountId,
        name: row.name,
        personaState: row.personaState,
        customTitle: row.customTitle,
        appIds: [],
        games: [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      hydrated.set(row.id, preset);
    }
    if (row.gameAppId !== null) {
      preset.appIds.push(row.gameAppId);
      preset.games.push({
        appId: row.gameAppId,
        name: row.gameName ?? `App ${row.gameAppId}`,
      });
    }
  }
  return [...hydrated.values()];
}

async function queryAccountSchedules(accountId: string, scheduleId?: string) {
  const schedules = await db
    .select({
      id: boostSchedule.id,
      accountId: boostSchedule.accountId,
      presetId: boostSchedule.presetId,
      presetName: boostPreset.name,
      name: boostSchedule.name,
      enabled: boostSchedule.enabled,
      weekdaysJson: boostSchedule.weekdaysJson,
      startTime: boostSchedule.startTime,
      endTime: boostSchedule.endTime,
      timezone: boostSchedule.timezone,
      lastStartedWindow: boostSchedule.lastStartedWindow,
      lastStoppedWindow: boostSchedule.lastStoppedWindow,
      createdAt: boostSchedule.createdAt,
      updatedAt: boostSchedule.updatedAt,
    })
    .from(boostSchedule)
    .leftJoin(boostPreset, eq(boostPreset.id, boostSchedule.presetId))
    .where(
      scheduleId
        ? and(
            eq(boostSchedule.accountId, accountId),
            eq(boostSchedule.id, scheduleId),
          )
        : eq(boostSchedule.accountId, accountId),
    )
    .orderBy(desc(boostSchedule.updatedAt));

  return schedules.map((schedule) => {
    const { weekdaysJson, ...publicSchedule } = schedule;
    return {
      ...publicSchedule,
      weekdays: parseIntegerArray(weekdaysJson),
    } satisfies BoostSchedule;
  });
}

async function getAppNameMap(appIds: number[]) {
  if (appIds.length === 0) return new Map<number, string>();
  const apps = await db
    .select({
      appId: steamAppCache.appId,
      name: steamAppCache.name,
    })
    .from(steamAppCache)
    .where(inArray(steamAppCache.appId, appIds));
  return new Map(apps.map((app) => [app.appId, app.name]));
}

function overlappingDurationMs(
  startedAt: number,
  endedAt: number,
  rangeStart: number,
  rangeEnd: number,
) {
  const start = Math.max(startedAt, rangeStart);
  const end = Math.min(endedAt, rangeEnd);
  return Math.max(0, end - start);
}
