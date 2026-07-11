import { CalendarClock, Trash2 } from "lucide-react";
import type { AdminOverview } from "../../api";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../i18n";
import { formatDateTime, formatWeekdays } from "../../lib/format";
import { cn } from "../../lib/utils";
import { EmptyState, Section } from "./AdminDialogUi";
import type { AdminPreset, AdminSchedule } from "./types";

export function AutomationPanel({
  overview,
  busyAction,
  onToggleSchedule,
  onDeleteSchedule,
  onDeletePreset,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onToggleSchedule: (schedule: AdminSchedule) => void;
  onDeleteSchedule: (schedule: AdminSchedule) => void;
  onDeletePreset: (preset: AdminPreset) => void;
}) {
  const { messages: t, localeInfo } = useI18n();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title={t.tools.presets}
        description={t.admin.automation.presetsDescription}
      >
        <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
          {overview.presets.length === 0 ? (
            <EmptyState title={t.admin.automation.noPresetsTitle}>
              {t.admin.automation.noPresetsBody}
            </EmptyState>
          ) : (
            overview.presets.map((preset) => (
              <div
                key={preset.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {preset.name}
                  </strong>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {preset.accountName ?? t.common.unknownAccount} ·{" "}
                    {preset.appCount} {t.common.games} ·{" "}
                    {t.admin.automation.updated}{" "}
                    {formatDateTime(preset.updatedAt, localeInfo.dateLocale)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onDeletePreset(preset)}
                  disabled={busyAction === `preset-delete-${preset.id}`}
                >
                  <Trash2 size={14} />
                  {t.common.delete}
                </Button>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section
        title={t.tools.schedules}
        description={t.admin.automation.schedulesDescription}
      >
        <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
          {overview.schedules.length === 0 ? (
            <EmptyState title={t.admin.automation.noSchedulesTitle}>
              {t.admin.automation.noSchedulesBody}
            </EmptyState>
          ) : (
            overview.schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm">
                      {schedule.name}
                    </strong>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        schedule.enabled
                          ? "bg-[var(--good-soft)] text-[var(--good)]"
                          : "bg-[var(--surface)] text-[var(--muted)]",
                      )}
                    >
                      {schedule.enabled ? t.common.active : t.common.off}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {schedule.accountName ?? t.common.unknownAccount} ·{" "}
                    {schedule.presetName ?? t.tools.preset} ·{" "}
                    {schedule.startTime}-{schedule.endTime} ·{" "}
                    {formatWeekdays(schedule.weekdays, localeInfo.dateLocale)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleSchedule(schedule)}
                    disabled={busyAction === `schedule-toggle-${schedule.id}`}
                  >
                    <CalendarClock size={14} />
                    {schedule.enabled ? t.tools.disable : t.tools.enable}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onDeleteSchedule(schedule)}
                    disabled={busyAction === `schedule-delete-${schedule.id}`}
                  >
                    <Trash2 size={14} />
                    {t.common.delete}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}
