import { ERROR_CODES } from "@steam-bee/contracts";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { boostPreset, boostSchedule } from "../db/schema.js";
import { appError } from "../http/errors.js";

export async function requirePresetForAccount(
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

export async function requireScheduleForAccount(
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
