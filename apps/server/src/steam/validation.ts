import { z } from "zod";
import { ERROR_CODES } from "@steam-bee/contracts";
import { appError } from "../http/errors.js";
import { isValidTimeZone } from "./scheduler.js";

export const passwordSchema = z.string().min(12).max(256);

export const accountIdParams = z.object({
  id: z.string().uuid(),
});

export const accountPresetParams = accountIdParams.extend({
  presetId: z.string().uuid(),
});

export const accountScheduleParams = accountIdParams.extend({
  scheduleId: z.string().uuid(),
});

export const appIdSchema = z.number().int().positive().max(2_147_483_647);

export const gameUpdateSchema = z.object({
  appIds: z.array(appIdSchema).max(32),
});

export const settingsSchema = z.object({
  personaState: z.number().int().min(0).max(7),
  customTitle: z.string().trim().max(80).nullable(),
});

export const presetSchema = z.object({
  name: z.string().trim().min(1).max(64),
  appIds: z.array(appIdSchema).max(32),
  personaState: z.number().int().min(0).max(7),
  customTitle: z.string().trim().max(80).nullable(),
});

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm.");

const scheduleBaseSchema = z.object({
  name: z.string().trim().min(1).max(64),
  presetId: z.string().uuid(),
  enabled: z.boolean().default(true),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: timeSchema,
  endTime: timeSchema,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(isValidTimeZone, "Timezone must be a valid IANA identifier."),
});

export const scheduleSchema = scheduleBaseSchema.refine(
  (value) => value.startTime !== value.endTime,
  {
    message: "Start and end must not be identical.",
    path: ["endTime"],
  },
);

export const scheduleUpdateSchema = scheduleBaseSchema
  .partial()
  .refine(
    (value) =>
      !value.startTime || !value.endTime || value.startTime !== value.endTime,
    {
      message: "Start and end must not be identical.",
      path: ["endTime"],
    },
  );

export const libraryMetaSchema = z.object({
  appId: appIdSchema,
  favorite: z.boolean().optional(),
  hidden: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
});

export const credentialsLoginSchema = z.object({
  accountName: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  guardCode: z.string().trim().min(1).max(16).optional(),
});

export function enforceGameLimit(
  appIds: number[],
  customTitle?: string | null,
) {
  const limit = customTitle?.trim() ? 31 : 32;
  if (appIds.length > limit) {
    throw appError(
      `Too many games selected. This configuration allows at most ${limit} entries.`,
      400,
      ERROR_CODES.validation,
    );
  }
}
