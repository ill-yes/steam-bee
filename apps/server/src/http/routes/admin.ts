import { ERROR_CODES, MAX_STEAM_APP_ID } from "@steam-bee/contracts";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import {
  changeAdminPassword,
  deleteAdminSessionById,
  deleteOtherAdminSessions,
  listAdminSessions,
} from "../../auth/service.js";
import { db } from "../../db/client.js";
import {
  steamAccountLibrary,
  steamAppCache,
  steamEvent,
} from "../../db/schema.js";
import { accountIdParams, passwordSchema } from "../../steam/validation.js";
import { getAccountOrThrow } from "../../steam/account-repository.js";
import {
  getAdminOverview,
  listUnusedAppCacheIds,
} from "../read-models/admin.js";
import { appError } from "../errors.js";
import { recordInfoEventSafely } from "../events.js";
import { operationContext } from "../operation-context.js";
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
  appId: z.coerce.number().int().positive().max(MAX_STEAM_APP_ID),
});
const adminAppCacheCleanupQuery = z.object({
  unused: z.literal("true"),
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
      await getAccountOrThrow(params.id);
      const entries = await db
        .select({ appId: steamAccountLibrary.appId })
        .from(steamAccountLibrary)
        .where(eq(steamAccountLibrary.accountId, params.id));

      if (entries.length > 0) {
        await db
          .delete(steamAccountLibrary)
          .where(eq(steamAccountLibrary.accountId, params.id));
      }

      await recordInfoEventSafely({
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
      adminAppCacheCleanupQuery.parse(request.query);

      const unusedAppIds = listUnusedAppCacheIds();
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
