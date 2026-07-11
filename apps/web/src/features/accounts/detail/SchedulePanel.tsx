import { CalendarClock, Trash2 } from "lucide-react";
import type { BoostPreset, BoostSchedule } from "../../../api";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input, Select } from "../../../components/ui/form";
import { weekdayLabels } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { useI18n } from "../../../i18n";

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
}) {
  const { messages: t, localeInfo } = useI18n();

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
                "h-7 min-w-8 rounded-md border px-2 text-xs font-semibold",
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
