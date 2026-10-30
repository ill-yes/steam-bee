import { useEffect, useId, useState, type ReactNode } from "react";
import type { AccountStatus, SteamApp } from "@steam-bee/contracts";
import { Layers, Play, Search, Settings2 } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ToolPageHeader,
  ToolRefreshButton,
} from "../../components/ui/tool-page-header";
import { interpolate, useI18n } from "../../i18n";
import { formatDurationMs } from "../../lib/format";
import { FarmingBoard } from "./FarmingBoard";
import { FarmingSettings } from "./FarmingSettings";
import { useFarmingPanel } from "./useFarmingPanel";

export type FarmingActivityMode = "manual" | "farming" | "idle";
type Props = {
  accountId: string;
  /** Kept for callers; game choices now happen on the badge cards. */
  library?: SteamApp[] | undefined;
  activityMode?: FarmingActivityMode | undefined;
  accountStatus?: AccountStatus | undefined;
  /** Switches the account mode the same way the header switch does. */
  onSwitchToFarming?: (() => void) | undefined;
};

export function FarmingPanel(props: Props) {
  return <AccountFarmingPanel key={props.accountId} {...props} />;
}

function AccountFarmingPanel({
  accountId,
  activityMode,
  accountStatus,
  onSwitchToFarming,
}: Props) {
  const state = useFarmingPanel(accountId, accountStatus, activityMode);
  const {
    t,
    localeInfo,
    snapshot,
    active,
    dirty,
    error,
    refreshError,
    notice,
    busy,
    loading,
    action,
  } = state;
  const { messages } = useI18n();
  const id = useId();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  const mode =
    snapshot && ["warming", "farming"].includes(snapshot.phase)
      ? "farming"
      : (activityMode ?? "idle");
  const reason = snapshot?.reason
    ? snapshot.reason in t.reasons
      ? t.reasons[snapshot.reason as keyof typeof t.reasons]
      : snapshot.reason === "no_eligible_games"
        ? t.noEligible
        : snapshot.reason === "badge_scan_failed"
          ? t.scanFailed
          : snapshot.reason === "farming_failed"
            ? t.farmingFailed
            : snapshot.phase === "blocked"
              ? t.sessionStopped
              : null
    : null;
  const hasScan = snapshot
    ? snapshot.scannedAt !== null || snapshot.games.length > 0
    : false;
  const status: ReactNode[] = !snapshot
    ? []
    : [
        active && snapshot.startedAt
          ? interpolate(t.statusRunning, {
              duration: formatDurationMs(
                Math.max(0, Math.max(clock, Date.now()) - snapshot.startedAt),
                messages,
                localeInfo.dateLocale,
              ),
            })
          : t.phases[snapshot.phase],
        hasScan
          ? interpolate(t.dropsOpen, { count: snapshot.remainingDrops })
          : null,
        snapshot.scannedAt === null ? (
          t.neverScanned
        ) : (
          <>
            {t.lastScan}:{" "}
            <time dateTime={new Date(snapshot.scannedAt).toISOString()}>
              {new Intl.DateTimeFormat(localeInfo.dateLocale, {
                dateStyle: "short",
                timeStyle: "short",
              }).format(snapshot.scannedAt)}
            </time>
          </>
        ),
      ].filter(Boolean);

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby={`${id}-title`}>
      <ToolPageHeader
        icon={Layers}
        titleId={`${id}-title`}
        title={t.title}
        description={t.description}
        actions={
          <>
            <Button
              size="sm"
              className="min-h-11 lg:min-h-8"
              disabled={
                loading || !snapshot || Boolean(busy) || active || dirty
              }
              aria-describedby={dirty ? `${id}-draft-hint` : undefined}
              onClick={() => void action("scan")}
            >
              <Search size={14} aria-hidden="true" />
              {busy === "scan" ? t.progress.scan : t.scan}
            </Button>
            <ToolRefreshButton
              label={t.refresh}
              busy={busy === "refresh"}
              disabled={loading || Boolean(busy)}
              onClick={() => void action("refresh")}
            />
          </>
        }
      >
        {snapshot && (
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="flex flex-wrap items-center gap-2 text-sm font-medium"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-[var(--good)]" : snapshot.phase === "error" ? "bg-[var(--danger)]" : "bg-[var(--line-strong)]"}`}
            />
            {status.map((part, index) => (
              <span
                key={index}
                className={
                  index === 0 && active
                    ? "text-[var(--good)]"
                    : "text-[var(--muted-strong)]"
                }
              >
                {index > 0 && (
                  <span aria-hidden="true" className="mr-2">
                    ·
                  </span>
                )}
                {part}
              </span>
            ))}
          </p>
        )}
      </ToolPageHeader>
      {loading ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          {t.loading}
        </p>
      ) : (
        <>
          {error && !rulesOpen && <Alert tone="danger">{error}</Alert>}
          {refreshError && (
            <Alert tone="warning">
              <span className="block">{t.refreshFailed}</span>
              <span className="mt-1 block text-xs">{refreshError}</span>
            </Alert>
          )}
          <p
            role="status"
            aria-live="polite"
            className="empty:hidden text-xs text-[var(--muted-strong)]"
          >
            {busy ? t.progress[busy] : notice}
          </p>
          {!snapshot ? (
            <div className="grid justify-items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
              <p className="text-sm text-[var(--muted)]">{t.failed}</p>
              <Button
                disabled={Boolean(busy)}
                onClick={() => void action("refresh")}
              >
                {busy ? t.progress.refresh : t.retry}
              </Button>
            </div>
          ) : (
            <>
              {reason && (
                <Alert
                  tone={snapshot.phase === "error" ? "danger" : "info"}
                  id={`${id}-availability`}
                >
                  {reason}
                </Alert>
              )}
              {!snapshot.canStart && !active && !reason && (
                <p
                  id={`${id}-availability`}
                  className="text-xs text-[var(--muted)]"
                >
                  {t.unavailable}
                </p>
              )}
              {dirty && (
                <Alert tone="info" id={`${id}-draft-hint`}>
                  <p>{t.dirty}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 max-w-full whitespace-normal"
                    onClick={() => setRulesOpen(true)}
                  >
                    {t.reviewDraft}
                  </Button>
                </Alert>
              )}
              {mode !== "farming" && (
                <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-3">
                  <div className="min-w-0 flex-[1_1_320px]">
                    <p className="text-sm font-semibold">
                      {mode === "manual"
                        ? t.switchHintManualTitle
                        : t.switchHintIdleTitle}
                    </p>
                    <p className="text-xs leading-5 text-[var(--muted-strong)]">
                      {mode === "manual"
                        ? t.switchHintManual
                        : t.switchHintIdle}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    className="whitespace-normal"
                    disabled={Boolean(busy) || dirty || !snapshot.canStart}
                    aria-describedby={
                      [
                        !snapshot.canStart ? `${id}-availability` : null,
                        dirty ? `${id}-draft-hint` : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    onClick={onSwitchToFarming ?? (() => void action("start"))}
                  >
                    <Play size={14} aria-hidden="true" />
                    {busy === "start" ? t.progress.start : t.switchCta}
                  </Button>
                </div>
              )}
              <FarmingBoard
                snapshot={snapshot}
                scanning={
                  snapshot.phase === "scanning" ||
                  busy === "scan" ||
                  busy === "start"
                }
                disabled={Boolean(busy) || dirty}
                onFilters={(filters) => void action("config", filters)}
                onRules={() => setRulesOpen(true)}
              />
              <section
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
                aria-labelledby={`${id}-rules`}
              >
                <h3 id={`${id}-rules`} className="mr-1 text-sm font-semibold">
                  {t.rules}
                </h3>
                <Badge>
                  {interpolate(t.parallelSummary, {
                    count: Math.min(
                      snapshot.config.maxConcurrentGames,
                      snapshot.gameLimit,
                    ),
                  })}
                </Badge>
                <Badge tone={snapshot.config.skipRefundable ? "good" : "warn"}>
                  {snapshot.config.skipRefundable
                    ? t.protectionOn
                    : t.protectionOff}
                </Badge>
                <Badge>
                  {snapshot.config.autoResume
                    ? t.autoResumeOn
                    : t.autoResumeOff}
                </Badge>
                <Badge>
                  {snapshot.config.whitelist.length
                    ? interpolate(t.whitelistSummary, {
                        count: snapshot.config.whitelist.length,
                      })
                    : t.considerAll}
                </Badge>
                {snapshot.config.blacklist.length > 0 && (
                  <Badge>
                    {interpolate(t.excludedSummary, {
                      count: snapshot.config.blacklist.length,
                    })}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setRulesOpen(true)}
                >
                  <Settings2 size={14} aria-hidden="true" />
                  {t.editRules}
                </Button>
              </section>
              <p className="text-xs leading-5 text-[var(--muted)]">{t.note}</p>
              {rulesOpen && (
                <Dialog
                  title={t.editRules}
                  description={t.rulesDescription}
                  onClose={() => setRulesOpen(false)}
                  closeDisabled={busy === "config"}
                  className="max-w-2xl"
                >
                  <FarmingSettings
                    state={state}
                    onSaved={() => setRulesOpen(false)}
                  />
                </Dialog>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
