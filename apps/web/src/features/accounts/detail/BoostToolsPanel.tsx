import { useId, type ReactNode } from "react";
import { formatDurationMs } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { useI18n } from "../../../i18n";

export type PlanningTab = "presets" | "schedule" | "analytics";

export function BoostToolsPanel({
  activeTab,
  onTabChange,
  presetCount,
  activeScheduleCount,
  analyticsLast7DaysMs,
  children,
}: {
  activeTab: PlanningTab;
  onTabChange: (tab: PlanningTab) => void;
  presetCount: number;
  activeScheduleCount: number;
  analyticsLast7DaysMs: number;
  children: ReactNode;
}) {
  const { messages: t, localeInfo } = useI18n();
  const panelId = useId();
  const tabs = [
    { id: "presets" as const, label: t.tools.presets, meta: presetCount },
    {
      id: "schedule" as const,
      label: t.tools.schedule,
      meta: activeScheduleCount,
    },
    {
      id: "analytics" as const,
      label: t.tools.analytics,
      meta: formatDurationMs(analyticsLast7DaysMs, t, localeInfo.dateLocale),
    },
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{t.tools.title}</h3>
            <p className="truncate text-xs text-[var(--muted)]">
              {t.tools.description}
            </p>
          </div>
        </div>
        <div
          className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-[var(--surface-2)] p-1"
          role="group"
          aria-label={t.tools.title}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-pressed={activeTab === tab.id}
              aria-controls={panelId}
              className={cn(
                "min-w-0 rounded px-2 py-1.5 text-left text-xs transition",
                activeTab === tab.id
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm"
                  : "text-[var(--muted-strong)] hover:bg-[var(--surface-3)]",
              )}
            >
              <span className="block truncate font-semibold">{tab.label}</span>
              <span className="block truncate text-[10px] text-[var(--muted)]">
                {tab.meta}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div
        id={panelId}
        className="p-3"
        role="region"
        aria-label={tabs.find((tab) => tab.id === activeTab)?.label}
      >
        {children}
      </div>
    </section>
  );
}
