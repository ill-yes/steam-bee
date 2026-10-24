import { CirclePlay, ListChecks, Pause, Repeat2, Square } from "lucide-react";
import type { Account, SteamApp } from "../../../api";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { getPrimaryCommand } from "../../../lib/status";
import { interpolate, useI18n } from "../../../i18n";
import { SteamAppArtwork } from "../../library/SteamAppArtwork";
import { AccountAvatar } from "../AccountAvatar";
import { StatusBadge } from "../StatusIndicators";
import { hubCopy } from "./hubCopy";

export function AccountHubBar({
  account,
  library,
  busyAction,
  primaryCommand,
  canPause,
  canStop,
  eventCount,
  onPrimaryAction,
  onPause,
  onStop,
  onLogs,
  onSwitchManual,
}: {
  account: Account;
  library: SteamApp[];
  busyAction: string | null;
  primaryCommand: ReturnType<typeof getPrimaryCommand>;
  canPause: boolean;
  canStop: boolean;
  eventCount: number;
  onPrimaryAction: () => void;
  onPause: () => void;
  onStop: () => void;
  onLogs: () => void;
  onSwitchManual: () => void;
}) {
  const { locale, messages: t } = useI18n();
  const copy = hubCopy(locale);
  const mode =
    account.activityMode ??
    (account.runtimeStatus === "boosting" ? "manual" : "idle");
  const ids =
    account.activeAppIds ??
    (mode === "manual" && account.runtimeStatus === "boosting"
      ? account.games.filter((game) => game.enabled).map((game) => game.appId)
      : []);
  const health = account.health;

  return (
    <header className="grid min-w-0 gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--panel-shadow)] lg:gap-3">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:flex lg:flex-wrap lg:justify-between lg:gap-3">
        <div className="hidden min-w-0 items-center gap-2 lg:flex">
          <AccountAvatar account={account} size="md" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {account.accountName}
            </h2>
            <div className="mt-1">
              <StatusBadge status={account.runtimeStatus} />
            </div>
          </div>
        </div>
        <Badge
          className="max-w-full justify-self-start"
          tone={
            mode === "farming" ? "info" : mode === "manual" ? "good" : "neutral"
          }
        >
          {mode === "farming"
            ? copy.farm
            : mode === "manual"
              ? copy.manual
              : copy.idle}
        </Badge>
        {(mode === "farming" || primaryCommand) && (
          <div className="min-w-0 max-w-full justify-self-end lg:ms-auto">
            {mode === "farming" ? (
              <Button
                size="sm"
                variant="primary"
                className="min-h-11 max-w-full whitespace-normal lg:min-h-8"
                aria-label={copy.switchManual}
                disabled={Boolean(busyAction)}
                onClick={onSwitchManual}
              >
                <Repeat2 size={15} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 break-words lg:hidden [overflow-wrap:anywhere]">
                  {copy.switchManualShort}
                </span>
                <span className="hidden min-w-0 break-words lg:inline [overflow-wrap:anywhere]">
                  {copy.switchManual}
                </span>
              </Button>
            ) : (
              primaryCommand && (
                <Button
                  size="sm"
                  variant="primary"
                  className="min-h-11 max-w-full whitespace-normal lg:min-h-8"
                  disabled={primaryCommand.disabled || Boolean(busyAction)}
                  onClick={onPrimaryAction}
                >
                  <CirclePlay size={15} aria-hidden="true" />
                  {busyAction === primaryCommand.action
                    ? t.common.pleaseWait
                    : primaryCommand.label}
                </Button>
              )
            )}
          </div>
        )}
        <div className="col-span-2 flex min-w-0 max-w-full flex-wrap items-center gap-2 lg:col-span-1">
          {canPause && (
            <Button
              size="sm"
              className="min-h-11 flex-1 gap-1.5 px-2 lg:min-h-8 lg:flex-none lg:gap-2 lg:px-2.5"
              disabled={Boolean(busyAction)}
              onClick={onPause}
              aria-label={t.common.pause}
            >
              <Pause size={15} aria-hidden="true" />
              <span className="lg:hidden">{copy.pauseShort}</span>
              <span className="hidden lg:inline">{t.common.pause}</span>
            </Button>
          )}
          {canStop && (
            <Button
              size="sm"
              variant="danger"
              className="min-h-11 flex-1 gap-1.5 px-2 lg:min-h-8 lg:flex-none lg:gap-2 lg:px-2.5"
              disabled={Boolean(busyAction)}
              onClick={onStop}
              aria-label={t.common.stop}
            >
              <Square size={15} aria-hidden="true" />
              <span className="lg:hidden">{copy.stopShort}</span>
              <span className="hidden lg:inline">{t.common.stop}</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 flex-1 gap-1.5 px-2 lg:min-h-8 lg:flex-none lg:gap-2 lg:px-2.5"
            onClick={onLogs}
            aria-label={`${t.accountDetail.viewLogs} (${eventCount})`}
          >
            <ListChecks size={15} aria-hidden="true" />
            <span className="lg:hidden">{copy.logsShort}</span>
            <span className="hidden lg:inline">{t.accountDetail.viewLogs}</span>
            <span className="text-xs text-[var(--muted)]">{eventCount}</span>
          </Button>
        </div>
      </div>
      <div
        className="flex min-w-0 items-center gap-2 border-t border-[var(--line)] pt-2"
        aria-label={copy.activeGames}
      >
        <span className="max-w-[45%] shrink-0 text-xs font-semibold text-[var(--muted-strong)]">
          <span className="lg:hidden">{copy.activeGamesShort}:</span>
          <span className="hidden lg:inline">{copy.activeGames}:</span>
        </span>
        {ids.length === 0 ? (
          <span className="text-xs text-[var(--muted)]">
            {copy.noActiveGames}
          </span>
        ) : (
          <div
            role="region"
            tabIndex={0}
            aria-label={copy.activeGamesScroll}
            className="min-w-0 max-w-full flex-1 overflow-x-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <ul className="flex min-w-0 max-w-full gap-2 pb-1">
              {ids.map((appId) => {
                const name =
                  library.find((game) => game.appId === appId)?.name ??
                  `App ${appId}`;
                return (
                  <li
                    key={appId}
                    className="flex min-w-0 max-w-[220px] shrink-0 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] pe-2 text-xs"
                  >
                    <SteamAppArtwork appId={appId} name={name} size="mini" />
                    <span className="min-w-0 truncate" title={name}>
                      {name}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      {health && health.errorClass !== "none" && (
        <p className="text-xs leading-5 text-[var(--warn)]">
          {t.operations.errorClasses[health.errorClass]} ·{" "}
          {interpolate(t.operations.retryAttempt, {
            count: health.retryAttempt,
          })}
          {health.errorClass === "session_replaced" ? " / 3" : ""}
          {health.recoveryAction === "wait" &&
          health.errorClass === "session_replaced"
            ? ` · ${t.operations.sessionConflictCooldown}`
            : ` · ${t.operations.recoveryActions[health.recoveryAction]}`}
        </p>
      )}
    </header>
  );
}
