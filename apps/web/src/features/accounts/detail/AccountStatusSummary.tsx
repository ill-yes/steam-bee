import type { Account, SteamEvent } from "../../../api";
import {
  formatBoostRunningSince,
  formatEventDate,
  formatEventTime,
} from "../../../lib/format";
import {
  eventDisplay,
  nextStepMessage,
  personaLabel,
  statusSummary,
} from "../../../lib/status";
import { cn } from "../../../lib/utils";
import { interpolate, useI18n } from "../../../i18n";
import { StatusFact } from "./StatusFact";

export function AccountStatusSummary({
  account,
  libraryCount,
  appliedCount,
  draftCount,
  gameLimit,
  selectionDirty,
  events,
}: {
  account: Account;
  libraryCount: number;
  appliedCount: number;
  draftCount: number;
  gameLimit: number;
  selectionDirty: boolean;
  events: SteamEvent[];
}) {
  const { messages: t, localeInfo } = useI18n();
  const o = t.operations;
  const health = account.health;
  const dateValue = (value: number | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(localeInfo.dateLocale, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(value)
      : o.never;

  return (
    <section className="flex h-full min-w-0 flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <div>
        <p className="text-xs font-semibold text-[var(--muted)]">
          {t.accountDetail.boostStatus}
        </p>
        <strong className="mt-1 block text-base">
          {statusSummary(account.runtimeStatus, appliedCount, t)}
        </strong>
        <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
          {nextStepMessage(
            account.runtimeStatus,
            libraryCount,
            appliedCount,
            t,
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatusFact
          label={t.accountDetail.activeGames}
          value={interpolate(t.accountDetail.ofLimit, {
            count: appliedCount,
            limit: gameLimit,
          })}
          detail={
            selectionDirty
              ? interpolate(t.accountDetail.draftGames, { count: draftCount })
              : t.accountDetail.reportedToSteam
          }
          tone={selectionDirty ? "warn" : appliedCount > 0 ? "good" : "neutral"}
        />
        <StatusFact
          label={t.accountDetail.visibility}
          value={personaLabel(account.personaState, t)}
          detail={t.accountDetail.steamStatus}
          tone="neutral"
        />
        <StatusFact
          label={t.accountDetail.boostingSince}
          value={formatBoostRunningSince(
            account.latestBoostStartedAt,
            t,
            localeInfo.dateLocale,
          )}
          detail={
            account.latestBoostStartedAt
              ? t.accountDetail.running
              : t.accountDetail.notStarted
          }
          tone={account.runtimeStatus === "boosting" ? "good" : "neutral"}
        />
      </div>

      <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-3">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-xs text-[var(--muted-strong)]">
            {o.recoveryTitle}
          </strong>
          {health?.retryAttempt ? (
            <span className="text-[10px] text-[var(--muted)]">
              {interpolate(o.retryAttempt, { count: health.retryAttempt })}
            </span>
          ) : null}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--muted)]">{o.lastSteamContact}</dt>
            <dd
              className="mt-0.5 truncate font-medium"
              title={dateValue(health?.lastSteamContactAt)}
            >
              {dateValue(health?.lastSteamContactAt)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{o.nextRetry}</dt>
            <dd
              className="mt-0.5 truncate font-medium"
              title={dateValue(health?.nextRetryAt)}
            >
              {dateValue(health?.nextRetryAt)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{o.librarySnapshot}</dt>
            <dd
              className="mt-0.5 truncate font-medium"
              title={dateValue(health?.libraryImportedAt)}
            >
              {dateValue(health?.libraryImportedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{o.tokenExpiry}</dt>
            <dd
              className="mt-0.5 truncate font-medium"
              title={dateValue(account.tokenExpiresAt)}
            >
              {dateValue(account.tokenExpiresAt)}
            </dd>
          </div>
        </dl>
        {health?.errorClass && health.errorClass !== "none" ? (
          <p className="mt-2 text-xs text-[var(--warn)]">
            {o.errorClasses[health.errorClass]} ·{" "}
            {o.recoveryActions[health.recoveryAction]}
          </p>
        ) : null}
      </div>

      <RecentLogList events={events} />
    </section>
  );
}

function RecentLogList({ events }: { events: SteamEvent[] }) {
  const { messages: t, localeInfo } = useI18n();
  const recentEvents = events.slice(0, 10);

  return (
    <div className="min-h-0 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <strong className="text-xs font-semibold text-[var(--muted-strong)]">
          {t.accountDetail.recentLogs}
        </strong>
        <span className="text-xs text-[var(--muted)]">
          {recentEvents.length}/{events.length}
        </span>
      </div>
      <div className="max-h-32 overflow-auto">
        {recentEvents.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--muted)]">
            {t.eventsPanel.noLogs}
          </div>
        ) : (
          recentEvents.map((event) => {
            const display = eventDisplay(event, t);
            return (
              <div
                key={event.id}
                className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 border-b border-[var(--line)] px-3 py-1.5 text-xs last:border-b-0"
              >
                <time className="whitespace-nowrap text-[var(--muted)]">
                  {formatEventDate(event.createdAt, localeInfo)}{" "}
                  {formatEventTime(event.createdAt, localeInfo)}
                </time>
                <span
                  className={cn(
                    "truncate",
                    event.level === "error"
                      ? "text-[var(--danger)]"
                      : event.level === "warn"
                        ? "text-[var(--warn)]"
                        : "text-[var(--muted-strong)]",
                  )}
                  title={display.title}
                >
                  {display.title}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
