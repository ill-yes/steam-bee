import { useEffect, useState } from "react";
import {
  CalendarClock,
  Plus,
  RefreshCw,
  SkipForward,
  Trash2,
} from "lucide-react";
import type { BoostPreset, BoostSchedule, SchedulePreview } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Input, Select } from "../../../components/ui/form";
import { formatWeekdays, weekdayLabels } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { interpolate, useI18n } from "../../../i18n";
import type { ResourceLoadState } from "../useAccountController";
import { automationCopy } from "./automationCopy";

/** One fill and one dashed outline per schedule, repeated after five schedules. */
const palette = [
  { fill: "bg-[#2563a8]", line: "border-[#2563a8] text-[#2563a8]" },
  { fill: "bg-[#c2410c]", line: "border-[#c2410c] text-[#c2410c]" },
  { fill: "bg-[#6b4fa0]", line: "border-[#6b4fa0] text-[#6b4fa0]" },
  { fill: "bg-[#0f766e]", line: "border-[#0f766e] text-[#0f766e]" },
  { fill: "bg-[#a16207]", line: "border-[#a16207] text-[#a16207]" },
];
const dayMinutes = 24 * 60;
const weekOrder = [1, 2, 3, 4, 5, 6, 0];

type Block = {
  schedule: BoostSchedule;
  color: (typeof palette)[number];
  start: number;
  end: number;
};

function minutes(time: string) {
  const [hours, mins] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (mins ?? 0);
}

const weekMinutes = 7 * dayMinutes;

/** Minutes the zone is ahead of UTC at the given instant. */
export function zoneOffsetMinutes(zone: string, at: number) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(at)
        .map((part) => [part.type, part.value]),
    );
    const wallClock = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    return Math.round((wallClock - Math.floor(at / 60_000) * 60_000) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * Splits each schedule window into per-weekday blocks in the viewer's zone:
 * a schedule saved in another zone is shifted, and windows that cross
 * midnight continue on the next day.
 */
export function weekBlocks(
  schedules: BoostSchedule[],
  displayZone?: string,
  at = Date.now(),
) {
  const days = new Map<number, Block[]>(weekOrder.map((day) => [day, []]));
  const displayOffset = displayZone ? zoneOffsetMinutes(displayZone, at) : 0;
  schedules.forEach((schedule, index) => {
    const color = palette[index % palette.length]!;
    const shift =
      displayZone && schedule.timezone && schedule.timezone !== displayZone
        ? displayOffset - zoneOffsetMinutes(schedule.timezone, at)
        : 0;
    const start = minutes(schedule.startTime);
    let length = minutes(schedule.endTime) - start;
    if (length <= 0) length += dayMinutes;
    for (const day of schedule.weekdays) {
      let from =
        (((day * dayMinutes + start + shift) % weekMinutes) + weekMinutes) %
        weekMinutes;
      let left = length;
      while (left > 0) {
        const weekday = Math.floor(from / dayMinutes);
        const offset = from - weekday * dayMinutes;
        const end = Math.min(dayMinutes, offset + left);
        days.get(weekday)?.push({ schedule, color, start: offset, end });
        left -= end - offset;
        from = ((weekday + 1) % 7) * dayMinutes;
      }
    }
  });
  return days;
}

export function SchedulePanel({
  schedules,
  presets,
  scheduleName,
  schedulePresetId,
  scheduleStart,
  scheduleEnd,
  scheduleWeekdays,
  timezone,
  busyAction,
  onScheduleNameChange,
  onSchedulePresetChange,
  onScheduleStartChange,
  onScheduleEndChange,
  onToggleWeekday,
  onCreateSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  preview,
  previewState = "ready",
  onRefreshPreview,
  onSkipNext,
}: {
  schedules: BoostSchedule[];
  presets: BoostPreset[];
  scheduleName: string;
  schedulePresetId: string;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleWeekdays: number[];
  timezone: string;
  busyAction: string | null;
  onScheduleNameChange: (value: string) => void;
  onSchedulePresetChange: (value: string) => void;
  onScheduleStartChange: (value: string) => void;
  onScheduleEndChange: (value: string) => void;
  onToggleWeekday: (day: number) => void;
  /** Resolves true once the schedule is stored. */
  onCreateSchedule: () => Promise<boolean> | void;
  onToggleSchedule: (schedule: BoostSchedule) => void;
  onDeleteSchedule: (schedule: BoostSchedule) => void;
  preview: SchedulePreview | null;
  previewState?: ResourceLoadState;
  onRefreshPreview: () => void;
  onSkipNext: (schedule: BoostSchedule) => void;
}) {
  const { messages: t, localeInfo, locale } = useI18n();
  const o = t.operations;
  const c = automationCopy(t);
  const busy = Boolean(busyAction);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const previewItems = Array.isArray(preview?.items) ? preview.items : [];
  const blocks = weekBlocks(schedules, timezone, now);
  const labels = new Map(
    weekdayLabels(localeInfo.dateLocale).map((day) => [day.value, day.label]),
  );
  const longLabels = new Map(
    weekOrder.map((day) => [
      day,
      new Intl.DateTimeFormat(localeInfo.dateLocale, {
        weekday: "long",
      }).format(new Date(2024, 0, day === 0 ? 7 : day)),
    ]),
  );
  const today = new Date(now);
  const nowPercent =
    ((today.getHours() * 60 + today.getMinutes()) / dayMinutes) * 100;
  const startFormat = new Intl.DateTimeFormat(localeInfo.dateLocale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  function nextStart(schedule: BoostSchedule) {
    const next = previewItems.find(
      (item) => item.scheduleId === schedule.id && item.startsAt >= now,
    );
    if (!next) return c.noNextStart;
    if (next.skipped) return c.skippedNext;
    return interpolate(c.nextStart, {
      time: startFormat.format(next.startsAt),
    });
  }
  function daysText(days: number[]) {
    const sorted = [...days].sort();
    if (sorted.length === 7) return c.everyDay;
    if (sorted.join() === "1,2,3,4,5") return c.weekdaysShort;
    return formatWeekdays(
      weekOrder.filter((day) => days.includes(day)),
      localeInfo.dateLocale,
    );
  }
  async function create() {
    if ((await onCreateSchedule()) !== false) setCreating(false);
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          {c.timezone}: {timezone}
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          <Plus size={15} aria-hidden="true" />
          {c.newSchedule}
        </Button>
      </div>

      <figure className="m-0 grid min-w-0 gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <figcaption className="mb-1 text-sm font-semibold">
          {c.thisWeek}
        </figcaption>
        <div
          aria-hidden="true"
          className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-[11px] text-[var(--muted)]"
        >
          <span />
          <div className="flex justify-between">
            <span>0:00</span>
            <span>6:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </div>
        <ul className="grid gap-1" aria-label={c.weekLabel}>
          {weekOrder.map((day) => {
            const isToday = today.getDay() === day;
            const dayBlocks = blocks.get(day) ?? [];
            return (
              <li
                key={day}
                className="grid min-h-8 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2"
              >
                <span
                  className={cn(
                    "truncate text-sm",
                    isToday && "font-bold text-[var(--good)]",
                  )}
                >
                  {longLabels.get(day)}
                </span>
                <div
                  className={cn(
                    "relative h-6 rounded-md bg-[repeating-linear-gradient(90deg,var(--surface-2)_0_calc(25%-1px),var(--line)_calc(25%-1px)_25%)]",
                    isToday && "outline outline-2 outline-[var(--good)]",
                  )}
                >
                  {dayBlocks.map((block, index) => (
                    <span
                      key={`${block.schedule.id}-${index}`}
                      title={`${block.schedule.name} · ${block.schedule.startTime}–${block.schedule.endTime}`}
                      className={cn(
                        "absolute inset-y-0 overflow-hidden whitespace-nowrap rounded px-1.5 text-[11px] font-semibold leading-6",
                        block.schedule.enabled
                          ? `${block.color.fill} text-white`
                          : `border-2 border-dashed bg-[var(--surface)] leading-5 ${block.color.line}`,
                      )}
                      style={{
                        insetInlineStart: `${(block.start / dayMinutes) * 100}%`,
                        width: `${((block.end - block.start) / dayMinutes) * 100}%`,
                      }}
                    >
                      {block.schedule.name}
                      {block.schedule.enabled ? "" : ` (${c.offSuffix})`}
                    </span>
                  ))}
                  {isToday && (
                    <span
                      className="absolute -inset-y-1 w-0.5 bg-[var(--good)]"
                      style={{ insetInlineStart: `${nowPercent}%` }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </figure>

      {schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--muted)]">
          {t.tools.noSchedules}
        </div>
      ) : (
        <ul className="grid min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          {schedules.map((schedule, index) => {
            const color = palette[index % palette.length]!;
            const canSkip = previewItems.some(
              (item) =>
                item.scheduleId === schedule.id &&
                !item.skipped &&
                item.startsAt >= now,
            );
            return (
              <li
                key={schedule.id}
                className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--line)] px-4 py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-sm",
                    color.fill,
                    !schedule.enabled && "opacity-40",
                  )}
                />
                <div className="min-w-0 flex-[1_1_12rem]">
                  <strong
                    className={cn(
                      "block truncate text-sm",
                      !schedule.enabled && "text-[var(--muted)]",
                    )}
                  >
                    {schedule.name}
                  </strong>
                  <span
                    className={cn(
                      "text-xs",
                      schedule.enabled && canSkip
                        ? "font-semibold text-[var(--good)]"
                        : "text-[var(--muted)]",
                    )}
                  >
                    {schedule.enabled ? nextStart(schedule) : c.disabled}
                  </span>
                </div>
                <span className="flex-[1_1_9rem] text-sm">
                  {daysText(schedule.weekdays)} · {schedule.startTime}–
                  {schedule.endTime}
                  {schedule.timezone && schedule.timezone !== timezone
                    ? ` (${schedule.timezone})`
                    : ""}
                </span>
                <span className="min-w-0 flex-[1_1_9rem] truncate text-sm text-[var(--muted)]">
                  {interpolate(c.presetNamed, {
                    name: schedule.presetName ?? t.tools.preset,
                  })}
                </span>
                <div className="ms-auto flex items-center gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={schedule.enabled}
                    aria-label={interpolate(c.toggleSchedule, {
                      name: schedule.name,
                    })}
                    disabled={busy}
                    onClick={() => onToggleSchedule(schedule)}
                    className={cn(
                      "relative mx-1 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50",
                      schedule.enabled
                        ? "bg-[var(--good)]"
                        : "bg-[var(--line-strong)]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[inset-inline-start]",
                        schedule.enabled ? "inset-s-[23px]" : "inset-s-[3px]",
                      )}
                    />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || !canSkip}
                    onClick={() => onSkipNext(schedule)}
                    aria-label={`${schedule.name}: ${o.skipNext}`}
                    title={o.skipNext}
                  >
                    <SkipForward size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => onDeleteSchedule(schedule)}
                    aria-label={`${schedule.name} ${t.tools.deleteSchedule}`}
                    title={t.tools.deleteSchedule}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{c.upcoming}</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {o.timelineDescription}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            onClick={onRefreshPreview}
            aria-label={o.refreshTimeline}
            title={o.refreshTimeline}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </Button>
        </div>
        <ol className="grid gap-1">
          {previewState === "loading" ? (
            <li role="status" className="text-xs text-[var(--muted)]">
              {t.common.loading}
            </li>
          ) : previewState === "error" ? (
            <li role="alert" className="text-xs text-[var(--danger)]">
              {o.failed}
            </li>
          ) : previewItems.length === 0 ? (
            <li className="text-xs text-[var(--muted)]">{o.noUpcomingRuns}</li>
          ) : (
            previewItems.slice(0, 6).map((item) => (
              <li
                key={item.windowId}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 text-sm",
                  item.skipped && "text-[var(--muted)]",
                )}
              >
                <time
                  className={cn(
                    "w-32 tabular-nums",
                    item.skipped && "line-through",
                  )}
                  dateTime={new Date(item.startsAt).toISOString()}
                >
                  {startFormat.format(item.startsAt)}
                </time>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    item.skipped && "line-through",
                  )}
                >
                  {item.scheduleName}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {item.skipped
                    ? o.skipped
                    : item.conflictScheduleIds.length > 0
                      ? item.winner
                        ? o.winner
                        : o.conflict
                      : null}
                </span>
              </li>
            ))
          )}
        </ol>
      </section>

      {creating && (
        <Dialog
          title={c.newSchedule}
          description={c.schedulesDescription}
          onClose={() => setCreating(false)}
          closeDisabled={busyAction === "schedule-create"}
          className="max-w-md"
        >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Input
              value={scheduleName}
              onChange={(event) => onScheduleNameChange(event.target.value)}
              placeholder={t.tools.scheduleNamePlaceholder}
              aria-label={t.tools.scheduleNameAria}
            />
            <Select
              value={schedulePresetId}
              onChange={(event) => onSchedulePresetChange(event.target.value)}
              aria-label={t.tools.schedulePresetAria}
            >
              <option value="">{t.tools.choosePreset}</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="time"
                value={scheduleStart}
                onChange={(event) => onScheduleStartChange(event.target.value)}
                aria-label={t.tools.startTime}
              />
              <Input
                type="time"
                value={scheduleEnd}
                onChange={(event) => onScheduleEndChange(event.target.value)}
                aria-label={t.tools.endTime}
              />
            </div>
            <fieldset className="flex flex-wrap gap-1">
              <legend className="sr-only">{t.tools.weekdaysAria}</legend>
              {weekOrder.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => onToggleWeekday(day)}
                  aria-pressed={scheduleWeekdays.includes(day)}
                  className={cn(
                    "h-9 min-w-10 rounded-md border px-2 text-xs font-semibold max-sm:h-11",
                    scheduleWeekdays.includes(day)
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]"
                      : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-strong)]",
                  )}
                >
                  {labels.get(day)}
                </button>
              ))}
            </fieldset>
            <p className="text-xs text-[var(--muted)]">{timezone}</p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyAction === "schedule-create"}
                onClick={() => setCreating(false)}
              >
                {c.cancel}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={
                  busy ||
                  !schedulePresetId ||
                  scheduleWeekdays.length === 0 ||
                  scheduleStart === scheduleEnd
                }
              >
                <CalendarClock size={15} aria-hidden="true" />
                {t.tools.createSchedule}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
