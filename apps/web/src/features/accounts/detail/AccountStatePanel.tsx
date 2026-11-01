import type { ReactNode } from "react";
import { Copy, ListChecks } from "lucide-react";
import { toast } from "sonner";
import type { DesiredState } from "@steam-bee/contracts";
import type { Account, SteamEvent } from "../../../api";
import { Button } from "../../../components/ui/button";
import {
  formatBoostRunningSince,
  formatEventDate,
  formatEventTime,
  formatTokenDate,
} from "../../../lib/format";
import {
  desiredLabel,
  eventDisplay,
  nextStepMessage,
  personaLabel,
  statusSummary,
} from "../../../lib/status";
import { interpolate, useI18n, type Messages } from "../../../i18n";
import { hubCopy } from "./hubCopy";

export function AccountStatePanel({
  account,
  libraryCount,
  appliedCount,
  gameLimit,
  events,
  onOpenLogs,
}: {
  account: Account;
  libraryCount: number;
  appliedCount: number;
  gameLimit: number;
  events: SteamEvent[];
  onOpenLogs: () => void;
}) {
  const { locale, messages: t, localeInfo } = useI18n();
  const hub = hubCopy(t);
  const o = t.operations;
  const health = account.health;
  const activeCount =
    account.activeAppIds?.length ??
    (account.runtimeStatus === "boosting" && account.activityMode !== "farming"
      ? appliedCount
      : 0);
  const dateValue = (value: number | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(localeInfo.dateLocale, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(value)
      : o.never;
  const lastEvent = events[0];

  return (
    <aside
      aria-labelledby="account-state-title"
      className="grid min-w-0 content-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
    >
      <div>
        <h3 id="account-state-title" className="text-sm font-semibold">
          {hub.stateTitle}
        </h3>
        <strong className="mt-2 block text-base">
          {statusSummary(account.runtimeStatus, activeCount, t)}
        </strong>
        <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
          {account.activityMode === "farming"
            ? hub.farmingStatusHint
            : nextStepMessage(
                account.runtimeStatus,
                libraryCount,
                appliedCount,
                t,
              )}
        </p>
      </div>
      <dl className="grid text-sm">
        <Row label="SteamID">
          <span className="flex min-w-0 items-center justify-end gap-1">
            <span className="break-all font-mono text-xs">
              {account.steamId ?? t.accountDetail.steamIdUnknown}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={!account.steamId}
              onClick={() => void copySteamId(account.steamId, t)}
              aria-label={t.accountDetail.copySteamId}
              title={t.accountDetail.copySteamId}
              className="h-7 w-7 shrink-0"
            >
              <Copy size={14} />
            </Button>
          </span>
        </Row>
        <Row label={hub.activeGamesState}>
          {interpolate(t.accountDetail.ofLimit, {
            count: activeCount,
            limit: gameLimit,
          })}
        </Row>
        <Row label={hub.visibility}>
          {personaLabel(account.personaState, t)}
        </Row>
        <Row label={hub.boostingSince}>
          {formatBoostRunningSince(
            account.latestBoostStartedAt,
            t,
            localeInfo.dateLocale,
          )}
        </Row>
        <Row label={o.lastSteamContact}>
          {dateValue(health?.lastSteamContactAt)}
        </Row>
        <Row label={o.nextRetry}>{dateValue(health?.nextRetryAt)}</Row>
        <Row label={o.librarySnapshot}>
          {dateValue(health?.libraryImportedAt)}
        </Row>
        <Row label={o.tokenExpiry}>
          {formatTokenDate(account.tokenExpiresAt, t, localeInfo)}
        </Row>
        <Row label={t.accountDetail.autostart.replace(/:\s*$/, "")}>
          {autostartCopy(account.desiredState, t)}
        </Row>
        <Row label={hub.lastEvent}>
          {lastEvent ? (
            <>
              <time className="text-[var(--muted)]">
                {formatEventDate(lastEvent.createdAt, localeInfo)}{" "}
                {formatEventTime(lastEvent.createdAt, localeInfo)}
              </time>{" "}
              {eventDisplay(lastEvent, t).title}
            </>
          ) : (
            hub.noEvents
          )}
        </Row>
      </dl>
      {health?.errorClass && health.errorClass !== "none" ? (
        <p className="text-xs leading-5 text-[var(--warn)]">
          {o.errorClasses[health.errorClass]} ·{" "}
          {o.recoveryActions[health.recoveryAction]}
          {health.retryAttempt
            ? ` · ${interpolate(o.retryAttempt, { count: health.retryAttempt })}`
            : null}
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        onClick={onOpenLogs}
        className="justify-self-start"
      >
        <ListChecks size={16} aria-hidden="true" />
        {t.accountDetail.viewLogs}
        <span className="rounded-full bg-[var(--surface)] px-1.5 text-xs">
          {events.length}
        </span>
      </Button>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-baseline gap-3 border-t border-[var(--line)] py-2 first:border-t-0">
      <dt className="text-xs font-semibold text-[var(--muted-strong)]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-end">{children}</dd>
    </div>
  );
}

function autostartCopy(desiredState: DesiredState, messages: Messages) {
  return (
    messages.status.desiredDescription[desiredState] ??
    desiredLabel(desiredState, messages)
  );
}

async function copySteamId(steamId: string | null, messages: Messages) {
  if (!steamId) return;
  const copy = messages.accountDetail;
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable");
    }
    await navigator.clipboard.writeText(steamId);
    toast.success(copy.copiedSteamId);
  } catch {
    try {
      const input = document.createElement("textarea");
      input.value = steamId;
      input.setAttribute("readonly", "true");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("execCommand copy failed");
      toast.success(copy.copiedSteamId);
    } catch {
      toast.error(copy.copySteamIdFailed);
    }
  }
}
