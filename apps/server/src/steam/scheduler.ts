export type ScheduleWindowInput = {
  id: string;
  weekdaysJson: string;
  startTime: string;
  endTime: string;
  timezone: string;
};

export type ScheduleWindowState = {
  active: boolean;
  windowId: string | null;
  windowStartedAt: number | null;
};

export function selectScheduleWinner<
  T extends { id: string; updatedAt: number },
>(entries: Array<{ schedule: T; state: ScheduleWindowState | null }>) {
  return entries
    .filter(
      (entry) =>
        entry.state?.active &&
        entry.state.windowId &&
        entry.state.windowStartedAt !== null,
    )
    .sort((left, right) => {
      const startDifference =
        (right.state?.windowStartedAt ?? 0) -
        (left.state?.windowStartedAt ?? 0);
      if (startDifference !== 0) return startDifference;
      const updateDifference =
        right.schedule.updatedAt - left.schedule.updatedAt;
      if (updateDifference !== 0) return updateDifference;
      return right.schedule.id.localeCompare(left.schedule.id);
    })[0];
}

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function evaluateScheduleWindow(
  schedule: ScheduleWindowInput,
  now = new Date(),
): ScheduleWindowState {
  const weekdays = parseWeekdays(schedule.weekdaysJson);
  if (weekdays.length === 0) return inactiveWindow();

  const parts = zonedDateParts(now, schedule.timezone);
  const minute = timeToMinute(parts.time);
  const startMinute = timeToMinute(schedule.startTime);
  const endMinute = timeToMinute(schedule.endTime);
  const overnight = startMinute > endMinute;

  if (!overnight) {
    const active =
      weekdays.includes(parts.weekday) &&
      minute >= startMinute &&
      minute < endMinute;
    return {
      active,
      windowId: active
        ? `${schedule.id}:${parts.dateKey}:${schedule.startTime}-${schedule.endTime}`
        : null,
      windowStartedAt: active
        ? zonedLocalTimeToEpoch(
            parts.dateKey,
            schedule.startTime,
            schedule.timezone,
          )
        : null,
    };
  }

  if (weekdays.includes(parts.weekday) && minute >= startMinute) {
    return {
      active: true,
      windowId: `${schedule.id}:${parts.dateKey}:${schedule.startTime}-${schedule.endTime}`,
      windowStartedAt: zonedLocalTimeToEpoch(
        parts.dateKey,
        schedule.startTime,
        schedule.timezone,
      ),
    };
  }

  const previousWeekday = (parts.weekday + 6) % 7;
  if (weekdays.includes(previousWeekday) && minute < endMinute) {
    const previousDateKey = zonedDateParts(
      new Date(now.getTime() - 24 * 60 * 60_000),
      schedule.timezone,
    ).dateKey;
    return {
      active: true,
      windowId: `${schedule.id}:${previousDateKey}:${schedule.startTime}-${schedule.endTime}`,
      windowStartedAt: zonedLocalTimeToEpoch(
        previousDateKey,
        schedule.startTime,
        schedule.timezone,
      ),
    };
  }

  return inactiveWindow();
}

export function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function parseWeekdays(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (item): item is number =>
            Number.isInteger(item) && item >= 0 && item <= 6,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

function zonedDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
    weekday: weekdayIndex[value("weekday")] ?? 0,
  };
}

function timeToMinute(value: string) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function inactiveWindow(): ScheduleWindowState {
  return { active: false, windowId: null, windowStartedAt: null };
}

function zonedLocalTimeToEpoch(
  dateKey: string,
  time: string,
  timezone: string,
) {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedDateParts(new Date(candidate), timezone);
    const [localYear = 0, localMonth = 1, localDay = 1] = parts.dateKey
      .split("-")
      .map(Number);
    const [localHour = 0, localMinute = 0] = parts.time.split(":").map(Number);
    const represented = Date.UTC(
      localYear,
      localMonth - 1,
      localDay,
      localHour,
      localMinute,
    );
    const correction = target - represented;
    candidate += correction;
    if (correction === 0) break;
  }

  return candidate;
}
