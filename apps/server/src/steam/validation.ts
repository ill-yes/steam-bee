import { z } from "zod";
import {
  ERROR_CODES,
  MAX_GAMES,
  MAX_STEAM_APP_ID,
  PERSONA_STATE_VALUES,
  gameSelectionLimit,
  type PersonaState,
} from "@steam-bee/contracts";
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

export const appIdSchema = z.number().int().positive().max(MAX_STEAM_APP_ID);

export const personaStateSchema = z
  .number()
  .int()
  .refine(
    (value): value is PersonaState =>
      PERSONA_STATE_VALUES.includes(value as PersonaState),
    "Persona state is not supported.",
  );

export const gameUpdateSchema = z.object({
  appIds: z.array(appIdSchema).max(MAX_GAMES),
});

export const settingsSchema = z.object({
  personaState: personaStateSchema,
  customTitle: z.string().trim().max(80).nullable(),
});

export const presetSchema = z.object({
  name: z.string().trim().min(1).max(64),
  appIds: z.array(appIdSchema).max(MAX_GAMES),
  personaState: personaStateSchema,
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
  const limit = gameSelectionLimit(customTitle);
  if (appIds.length > limit) {
    throw appError(
      `Too many games selected. This configuration allows at most ${limit} entries.`,
      400,
      ERROR_CODES.validation,
    );
  }
}
