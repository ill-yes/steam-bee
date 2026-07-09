import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "@steam-bee/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  boostPreset,
  boostPresetGame,
  boostSchedule,
  boostSession,
  steamAccount,
  steamAppCache,
} from "../../db/schema.js";
import { steamManager, type OperationContext } from "../../steam/manager.js";
import {
  createPresetRecord,
  updatePresetRecord,
} from "../../steam/repository.js";
import {
  accountIdParams,
  accountPresetParams,
  accountScheduleParams,
  enforceGameLimit,
  presetSchema,
  scheduleSchema,
  scheduleUpdateSchema,
} from "../../steam/validation.js";
import { appError } from "../errors.js";
import { recordInfoEvent } from "../events.js";
import { requireAuth } from "../plugins.js";

export async function registerAutomationRoutes(app: FastifyInstance) {
  app.get(
    "/api/accounts/:id/presets",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      return getAccountPresets(params.id);
    },
  );

  app.post(
    "/api/accounts/:id/presets",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const body = presetSchema.parse(request.body);
      const appIds = [...new Set(body.appIds)];
      enforceGameLimit(appIds, body.customTitle);
      await assertAccountExists(params.id);

      const now = Date.now();
      const presetId = randomUUID();
      createPresetRecord(
        presetId,
        params.id,
        {
          name: body.name,
          personaState: body.personaState,
          customTitle: body.customTitle || null,
          appIds,
        },
        now,
      );
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.preset.create",
        message: `Preset "${body.name}" created.`,
        metadata: {
          ...operationContext(request, "preset-create"),
          presetId,
          appCount: appIds.length,
        },
      });
      return getAccountPreset(params.id, presetId);
    },
  );

  app.put(
    "/api/accounts/:id/presets/:presetId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountPresetParams.parse(request.params);
      const body = presetSchema.parse(request.body);
      const appIds = [...new Set(body.appIds)];
      enforceGameLimit(appIds, body.customTitle);
      await assertPresetBelongsToAccount(params.id, params.presetId);

      const now = Date.now();
      updatePresetRecord(
        params.presetId,
        params.id,
        {
          name: body.name,
          personaState: body.personaState,
          customTitle: body.customTitle || null,
          appIds,
        },
        now,
      );
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.preset.update",
        message: `Preset "${body.name}" updated.`,
        metadata: {
          ...operationContext(request, "preset-update"),
          presetId: params.presetId,
          appCount: appIds.length,
        },
      });
      return getAccountPreset(params.id, params.presetId);
    },
  );

  app.delete(
    "/api/accounts/:id/presets/:presetId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountPresetParams.parse(request.params);
      const preset = await assertPresetBelongsToAccount(
        params.id,
        params.presetId,
      );
      await db.delete(boostPreset).where(eq(boostPreset.id, params.presetId));
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.preset.delete",
        message: `Preset "${preset.name}" removed.`,
        metadata: {
          ...operationContext(request, "preset-delete"),
          presetId: params.presetId,
        },
      });
      return { ok: true };
    },
  );

  app.post(
    "/api/accounts/:id/presets/:presetId/apply",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountPresetParams.parse(request.params);
      await steamManager.applyPreset(
        params.id,
        params.presetId,
        operationContext(request, "preset-apply"),
      );
      return { ok: true };
    },
  );

  app.get(
    "/api/accounts/:id/schedules",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      return getAccountSchedules(params.id);
    },
  );

  app.post(
    "/api/accounts/:id/schedules",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const body = scheduleSchema.parse(request.body);
      await assertPresetBelongsToAccount(params.id, body.presetId);

      const now = Date.now();
      const scheduleId = randomUUID();
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId: params.id,
        presetId: body.presetId,
        name: body.name,
        enabled: body.enabled,
        weekdaysJson: JSON.stringify([...new Set(body.weekdays)].sort()),
        startTime: body.startTime,
        endTime: body.endTime,
        timezone: body.timezone,
        lastStartedWindow: null,
        lastStoppedWindow: null,
        createdAt: now,
        updatedAt: now,
      });
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.schedule.create",
        message: `Schedule "${body.name}" created.`,
        metadata: {
          ...operationContext(request, "schedule-create"),
          scheduleId,
          presetId: body.presetId,
        },
      });
      return getAccountSchedule(params.id, scheduleId);
    },
  );

  app.put(
    "/api/accounts/:id/schedules/:scheduleId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountScheduleParams.parse(request.params);
      const body = scheduleUpdateSchema.parse(request.body);
      const existing = await assertScheduleBelongsToAccount(
        params.id,
        params.scheduleId,
      );
      if (body.presetId) {
        await assertPresetBelongsToAccount(params.id, body.presetId);
      }

      const nextStart = body.startTime ?? existing.startTime;
      const nextEnd = body.endTime ?? existing.endTime;
      if (nextStart === nextEnd) {
        throw appError(
          "Start and end must not be identical.",
          400,
          ERROR_CODES.validation,
        );
      }

      await db
        .update(boostSchedule)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.presetId !== undefined ? { presetId: body.presetId } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.weekdays !== undefined
            ? {
                weekdaysJson: JSON.stringify(
                  [...new Set(body.weekdays)].sort(),
                ),
              }
            : {}),
          ...(body.startTime !== undefined
            ? { startTime: body.startTime }
            : {}),
          ...(body.endTime !== undefined ? { endTime: body.endTime } : {}),
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          updatedAt: Date.now(),
        })
        .where(eq(boostSchedule.id, params.scheduleId));
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.schedule.update",
        message: `Schedule "${body.name ?? existing.name}" saved.`,
        metadata: {
          ...operationContext(request, "schedule-update"),
          scheduleId: params.scheduleId,
        },
      });
      return getAccountSchedule(params.id, params.scheduleId);
    },
  );

  app.delete(
    "/api/accounts/:id/schedules/:scheduleId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountScheduleParams.parse(request.params);
      const schedule = await assertScheduleBelongsToAccount(
        params.id,
        params.scheduleId,
      );
      await db
        .delete(boostSchedule)
        .where(eq(boostSchedule.id, params.scheduleId));
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.schedule.delete",
        message: `Schedule "${schedule.name}" removed.`,
        metadata: {
          ...operationContext(request, "schedule-delete"),
          scheduleId: params.scheduleId,
        },
      });
      return { ok: true };
    },
  );

  app.get(
    "/api/accounts/:id/analytics",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      await assertAccountExists(params.id);
      return getAccountAnalytics(params.id);
    },
  );
}

async function assertPresetBelongsToAccount(
  accountId: string,
  presetId: string,
) {
  const preset = await db.query.boostPreset.findFirst({
    where: and(
      eq(boostPreset.id, presetId),
      eq(boostPreset.accountId, accountId),
    ),
  });
  if (!preset) {
    throw appError("Preset was not found.", 404, ERROR_CODES.presetNotFound);
  }
  return preset;
}

async function assertScheduleBelongsToAccount(
  accountId: string,
  scheduleId: string,
) {
  const schedule = await db.query.boostSchedule.findFirst({
    where: and(
      eq(boostSchedule.id, scheduleId),
      eq(boostSchedule.accountId, accountId),
    ),
  });
  if (!schedule) {
    throw appError(
      "Schedule was not found.",
      404,
      ERROR_CODES.scheduleNotFound,
    );
  }
  return schedule;
}

async function getAccountPresets(accountId: string) {
  const presets = await db
    .select()
    .from(boostPreset)
    .where(eq(boostPreset.accountId, accountId))
    .orderBy(desc(boostPreset.updatedAt));
  return Promise.all(presets.map((preset) => hydratePreset(preset)));
}

async function getAccountPreset(accountId: string, presetId: string) {
  const preset = await assertPresetBelongsToAccount(accountId, presetId);
  return hydratePreset(preset);
}

async function hydratePreset(preset: typeof boostPreset.$inferSelect) {
  const games = await db
    .select({
      appId: boostPresetGame.appId,
      name: steamAppCache.name,
    })
    .from(boostPresetGame)
    .leftJoin(steamAppCache, eq(steamAppCache.appId, boostPresetGame.appId))
    .where(eq(boostPresetGame.presetId, preset.id));

  return {
    ...preset,
    appIds: games.map((game) => game.appId),
    games: games.map((game) => ({
      appId: game.appId,
      name: game.name ?? `App ${game.appId}`,
    })),
  };
}

async function getAccountSchedules(accountId: string) {
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
    .where(eq(boostSchedule.accountId, accountId))
    .orderBy(desc(boostSchedule.updatedAt));

  return schedules.map((schedule) => ({
    ...schedule,
    weekdays: parseNumberArray(schedule.weekdaysJson),
  }));
}

async function getAccountSchedule(accountId: string, scheduleId: string) {
  await assertScheduleBelongsToAccount(accountId, scheduleId);
  const schedules = await getAccountSchedules(accountId);
  const schedule = schedules.find((item) => item.id === scheduleId);
  if (!schedule) {
    throw appError(
      "Schedule was not found.",
      404,
      ERROR_CODES.scheduleNotFound,
    );
  }
  return schedule;
}

async function getAccountAnalytics(accountId: string) {
  const now = Date.now();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const last7Days = now - 7 * 24 * 60 * 60_000;

  const sessions = await db
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

  const appNames = await getAppNameMap([
    ...new Set(
      sessions.flatMap((session) => parseNumberArray(session.appIdsJson)),
    ),
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
    for (const appId of parseNumberArray(session.appIdsJson)) {
      gameDurations.set(appId, (gameDurations.get(appId) ?? 0) + durationMs);
    }
  }

  return {
    todayMs,
    last7DaysMs,
    totalSessions: sessions.length,
    openSession: sessions.find((session) => !session.endedAt) ?? null,
    topGames: [...gameDurations.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([appId, durationMs]) => ({
        appId,
        name: appNames.get(appId) ?? `App ${appId}`,
        durationMs,
      })),
    recentSessions: sessions.slice(0, 12).map((session) => {
      const appIds = parseNumberArray(session.appIdsJson);
      return {
        ...session,
        appIds,
        durationMs: Math.max(0, (session.endedAt ?? now) - session.startedAt),
        apps: appIds.map((appId) => ({
          appId,
          name: appNames.get(appId) ?? `App ${appId}`,
        })),
      };
    }),
  };
}

function parseNumberArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => Number.isInteger(item));
  } catch {
    return [];
  }
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

async function assertAccountExists(accountId: string) {
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

function operationContext(
  request: FastifyRequest,
  action: string,
): OperationContext {
  return { correlationId: request.id, source: "api", action };
}
