import { CalendarClock, RefreshCw, SkipForward, Trash2 } from "lucide-react";
import type { BoostPreset, BoostSchedule, SchedulePreview } from "../../../api";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input, Select } from "../../../components/ui/form";
import { weekdayLabels } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { useI18n } from "../../../i18n";
import type { ResourceLoadState } from "../useAccountController";

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
  onCreateSchedule: () => void;
  onToggleSchedule: (schedule: BoostSchedule) => void;
  onDeleteSchedule: (schedule: BoostSchedule) => void;
  preview: SchedulePreview | null;
  previewState?: ResourceLoadState;
  onRefreshPreview: () => void;
  onSkipNext: (schedule: BoostSchedule) => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const o = t.operations;
  const previewItems = Array.isArray(preview?.items) ? preview.items : [];

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{t.tools.schedules}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {t.tools.schedulesDescription}
        </p>
      </div>
      <div className="grid gap-2">
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
          {weekdayLabels(localeInfo.dateLocale).map((day) => (
            <button
              key={day.value}
              type="button"
              onClick={() => onToggleWeekday(day.value)}
              aria-pressed={scheduleWeekdays.includes(day.value)}
              className={cn(
                "h-7 min-w-8 rounded-md border px-2 text-xs font-semibold max-sm:h-11",
                scheduleWeekdays.includes(day.value)
                  ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-strong)]",
              )}
            >
              {day.label}
            </button>
          ))}
        </fieldset>
        <Button
          variant="primary"
          size="sm"
          disabled={
            Boolean(busyAction) ||
            !schedulePresetId ||
            scheduleWeekdays.length === 0
          }
          onClick={onCreateSchedule}
        >
          <CalendarClock size={15} />
          {t.tools.createSchedule}
        </Button>
        <p className="text-[11px] text-[var(--muted)]">{timezone}</p>
      </div>
      <div className="grid gap-2 border-y border-[var(--line)] py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <strong className="text-xs text-[var(--muted-strong)]">
              {o.timelineTitle}
            </strong>
            <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">
              {o.timelineDescription}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(busyAction)}
            onClick={onRefreshPreview}
            aria-label={o.refreshTimeline}
            title={o.refreshTimeline}
          >
            <RefreshCw size={13} />
          </Button>
        </div>
        <ol className="grid max-h-40 gap-1 overflow-auto pr-1">
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
            previewItems.slice(0, 10).map((item) => (
              <li
                key={item.windowId}
                className="rounded-md bg-[var(--surface-2)] p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">
                    {item.scheduleName}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">
                    {item.skipped
                      ? o.skipped
                      : item.conflictScheduleIds.length > 0
                        ? item.winner
                          ? o.winner
                          : o.conflict
                        : null}
                  </span>
                </div>
                <time className="text-[10px] text-[var(--muted)]">
                  {new Intl.DateTimeFormat(localeInfo.dateLocale, {
                    weekday: "short",
                    year: "2-digit",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(item.startsAt)}
                </time>
              </li>
            ))
          )}
        </ol>
      </div>
      <div className="grid max-h-44 gap-2 overflow-auto pr-1">
        {schedules.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
            {t.tools.noSchedules}
          </div>
        ) : (
          schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {schedule.name}
                  </strong>
                  <span className="text-xs text-[var(--muted)]">
                    {schedule.startTime}-{schedule.endTime} ·{" "}
                    {schedule.presetName ?? t.tools.preset} ·{" "}
                    {schedule.enabled ? t.common.active : t.common.off}
                  </span>
                </div>
                <Badge tone={schedule.enabled ? "good" : "neutral"}>
                  {schedule.enabled ? t.common.on : t.common.off}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  disabled={Boolean(busyAction)}
                  onClick={() => onToggleSchedule(schedule)}
                >
                  {schedule.enabled ? t.tools.disable : t.tools.enable}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={
                    Boolean(busyAction) ||
                    !previewItems.some(
                      (item) =>
                        item.scheduleId === schedule.id &&
                        !item.skipped &&
                        item.startsAt >= Date.now(),
                    )
                  }
                  onClick={() => onSkipNext(schedule)}
                  aria-label={`${schedule.name}: ${o.skipNext}`}
                  title={o.skipNext}
                >
                  <SkipForward size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={Boolean(busyAction)}
                  onClick={() => onDeleteSchedule(schedule)}
                  aria-label={`${schedule.name} ${t.tools.deleteSchedule}`}
                  title={t.tools.deleteSchedule}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
