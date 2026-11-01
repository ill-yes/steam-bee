import type { Messages } from "../../../i18n";

const en = {
  presetsDescription:
    "Saved game selections with online status and Steam title. One click loads one, and schedules use them automatically.",
  saveCurrent: "Save current selection",
  saveCurrentHint: "{games} · {persona}{title}",
  noTitle: " · no title",
  withTitle: " · title “{title}”",
  runningNow: "Running now",
  activeButton: "Active",
  gamesCount: "{count} games",
  gameCount: "1 game",
  usedBySchedules: "in {count} schedules",
  usedBySchedule: "in 1 schedule",
  morePresetGames: "+{count}",
  newPresetTitle: "Save as preset",
  newPresetDescription:
    "Stores the games currently selected for boosting, the online status and the Steam title.",
  cancel: "Cancel",
  schedulesDescription:
    "Starts a preset at fixed times and pauses again afterwards.",
  newSchedule: "New schedule",
  timezone: "Time zone",
  thisWeek: "This week",
  weekLabel: "Weekly plan of enabled and disabled schedules",
  offSuffix: "off",
  nextStart: "next start {time}",
  noNextStart: "no start in the next 7 days",
  skippedNext: "next start skipped",
  disabled: "switched off",
  everyDay: "daily",
  weekdaysShort: "Mon–Fri",
  presetNamed: "Preset “{name}”",
  toggleSchedule: "{name} on or off",
  upcoming: "Upcoming windows",
  analyticsDescription: "How long SteamBee reported games for this account.",
  runningNowShort: "Running now",
  notRunning: "Nothing right now",
  last7Days: "Last 7 days",
  perDay: "Ø {value} per day",
  totalSessions: "Sessions",
  allTime: "in total",
  playtimePerDay: "Playtime per day",
  playtimePerDayLabel: "Reported playtime per day over the last 7 days",
  todayShort: "Today",
  goalProgress: "{current} of {target} h",
  goalLeft: "{hours} h left",
  goalReached: "reached",
};

type Copy = typeof en;

export type AutomationCopy = Copy;
export { en as automationEn };

/** Presets, schedules and statistics copy; translations load with the locale. */
export function automationCopy(messages: Messages): AutomationCopy {
  return messages.automation;
}
