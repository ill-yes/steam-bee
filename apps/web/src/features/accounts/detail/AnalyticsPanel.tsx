import type { BoostAnalytics, PlaytimeGoal, SteamApp } from "../../../api";
import { formatDateTime, formatDurationMs } from "../../../lib/format";
import { interpolate, useI18n } from "../../../i18n";
import { StatusFact } from "./StatusFact";
import { GoalsPanel } from "./GoalsPanel";
import type { ResourceLoadState } from "../useAccountController";

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
  onSaveGoal: (appId: number, targetMinutes: number) => void;
  onDeleteGoal: (goal: PlaytimeGoal) => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const topGames = Array.isArray(analytics?.topGames) ? analytics.topGames : [];
  const recentSessions = Array.isArray(analytics?.recentSessions)
    ? analytics.recentSessions
    : [];
  const totalSessions =
    typeof analytics?.totalSessions === "number" ? analytics.totalSessions : 0;

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{t.tools.analytics}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {t.tools.analyticsDescription}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatusFact
          label={t.tools.today}
          value={formatDurationMs(
            analytics?.todayMs ?? 0,
            t,
            localeInfo.dateLocale,
          )}
          detail={t.tools.boostTime}
          tone="neutral"
        />
        <StatusFact
          label={t.tools.sevenDays}
          value={formatDurationMs(
            analytics?.last7DaysMs ?? 0,
            t,
            localeInfo.dateLocale,
          )}
          detail={interpolate(t.tools.sessions, { count: totalSessions })}
          tone="neutral"
        />
      </div>
      <div className="grid gap-2">
        <strong className="text-xs text-[var(--muted-strong)]">
          {t.tools.topGames}
        </strong>
        {topGames.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
            {t.tools.noAnalytics}
          </div>
        ) : (
          <div className="grid max-h-32 gap-1 overflow-auto pr-1">
            {topGames.map((game) => (
              <div
                key={game.appId}
                className="flex items-center justify-between gap-2 rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-xs"
              >
                <span className="truncate">{game.name}</span>
                <span className="shrink-0 text-[var(--muted)]">
                  {formatDurationMs(game.durationMs, t, localeInfo.dateLocale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-2">
        <strong className="text-xs text-[var(--muted-strong)]">
          {t.tools.recentSessions}
        </strong>
        <div className="grid max-h-32 gap-1 overflow-auto pr-1">
          {recentSessions.slice(0, 5).map((session) => (
            <div
              key={session.id}
              className="rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-xs"
            >
              <div className="flex justify-between gap-2">
                <span className="truncate">
                  {session.presetName ??
                    `${session.appIds.length} ${t.common.games}`}
                </span>
                <span className="shrink-0 text-[var(--muted)]">
                  {formatDurationMs(
                    session.durationMs,
                    t,
                    localeInfo.dateLocale,
                  )}
                </span>
              </div>
              <time className="text-[var(--muted)]">
                {formatDateTime(session.startedAt, localeInfo.dateLocale)}
              </time>
            </div>
          ))}
        </div>
      </div>
      <GoalsPanel
        goals={goals}
        loadState={goalsState}
        library={library}
        busy={busy}
        onSave={onSaveGoal}
        onDelete={onDeleteGoal}
      />
    </section>
  );
}
