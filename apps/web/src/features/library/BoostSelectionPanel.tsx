import { ChevronDown, ChevronUp, Gamepad2, Save, X } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatEventTime, formatPlaytime } from "../../lib/format";
import { interpolate, useI18n } from "../../i18n";
import { SteamAppArtwork } from "./SteamAppArtwork";
import type { SelectionModel } from "./types";

type BoostSelectionModel = Omit<SelectionModel, "manualAppInputRef">;

export function BoostSelectionPanel({
  collapsed,
  onToggleCollapsed,
  selection: {
    selectedGames,
    draftAppIds,
    appliedAppIds,
    gameLimit,
    overLimit: draftOverLimit,
    applying: gamesApplying,
    appliedAt: gamesAppliedAt,
    dirty: selectionDirty,
    state: selectionState,
    onChange: onDraftChange,
    onApply,
    onRevert,
  },
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selection: BoostSelectionModel;
}) {
  const { messages: t, localeInfo } = useI18n();

  return (
    <aside className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Gamepad2 size={16} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <strong className="block truncate text-sm">
              {t.library.selectionTitle}
            </strong>
            <span className="block truncate text-xs text-[var(--muted)]">
              {selectionState.body}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={draftOverLimit ? "danger" : "accent"}>
            {draftAppIds.length}/{gameLimit}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapsed}
            aria-label={
              collapsed
                ? t.library.expandSelection
                : t.library.collapseSelection
            }
            title={
              collapsed
                ? t.library.expandSelection
                : t.library.collapseSelection
            }
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </div>
      </div>

      {collapsed ? (
        <div className="p-3 text-sm text-[var(--muted)]">
          {draftAppIds.length === 0
            ? t.library.noSelectedGames
            : interpolate(t.library.draftCount, { count: draftAppIds.length })}
        </div>
      ) : (
        <div className="grid gap-3 p-3">
          <div className="grid gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge
                tone={
                  selectionState.tone === "dirty"
                    ? "warn"
                    : selectionState.tone === "applied"
                      ? "good"
                      : selectionState.tone === "busy"
                        ? "info"
                        : "neutral"
                }
              >
                {selectionState.label}
              </Badge>
              {selectionDirty ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onRevert}
                    disabled={gamesApplying}
                  >
                    {t.library.discard}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void onApply()}
                    disabled={gamesApplying || draftOverLimit}
                  >
                    <Save size={15} />
                    {gamesApplying
                      ? t.library.applying
                      : t.library.applySelection}
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-[var(--muted)]">
                  {t.library.noOpenChanges}
                </span>
              )}
            </div>
            {appliedAppIds.length !== draftAppIds.length || selectionDirty ? (
              <p className="text-xs leading-5 text-[var(--muted)]">
                {interpolate(t.library.activeDraft, {
                  active: appliedAppIds.length,
                  draft: draftAppIds.length,
                })}
              </p>
            ) : null}
          </div>

          {draftOverLimit ? (
            <Alert tone="warning">
              {interpolate(t.library.overLimit, { limit: gameLimit })}
            </Alert>
          ) : null}

          {selectedGames.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-4 text-sm text-[var(--muted)]">
              {t.library.chooseFromLibrary}
            </div>
          ) : (
            <div className="grid max-h-[520px] gap-2 overflow-auto pr-1">
              {selectedGames.map((app) => (
                <div
                  key={app.appId}
                  className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2"
                >
                  <SteamAppArtwork
                    appId={app.appId}
                    name={app.name}
                    size="mini"
                  />
                  <div className="min-w-0">
                    <strong className="block truncate text-sm" title={app.name}>
                      {app.name}
                    </strong>
                    <span className="text-xs text-[var(--muted)]">
                      AppID {app.appId}
                      {app.playtimeForever
                        ? ` · ${formatPlaytime(
                            app.playtimeForever,
                            t,
                            localeInfo,
                          )}`
                        : ""}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={gamesApplying}
                    onClick={() =>
                      onDraftChange(
                        draftAppIds.filter((appId) => appId !== app.appId),
                      )
                    }
                    aria-label={interpolate(t.library.removeFromSelection, {
                      name: app.name,
                    })}
                    title={t.library.removeFromSelectionTitle}
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {gamesAppliedAt ? (
            <div className="text-xs text-[var(--muted)]">
              {interpolate(t.library.lastApplied, {
                time: formatEventTime(gamesAppliedAt, localeInfo),
              })}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
