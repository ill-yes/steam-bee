import { CirclePlay, ListChecks, Unplug } from "lucide-react";
import type { Account, SteamApp } from "../../../api";
import { Button } from "../../../components/ui/button";
import { getPrimaryCommand } from "../../../lib/status";
import { interpolate, useI18n } from "../../../i18n";
import type { FarmingSummary } from "../../farming/useFarmingSummary";
import { SteamAppArtwork } from "../../library/SteamAppArtwork";
import { AccountAvatar } from "../AccountAvatar";
import { ActivityBadge } from "../StatusIndicators";
import { ActivityModeSwitch, type ActivityMode } from "./ActivityModeSwitch";
import { hubCopy } from "./hubCopy";

export function AccountHubBar({
  account,
  library,
  busyAction,
  primaryCommand,
  connected,
  needsRelogin = false,
  canStop,
  eventCount,
  appliedCount,
  gameLimit,
  farming,
  onPrimaryAction,
  onSelectMode,
  onStop,
  onLogs,
}: {
  account: Account;
  library: SteamApp[];
  busyAction: string | null;
  primaryCommand: ReturnType<typeof getPrimaryCommand>;
  connected: boolean;
  needsRelogin?: boolean | undefined;
  canStop: boolean;
  eventCount: number;
  appliedCount: number;
  gameLimit: number;
  farming: FarmingSummary | null;
  onPrimaryAction: () => void;
  onSelectMode: (mode: ActivityMode) => void;
  onStop: () => void;
  onLogs: () => void;
}) {
  const { locale, messages: t } = useI18n();
  const copy = hubCopy(locale);
  const mode: ActivityMode =
    account.activityMode ??
    (account.runtimeStatus === "boosting" ? "manual" : "idle");
  const ids =
    account.activeAppIds ??
    (mode === "manual" && account.runtimeStatus === "boosting"
      ? account.games.filter((game) => game.enabled).map((game) => game.appId)
      : []);
  const health = account.health;
  // Connecting needs no mode choice; a disconnected account first needs a session.
  const showPrimary =
    primaryCommand !== null &&
    primaryCommand.kind === "action" &&
    (!connected || primaryCommand.disabled);

  return (
    <header className="grid min-w-0 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--panel-shadow)]">
      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AccountAvatar account={account} size="md" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {account.accountName}
            </h2>
            <div className="mt-1">
              <ActivityBadge account={account} />
            </div>
          </div>
        </div>
        <div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {showPrimary && primaryCommand && (
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
          )}
          {canStop && (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11 gap-1.5 px-2 lg:min-h-8 lg:gap-2 lg:px-2.5"
              disabled={Boolean(busyAction)}
              onClick={onStop}
              aria-label={copy.disconnect}
            >
              <Unplug size={15} aria-hidden="true" />
              <span className="lg:hidden">{copy.stopShort}</span>
              <span className="hidden lg:inline">{copy.disconnect}</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 gap-1.5 px-2 lg:min-h-8 lg:gap-2 lg:px-2.5"
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
      <ActivityModeSwitch
        mode={mode}
        connected={connected}
        appliedCount={appliedCount}
        gameLimit={gameLimit}
        farming={farming}
        disabled={
          Boolean(busyAction) ||
          needsRelogin ||
          primaryCommand?.disabled === true
        }
        onSelect={onSelectMode}
      />
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
