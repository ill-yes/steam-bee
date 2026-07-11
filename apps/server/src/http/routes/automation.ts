import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "@steam-bee/contracts";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { boostPreset, boostSchedule } from "../../db/schema.js";
import { steamManager } from "../../steam/manager.js";
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
import { getAccountOrThrow } from "../../steam/account-repository.js";
import {
  requirePresetForAccount,
  requireScheduleForAccount,
} from "../../steam/automation-repository.js";
import { appError } from "../errors.js";
import { recordInfoEventSafely } from "../events.js";
import { requireAuth } from "../plugins.js";
import { operationContext } from "../operation-context.js";
import {
  getAccountAnalytics,
  getAccountPreset,
  getAccountPresets,
  getAccountSchedule,
  getAccountSchedules,
} from "../read-models/automation.js";

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
      return steamManager.runAccountOperation(params.id, async () => {
        const appIds = [...new Set(body.appIds)];
        enforceGameLimit(appIds, body.customTitle);
        await getAccountOrThrow(params.id);

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
        await recordInfoEventSafely({
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
      });
    },
  );

  app.put(
    "/api/accounts/:id/presets/:presetId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountPresetParams.parse(request.params);
      const body = presetSchema.parse(request.body);
      return steamManager.runAccountOperation(params.id, async () => {
        const appIds = [...new Set(body.appIds)];
        enforceGameLimit(appIds, body.customTitle);
        await requirePresetForAccount(params.id, params.presetId);

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
        await recordInfoEventSafely({
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
      });
    },
  );

  app.delete(
    "/api/accounts/:id/presets/:presetId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountPresetParams.parse(request.params);
      return steamManager.runAccountOperation(params.id, async () => {
        const preset = await requirePresetForAccount(
          params.id,
          params.presetId,
        );
        await db.delete(boostPreset).where(eq(boostPreset.id, params.presetId));
        await recordInfoEventSafely({
          accountId: params.id,
          type: "steam.preset.delete",
          message: `Preset "${preset.name}" removed.`,
          metadata: {
            ...operationContext(request, "preset-delete"),
            presetId: params.presetId,
          },
        });
        return { ok: true };
      });
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
      return steamManager.runAccountOperation(params.id, async () => {
        await requirePresetForAccount(params.id, body.presetId);

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
        await recordInfoEventSafely({
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
      });
    },
  );

  app.put(
    "/api/accounts/:id/schedules/:scheduleId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountScheduleParams.parse(request.params);
      const body = scheduleUpdateSchema.parse(request.body);
      return steamManager.runAccountOperation(params.id, async () => {
        const existing = await requireScheduleForAccount(
          params.id,
          params.scheduleId,
        );
        if (body.presetId) {
          await requirePresetForAccount(params.id, body.presetId);
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
        await recordInfoEventSafely({
          accountId: params.id,
          type: "steam.schedule.update",
          message: `Schedule "${body.name ?? existing.name}" saved.`,
          metadata: {
            ...operationContext(request, "schedule-update"),
            scheduleId: params.scheduleId,
          },
        });
        return getAccountSchedule(params.id, params.scheduleId);
      });
    },
  );

  app.delete(
    "/api/accounts/:id/schedules/:scheduleId",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountScheduleParams.parse(request.params);
      return steamManager.runAccountOperation(params.id, async () => {
        const schedule = await requireScheduleForAccount(
          params.id,
          params.scheduleId,
        );
        await db
          .delete(boostSchedule)
          .where(eq(boostSchedule.id, params.scheduleId));
        await recordInfoEventSafely({
          accountId: params.id,
          type: "steam.schedule.delete",
          message: `Schedule "${schedule.name}" removed.`,
          metadata: {
            ...operationContext(request, "schedule-delete"),
            scheduleId: params.scheduleId,
          },
        });
        return { ok: true };
      });
    },
  );

  app.get(
    "/api/accounts/:id/analytics",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      await getAccountOrThrow(params.id);
      return getAccountAnalytics(params.id);
    },
  );
}
