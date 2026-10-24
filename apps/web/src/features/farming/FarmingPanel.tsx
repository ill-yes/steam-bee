import { useId, useRef, useState } from "react";
import type { AccountStatus, SteamApp } from "@steam-bee/contracts";
import { Layers, Play, Search, Square } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  ToolPageHeader,
  ToolRefreshButton,
} from "../../components/ui/tool-page-header";
import { ToolTabs } from "../../components/ui/tool-tabs";
import { FarmingOverview } from "./FarmingOverview";
import { FarmingSettings } from "./FarmingSettings";
import { useFarmingPanel } from "./useFarmingPanel";

export type FarmingActivityMode = "manual" | "farming" | "idle";
type FarmingTab = "overview" | "settings";
type Props = {
  accountId: string;
  library?: SteamApp[] | undefined;
  activityMode?: FarmingActivityMode | undefined;
  accountStatus?: AccountStatus | undefined;
};

export function FarmingPanel(props: Props) {
  return <AccountFarmingPanel key={props.accountId} {...props} />;
}

function AccountFarmingPanel({
  accountId,
  library,
  activityMode,
  accountStatus,
}: Props) {
  const state = useFarmingPanel(accountId, accountStatus, activityMode);
  const {
    t,
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
  const id = useId();
  const [tab, setTab] = useState<FarmingTab>("overview");
  const [settingsVisited, setSettingsVisited] = useState(false);
  const settingsTitle = useRef<HTMLHeadingElement>(null);
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
  function selectTab(next: FarmingTab) {
    if (next === "settings") setSettingsVisited(true);
    setTab(next);
  }
  function openSettings() {
    selectTab("settings");
    requestAnimationFrame(() => {
      settingsTitle.current?.focus({ preventScroll: true });
      settingsTitle.current?.scrollIntoView?.({ block: "start" });
    });
  }

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby={`${id}-title`}>
      <ToolPageHeader
        icon={Layers}
        titleId={`${id}-title`}
        title={t.title}
        description={t.description}
        actions={
          <ToolRefreshButton
            label={t.refresh}
            busy={busy === "refresh"}
            disabled={loading || Boolean(busy)}
            onClick={() => void action("refresh")}
          />
        }
      >
        {snapshot && (
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" aria-live="polite" aria-atomic="true">
              <Badge
                tone={
                  active
                    ? "info"
                    : snapshot.phase === "error"
                      ? "danger"
                      : "neutral"
                }
              >
                {t.phases[snapshot.phase]}
              </Badge>
            </span>
            <Badge tone={mode === "farming" ? "accent" : "neutral"}>
              {mode === "farming"
                ? t.modeFarming
                : mode === "manual"
                  ? t.modeManual
                  : t.modeIdle}
            </Badge>
          </div>
        )}
      </ToolPageHeader>
      {loading ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          {t.loading}
        </p>
      ) : (
        <>
          {error && (tab === "overview" || !snapshot) && (
            <Alert tone="danger">{error}</Alert>
          )}
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
                  {tab === "overview" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 max-w-full whitespace-normal"
                      onClick={openSettings}
                    >
                      {t.reviewDraft}
                    </Button>
                  )}
                </Alert>
              )}
              <div className="grid min-w-0 gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <Button
                    variant="primary"
                    className="whitespace-normal"
                    disabled={
                      Boolean(busy) || active || dirty || !snapshot.canStart
                    }
                    aria-describedby={
                      [
                        !snapshot.canStart && (!active || reason)
                          ? `${id}-availability`
                          : null,
                        dirty ? `${id}-draft-hint` : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    onClick={() => void action("start")}
                  >
                    <Play size={14} aria-hidden="true" />
                    {busy === "start" ? t.progress.start : t.start}
                  </Button>
                  <Button
                    className="whitespace-normal"
                    disabled={Boolean(busy) || active || dirty}
                    aria-describedby={dirty ? `${id}-draft-hint` : undefined}
                    onClick={() => void action("scan")}
                  >
                    <Search size={14} aria-hidden="true" />
                    {busy === "scan" ? t.progress.scan : t.scan}
                  </Button>
                  <Button
                    className="col-span-2 whitespace-normal sm:col-span-1"
                    variant="danger"
                    disabled={
                      (!active && busy !== "start" && busy !== "scan") ||
                      busy === "stop"
                    }
                    onClick={() => void action("stop")}
                  >
                    <Square size={14} aria-hidden="true" />
                    {busy === "stop" ? t.progress.stop : t.stop}
                  </Button>
                </div>
                <p className="text-xs leading-5 text-[var(--muted)]">
                  {t.modeHintCompact}
                </p>
              </div>
              <ToolTabs<FarmingTab>
                label={t.tabsLabel}
                items={[
                  { id: "overview", label: t.overview },
                  { id: "settings", label: t.selectionSettings },
                ]}
                value={tab}
                onChange={selectTab}
              >
                <div hidden={tab !== "overview"}>
                  <FarmingOverview
                    snapshot={snapshot}
                    scanning={
                      snapshot.phase === "scanning" ||
                      busy === "scan" ||
                      busy === "start"
                    }
                    onSettings={openSettings}
                  />
                </div>
                <div hidden={tab !== "settings"}>
                  {settingsVisited && (
                    <FarmingSettings
                      accountId={accountId}
                      library={library}
                      state={state}
                      visible={tab === "settings"}
                      titleRef={settingsTitle}
                    />
                  )}
                </div>
              </ToolTabs>
            </>
          )}
        </>
      )}
    </section>
  );
}
