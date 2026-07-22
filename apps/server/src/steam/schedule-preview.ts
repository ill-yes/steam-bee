import type {
  SchedulePreview,
  SchedulePreviewItem,
} from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { boostPreset, boostSchedule, scheduleException } from "../db/schema.js";
import {
  parseWeekdays,
  zonedDateParts,
  zonedLocalTimeToEpoch,
} from "./scheduler.js";

type Candidate = SchedulePreviewItem & { updatedAt: number };

export async function buildSchedulePreview(
  accountId: string,
  days = 7,
  now = Date.now(),
): Promise<SchedulePreview> {
  const through = now + days * 24 * 60 * 60_000;
  const [schedules, exceptions] = await Promise.all([
    db
      .select({
        id: boostSchedule.id,
        name: boostSchedule.name,
        presetId: boostSchedule.presetId,
        presetName: boostPreset.name,
        enabled: boostSchedule.enabled,
        weekdaysJson: boostSchedule.weekdaysJson,
        startTime: boostSchedule.startTime,
        endTime: boostSchedule.endTime,
        timezone: boostSchedule.timezone,
        updatedAt: boostSchedule.updatedAt,
      })
      .from(boostSchedule)
      .leftJoin(boostPreset, eq(boostPreset.id, boostSchedule.presetId))
      .where(eq(boostSchedule.accountId, accountId)),
    db
      .select({ windowId: scheduleException.windowId })
      .from(scheduleException)
      .where(eq(scheduleException.accountId, accountId)),
  ]);
  const skipped = new Set(exceptions.map((exception) => exception.windowId));
  const candidates: Candidate[] = [];

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const weekdays = parseWeekdays(schedule.weekdaysJson);
    const dateKeys = localDateKeys(
      schedule.timezone,
      now - 24 * 60 * 60_000,
      through + 24 * 60 * 60_000,
    );
    for (const dateKey of dateKeys) {
      const localNoon = zonedLocalTimeToEpoch(
        dateKey,
        "12:00",
        schedule.timezone,
      );
      const weekday = zonedDateParts(
        new Date(localNoon),
        schedule.timezone,
      ).weekday;
      if (!weekdays.includes(weekday)) continue;

      const startsAt = zonedLocalTimeToEpoch(
        dateKey,
        schedule.startTime,
        schedule.timezone,
      );
      const overnight = schedule.startTime > schedule.endTime;
      const endDateKey = overnight ? addLocalDays(dateKey, 1) : dateKey;
      const endsAt = zonedLocalTimeToEpoch(
        endDateKey,
        schedule.endTime,
        schedule.timezone,
      );
      if (endsAt <= now || startsAt >= through || endsAt <= startsAt) continue;

      const windowId = `${schedule.id}:${dateKey}:${schedule.startTime}-${schedule.endTime}`;
      candidates.push({
        windowId,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        presetId: schedule.presetId,
        presetName: schedule.presetName,
        startsAt,
        endsAt,
        skipped: skipped.has(windowId),
        winner: false,
        conflictScheduleIds: [],
        updatedAt: schedule.updatedAt,
      });
    }
  }

  for (const candidate of candidates) {
    const overlaps = candidates.filter(
      (other) =>
        other.windowId !== candidate.windowId &&
        other.startsAt < candidate.endsAt &&
        other.endsAt > candidate.startsAt,
    );
    candidate.conflictScheduleIds = [
      ...new Set(overlaps.map((other) => other.scheduleId)),
    ];
    const sampleAt = candidate.startsAt;
    const active = candidates
      .filter(
        (other) =>
          !other.skipped &&
          other.startsAt <= sampleAt &&
          other.endsAt > sampleAt,
      )
      .sort((left, right) => {
        const startDifference = right.startsAt - left.startsAt;
        if (startDifference !== 0) return startDifference;
        const updateDifference = right.updatedAt - left.updatedAt;
        if (updateDifference !== 0) return updateDifference;
        return right.scheduleId.localeCompare(left.scheduleId);
      });
    candidate.winner = active[0]?.windowId === candidate.windowId;
  }

  return {
    generatedAt: now,
    through,
    timezoneCount: new Set(schedules.map((schedule) => schedule.timezone)).size,
    items: candidates
      .sort((left, right) => left.startsAt - right.startsAt)
      .map(({ updatedAt, ...item }) => {
        void updatedAt;
        return item;
      }),
  };
}

function localDateKeys(timezone: string, from: number, through: number) {
  const values = new Set<string>();
  for (let cursor = from; cursor <= through; cursor += 12 * 60 * 60_000) {
    values.add(zonedDateParts(new Date(cursor), timezone).dateKey);
  }
  return [...values].sort();
}

function addLocalDays(dateKey: string, days: number) {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}
