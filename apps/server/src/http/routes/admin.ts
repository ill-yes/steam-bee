import { ERROR_CODES } from "@steam-bee/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import {
  changeAdminPassword,
  deleteAdminSessionById,
  deleteOtherAdminSessions,
  listAdminSessions,
} from "../../auth/service.js";
import { db, sqlite } from "../../db/client.js";
import {
  steamAccount,
  steamAccountLibrary,
  steamAppCache,
  steamEvent,
} from "../../db/schema.js";
import { steamManager, type OperationContext } from "../../steam/manager.js";
import { accountIdParams, passwordSchema } from "../../steam/validation.js";
import { appError } from "../errors.js";
import { recordInfoEvent } from "../events.js";
import { requireAuth } from "../plugins.js";

const adminPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
const adminSessionParams = z.object({ sessionId: z.string().uuid() });
const adminEventParams = z.object({
  eventId: z.coerce.number().int().positive(),
});
const adminEventCleanupQuery = z
  .object({
    olderThan: z.coerce.number().int().positive().optional(),
    level: z.enum(["info", "warn", "error"]).optional(),
  })
  .refine(
    (value) => value.olderThan !== undefined || value.level !== undefined,
    {
      message: "At least one cleanup filter is required.",
    },
  );
const adminAppParams = z.object({
  appId: z.coerce.number().int().positive().max(2_147_483_647),
});
const adminAppCacheCleanupQuery = z.object({
  unused: z.enum(["true"]).optional(),
});
const authRateLimit = {
  config: {
    rateLimit: { max: 5, timeWindow: "1 minute", groupId: "admin-auth" },
  },
};

export function registerAdminRoutes(app: FastifyInstance) {
  app.put(
    "/api/admin/password",
    { preHandler: requireAuth, ...authRateLimit },
    async (request) => {
      if (!request.session) {
        throw appError("Not signed in.", 401, ERROR_CODES.unauthorized);
      }
      const body = adminPasswordChangeSchema.parse(request.body);
      return changeAdminPassword(
        body.currentPassword,
        body.newPassword,
        request.session.id,
      );
    },
  );

  app.get(
    "/api/admin/sessions",
    { preHandler: requireAuth },
    async (request) => {
      if (!request.session) {
        throw appError("Not signed in.", 401, ERROR_CODES.unauthorized);
      }
      return listAdminSessions(request.session.id);
    },
  );

  app.delete(
    "/api/admin/sessions/others",
    { preHandler: requireAuth },
    async (request) => {
      if (!request.session) {
        throw appError("Not signed in.", 401, ERROR_CODES.unauthorized);
      }
      const revoked = await deleteOtherAdminSessions(request.session.id);
      return { ok: true, revoked };
    },
  );

  app.delete(
    "/api/admin/sessions/:sessionId",
    { preHandler: requireAuth },
    async (request) => {
      if (!request.session) {
        throw appError("Not signed in.", 401, ERROR_CODES.unauthorized);
      }
      const params = adminSessionParams.parse(request.params);
      const deleted = await deleteAdminSessionById(
        params.sessionId,
        request.session.id,
      );
      return { ok: true, deleted };
    },
  );

  app.get(
    "/api/admin/overview",
    { preHandler: requireAuth },
    async (request) => {
      if (!request.session) {
        throw appError("Not signed in.", 401, ERROR_CODES.unauthorized);
      }
      return getAdminOverview(request.session.id);
    },
  );

  app.delete(
    "/api/admin/events/:eventId",
    { preHandler: requireAuth },
    async (request) => {
      const params = adminEventParams.parse(request.params);
      const [event] = await db
        .select({ id: steamEvent.id })
        .from(steamEvent)
        .where(eq(steamEvent.id, params.eventId))
        .limit(1);
      if (!event) return { ok: true, deleted: false };

      await db.delete(steamEvent).where(eq(steamEvent.id, params.eventId));
      return { ok: true, deleted: true };
    },
  );

  app.delete(
    "/api/admin/events",
    { preHandler: requireAuth },
    async (request) => {
      const query = adminEventCleanupQuery.parse(request.query);
      const conditions = [
        ...(query.olderThan !== undefined
          ? [lt(steamEvent.createdAt, query.olderThan)]
          : []),
        ...(query.level !== undefined
          ? [eq(steamEvent.level, query.level)]
          : []),
      ];
      const where =
        conditions.length === 1 ? conditions[0] : and(...conditions);
      const events = await db
        .select({ id: steamEvent.id })
        .from(steamEvent)
        .where(where);

      if (events.length === 0) return { ok: true, deleted: 0 };

      await db.delete(steamEvent).where(
        inArray(
          steamEvent.id,
          events.map((event) => event.id),
        ),
      );
      return { ok: true, deleted: events.length };
    },
  );

  app.delete(
    "/api/admin/accounts/:id/library",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      await assertAccountExists(params.id);
      const entries = await db
        .select({ appId: steamAccountLibrary.appId })
        .from(steamAccountLibrary)
        .where(eq(steamAccountLibrary.accountId, params.id));

      if (entries.length > 0) {
        await db
          .delete(steamAccountLibrary)
          .where(eq(steamAccountLibrary.accountId, params.id));
      }

      await recordInfoEvent({
        accountId: params.id,
        type: "admin.library.clear",
        message: `${entries.length} library entries removed in the admin area.`,
        metadata: operationContext(request, "admin-library-clear"),
      });
      return { ok: true, deleted: entries.length };
    },
  );

  app.delete(
    "/api/admin/app-cache",
    { preHandler: requireAuth },
    async (request) => {
      const query = adminAppCacheCleanupQuery.parse(request.query);
      if (query.unused !== "true") {
        throw new Error("Only unused app data cleanup is allowed.");
      }

      const unusedAppIds = getUnusedAppCacheIds();
      if (unusedAppIds.length > 0) {
        await db
          .delete(steamAppCache)
          .where(inArray(steamAppCache.appId, unusedAppIds));
      }
      return { ok: true, deleted: unusedAppIds.length };
    },
  );

  app.delete(
    "/api/admin/app-cache/:appId",
    { preHandler: requireAuth },
    async (request) => {
      const params = adminAppParams.parse(request.params);
      const [appEntry] = await db
        .select({ appId: steamAppCache.appId })
        .from(steamAppCache)
        .where(eq(steamAppCache.appId, params.appId))
        .limit(1);
      if (!appEntry) return { ok: true, deleted: false };

      const libraryEntries = await db
        .select({ appId: steamAccountLibrary.appId })
        .from(steamAccountLibrary)
        .where(eq(steamAccountLibrary.appId, params.appId));

      await db
        .delete(steamAppCache)
        .where(eq(steamAppCache.appId, params.appId));
      return {
        ok: true,
        deleted: true,
        removedLibraryEntries: libraryEntries.length,
      };
    },
  );
}

async function getAdminOverview(currentSessionId: string) {
  const accounts = await db
    .select()
    .from(steamAccount)
    .orderBy(desc(steamAccount.updatedAt));
  const events = await db
    .select()
    .from(steamEvent)
    .orderBy(desc(steamEvent.createdAt))
    .limit(100);
  const sessions = await listAdminSessions(currentSessionId);
  const presets = getAdminPresets();
  const schedules = getAdminSchedules();
  const apps = getAdminAppCache();

  return {
    generatedAt: Date.now(),
    totals: {
      accounts: accounts.length,
      sessions: sessions.length,
      events: countRows("steam_event"),
      presets: countRows("boost_preset"),
      schedules: countRows("boost_schedule"),
      appCache: countRows("steam_app_cache"),
      libraryEntries: countRows("steam_account_library"),
      selectedGames: countRows("steam_account_game"),
    },
    sessions,
    accounts: accounts.map((account) => ({
      ...sanitizeAccount(account),
      runtimeStatus: steamManager.getStatus(account.id),
      selectedGameCount: countRows(
        "steam_account_game",
        "account_id",
        account.id,
      ),
      libraryAppCount: countRows(
        "steam_account_library",
        "account_id",
        account.id,
      ),
      presetCount: countRows("boost_preset", "account_id", account.id),
      scheduleCount: countRows("boost_schedule", "account_id", account.id),
      eventCount: countRows("steam_event", "account_id", account.id),
    })),
    events,
    presets,
    schedules,
    apps,
  };
}

function countRows(table: string, column?: string, value?: string) {
  const allowedTables = new Set([
    "admin_session",
    "boost_preset",
    "boost_schedule",
    "steam_account",
    "steam_account_game",
    "steam_account_library",
    "steam_app_cache",
    "steam_event",
  ]);
  const allowedColumns = new Set(["account_id"]);
  if (!allowedTables.has(table)) throw new Error("Invalid table.");
  if (column && !allowedColumns.has(column)) throw new Error("Invalid column.");

  const sql = column
    ? `SELECT count(*) as count FROM ${table} WHERE ${column} = ?`
    : `SELECT count(*) as count FROM ${table}`;
  const row = column
    ? sqlite.prepare(sql).get(value)
    : sqlite.prepare(sql).get();
  return Number((row as { count: number } | undefined)?.count ?? 0);
}

function getAdminPresets() {
  return sqlite
    .prepare(
      `
      SELECT
        preset.id,
        preset.account_id as accountId,
        account.account_name as accountName,
        preset.name,
        preset.persona_state as personaState,
        preset.custom_title as customTitle,
        preset.created_at as createdAt,
        preset.updated_at as updatedAt,
        count(game.app_id) as appCount
      FROM boost_preset preset
      LEFT JOIN steam_account account ON account.id = preset.account_id
      LEFT JOIN boost_preset_game game ON game.preset_id = preset.id
      GROUP BY preset.id
      ORDER BY preset.updated_at DESC
      LIMIT 200
      `,
    )
    .all()
    .map((row) => {
      const item = row as {
        id: string;
        accountId: string;
        accountName: string | null;
        name: string;
        personaState: number;
        customTitle: string | null;
        createdAt: number;
        updatedAt: number;
        appCount: number;
      };
      return {
        ...item,
        appCount: Number(item.appCount),
      };
    });
}

function getAdminSchedules() {
  return sqlite
    .prepare(
      `
      SELECT
        schedule.id,
        schedule.account_id as accountId,
        account.account_name as accountName,
        schedule.preset_id as presetId,
        preset.name as presetName,
        schedule.name,
        schedule.enabled,
        schedule.weekdays_json as weekdaysJson,
        schedule.start_time as startTime,
        schedule.end_time as endTime,
        schedule.timezone,
        schedule.created_at as createdAt,
        schedule.updated_at as updatedAt
      FROM boost_schedule schedule
      LEFT JOIN steam_account account ON account.id = schedule.account_id
      LEFT JOIN boost_preset preset ON preset.id = schedule.preset_id
      ORDER BY schedule.updated_at DESC
      LIMIT 200
      `,
    )
    .all()
    .map((row) => {
      const item = row as {
        id: string;
        accountId: string;
        accountName: string | null;
        presetId: string;
        presetName: string | null;
        name: string;
        enabled: 0 | 1 | boolean;
        weekdaysJson: string;
        startTime: string;
        endTime: string;
        timezone: string;
        createdAt: number;
        updatedAt: number;
      };
      return {
        ...item,
        enabled: Boolean(item.enabled),
        weekdays: parseNumberArray(item.weekdaysJson),
        weekdaysJson: undefined,
      };
    });
}

function getAdminAppCache() {
  return sqlite
    .prepare(
      `
      SELECT
        app.app_id as appId,
        app.name,
        app.playtime_forever as playtimeForever,
        app.source,
        app.updated_at as updatedAt,
        (SELECT count(*) FROM steam_account_library library WHERE library.app_id = app.app_id) as libraryAccountCount,
        (SELECT count(*) FROM steam_account_game selected WHERE selected.app_id = app.app_id) as selectedAccountCount,
        (SELECT count(*) FROM boost_preset_game preset_game WHERE preset_game.app_id = app.app_id) as presetCount
      FROM steam_app_cache app
      ORDER BY app.updated_at DESC
      LIMIT 200
      `,
    )
    .all()
    .map((row) => {
      const item = row as {
        appId: number;
        name: string;
        playtimeForever: number | null;
        source: string;
        updatedAt: number;
        libraryAccountCount: number;
        selectedAccountCount: number;
        presetCount: number;
      };
      return {
        ...item,
        playtimeForever: Number(item.playtimeForever ?? 0),
        libraryAccountCount: Number(item.libraryAccountCount),
        selectedAccountCount: Number(item.selectedAccountCount),
        presetCount: Number(item.presetCount),
      };
    });
}

function getUnusedAppCacheIds() {
  return sqlite
    .prepare(
      `
      SELECT app.app_id as appId
      FROM steam_app_cache app
      WHERE NOT EXISTS (
        SELECT 1 FROM steam_account_library library WHERE library.app_id = app.app_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM steam_account_game selected WHERE selected.app_id = app.app_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM boost_preset_game preset_game WHERE preset_game.app_id = app.app_id
      )
      `,
    )
    .all()
    .map((row) => Number((row as { appId: number }).appId));
}

function operationContext(
  request: FastifyRequest,
  action: string,
): OperationContext {
  return { correlationId: request.id, source: "api", action };
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

function parseNumberArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => Number.isInteger(item));
  } catch {
    return [];
  }
}

function sanitizeAccount(account: typeof steamAccount.$inferSelect) {
  const {
    tokenCiphertext,
    tokenIv,
    tokenAuthTag,
    tokenKeyVersion,
    ...safeAccount
  } = account;
  void tokenCiphertext;
  void tokenIv;
  void tokenAuthTag;
  void tokenKeyVersion;
  return safeAccount;
}
