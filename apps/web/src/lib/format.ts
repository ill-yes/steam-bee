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

export function sameAppIdSelection(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort((a, b) => a - b);
  const rightSorted = [...right].sort((a, b) => a - b);
  return leftSorted.every((appId, index) => appId === rightSorted[index]);
}
