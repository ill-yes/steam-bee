import { interpolate, type LocaleOption, type Messages } from "../i18n";

export function formatTokenDate(
  value: number | null,
  messages: Messages,
  localeInfo: LocaleOption,
) {
  const { dateLocale } = localeInfo;
  if (!value) return messages.format.tokenNoExpiry;
  const date = new Date(value).toLocaleDateString(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return interpolate(messages.format.tokenValidUntil, { date });
}

export function formatBoostStartedAt(
  value: number | null,
  messages: Messages,
  localeInfo: LocaleOption,
) {
  if (!value) return messages.format.inactive;
  return new Date(value).toLocaleString(localeInfo.dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPlaytime(
  minutes: number | null | undefined,
  messages: Messages,
  localeInfo: LocaleOption,
) {
  const locale = localeInfo.dateLocale;
  if (!minutes) return messages.format.zeroHours;
  if (minutes < 60)
    return interpolate(messages.format.minutes, { count: minutes });
  return interpolate(messages.format.hours, {
    count: Math.round(minutes / 60).toLocaleString(locale),
  });
}

export function formatEventTime(value: number, localeInfo: LocaleOption) {
  return new Date(value).toLocaleTimeString(localeInfo.dateLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEventDate(value: number, localeInfo: LocaleOption) {
  return new Date(value).toLocaleDateString(localeInfo.dateLocale, {
    day: "2-digit",
    month: "2-digit",
  });
}

export function formatDateTime(value: number, dateLocale: string) {
  return new Date(value).toLocaleString(dateLocale, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatBoostRunningSince(
  value: number | null,
  messages: Messages,
  dateLocale: string,
) {
  if (!value) return messages.format.notActive;
  return new Date(value).toLocaleString(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDurationMs(
  value: number,
  messages: Messages,
  locale: string,
) {
  if (!value) return messages.format.zeroHours;
  const hours = value / 3_600_000;
  if (hours < 1) {
    return interpolate(messages.format.minutes, {
      count: Math.round(value / 60_000).toLocaleString(locale),
    });
  }
  return interpolate(messages.format.hours, {
    count: hours.toLocaleString(locale, {
      maximumFractionDigits: hours < 10 ? 1 : 0,
    }),
  });
}

export function weekdayLabels(dateLocale: string) {
  return weekdays([1, 2, 3, 4, 5, 6, 0], dateLocale);
}

export function formatWeekdays(days: number[], dateLocale: string) {
  return weekdays(days, dateLocale)
    .map((day) => day.label)
    .join(", ");
}

export function sameAppIdSelection(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort((a, b) => a - b);
  const rightSorted = [...right].sort((a, b) => a - b);
  return leftSorted.every((appId, index) => appId === rightSorted[index]);
}

function weekdays(days: number[], dateLocale: string) {
  const formatter = new Intl.DateTimeFormat(dateLocale, { weekday: "short" });
  const sunday = new Date(Date.UTC(2024, 0, 7));
  return days.map((value) => {
    const date = new Date(sunday);
    date.setUTCDate(sunday.getUTCDate() + value);
    return {
      value,
      label: formatter.format(date).replace(/\.$/, "") || String(value),
    };
  });
}
