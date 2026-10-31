import type { ReactNode } from "react";
import type { BoostAnalytics, PlaytimeGoal, SteamApp } from "../../../api";
import { formatDateTime, formatDurationMs } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { interpolate, useI18n } from "../../../i18n";
import { GoalsPanel } from "./GoalsPanel";
import type { ResourceLoadState } from "../useAccountController";
import { automationCopy } from "./automationCopy";

/** Key figures, playtime per day, top games, recent sessions and goals. */
export function AnalyticsPanel({
  analytics,
  goals,
  library,
  busy,
  goalsState,
  onSaveGoal,
  onDeleteGoal,
}: {
  analytics: BoostAnalytics | null;
  goals: PlaytimeGoal[];
  library: SteamApp[];
  busy: boolean;
  goalsState: ResourceLoadState;
  onSaveGoal: (appId: number, targetMinutes: number) => Promise<boolean>;
  onDeleteGoal: (goal: PlaytimeGoal) => void;
}) {
  const { messages: t, localeInfo, locale } = useI18n();
  const c = automationCopy(locale);
  const duration = (ms: number) =>
    formatDurationMs(ms, t, localeInfo.dateLocale);
  const topGames = Array.isArray(analytics?.topGames) ? analytics.topGames : [];
  const recentSessions = Array.isArray(analytics?.recentSessions)
    ? analytics.recentSessions
    : [];
  const days = Array.isArray(analytics?.days) ? analytics.days : [];
  const totalSessions =
    typeof analytics?.totalSessions === "number" ? analytics.totalSessions : 0;
  const open = analytics?.openSession ?? null;
  const last7 = analytics?.last7DaysMs ?? 0;
  const maxDay = Math.max(1, ...days.map((day) => day.durationMs));
  const maxGame = Math.max(1, ...topGames.map((game) => game.durationMs));
  const dayLabel = new Intl.DateTimeFormat(localeInfo.dateLocale, {
    weekday: "short",
  });
  const sessionLabel = (session: (typeof recentSessions)[number]) =>
    session.presetName ??
    (session.apps.length > 0
      ? session.apps.map((app) => app.name).join(", ")
      : `${session.appIds.length} ${
          session.appIds.length === 1 ? t.common.game : t.common.games
        }`);

  return (
    <section className="grid min-w-0 gap-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={c.runningNowShort}
          value={open ? duration(open.durationMs) : "—"}
          detail={
            open ? open.apps.map((app) => app.name).join(", ") : c.notRunning
          }
          good={Boolean(open)}
        />
        <Kpi
          label={t.tools.today}
          value={duration(analytics?.todayMs ?? 0)}
          detail={t.tools.boostTime}
        />
        <Kpi
          label={c.last7Days}
          value={duration(last7)}
          detail={interpolate(c.perDay, { value: duration(last7 / 7) })}
        />
        <Kpi
          label={c.totalSessions}
          value={String(totalSessions)}
          detail={c.allTime}
        />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {days.length > 0 && (
          <Card title={c.playtimePerDay}>
            <ol
              className="flex h-40 items-end gap-2 border-b border-[var(--line)] px-1"
              aria-label={c.playtimePerDayLabel}
            >
              {days.map((day, index) => {
                const today = index === days.length - 1;
                const label = today
                  ? c.todayShort
                  : dayLabel.format(day.startsAt);
                return (
                  <li
                    key={day.startsAt}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    title={`${label}: ${duration(day.durationMs)}`}
                  >
                    <span
                      className={cn(
                        "text-[11px] tabular-nums",
                        today
                          ? "font-bold text-[var(--ink)]"
                          : "text-[var(--muted)]",
                      )}
                    >
                      {duration(day.durationMs)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="w-full max-w-11 rounded-t bg-[var(--accent)]"
                      style={{
                        height: `${(day.durationMs / maxDay) * 100}%`,
                        minHeight: day.durationMs > 0 ? 2 : 0,
                      }}
                    />
                    <span className="sr-only">{label}</span>
                  </li>
                );
              })}
            </ol>
            <div
              aria-hidden="true"
              className="flex gap-2 px-1 pt-1.5 text-center text-xs text-[var(--muted)]"
            >
              {days.map((day, index) => (
                <span
                  key={day.startsAt}
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    index === days.length - 1 && "font-bold text-[var(--ink)]",
                  )}
                >
                  {index === days.length - 1
                    ? c.todayShort
                    : dayLabel.format(day.startsAt)}
                </span>
              ))}
            </div>
          </Card>
        )}
        <Card title={t.tools.topGames}>
          {topGames.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t.tools.noAnalytics}</p>
          ) : (
            <ol className="grid gap-2">
              {topGames.slice(0, 6).map((game) => (
                <li
                  key={game.appId}
                  className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
                >
                  <span className="truncate">{game.name}</span>
                  <span
                    aria-hidden="true"
                    className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
                  >
                    <span
                      className="block h-full rounded-full bg-[var(--accent)]"
                      style={{
                        width: `${(game.durationMs / maxGame) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="text-end tabular-nums text-[var(--muted-strong)]">
                    {duration(game.durationMs)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card title={t.tools.recentSessions} flush>
          {recentSessions.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-[var(--muted)]">
              {t.tools.noAnalytics}
            </p>
          ) : (
            <ul>
              {recentSessions.slice(0, 6).map((session) => (
                <li
                  key={session.id}
                  className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-2.5 text-sm"
                >
                  <time
                    className="truncate text-[var(--muted)]"
                    dateTime={new Date(session.startedAt).toISOString()}
                  >
                    {formatDateTime(session.startedAt, localeInfo.dateLocale)}
                  </time>
                  <span className="truncate">{sessionLabel(session)}</span>
                  <span className="text-end tabular-nums">
                    {duration(session.durationMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <GoalsPanel
            goals={goals}
            loadState={goalsState}
            library={library}
            busy={busy}
            onSave={onSaveGoal}
            onDelete={onDeleteGoal}
          />
        </div>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  detail,
  good = false,
}: {
  label: string;
  value: string;
  detail: string;
  good?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
      <span className="text-xs font-semibold text-[var(--muted)]">{label}</span>
      <strong
        className={cn(
          "text-2xl font-bold tabular-nums",
          good && "text-[var(--good)]",
        )}
      >
        {value}
      </strong>
      <span className="truncate text-xs text-[var(--muted)]">{detail}</span>
    </div>
  );
}

function Card({
  title,
  flush = false,
  children,
}: {
  title: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 content-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]",
        flush ? "pt-4" : "p-4",
      )}
    >
      <h3 className={cn("text-sm font-semibold", flush && "px-4")}>{title}</h3>
      {children}
    </section>
  );
}
