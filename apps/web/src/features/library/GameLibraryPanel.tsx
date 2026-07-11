import { Alert } from "../../components/ui/alert";
import { Card, CardContent } from "../../components/ui/card";
import { libraryFilterModes } from "../../lib/status";
import { useI18n } from "../../i18n";
import { BoostSelectionPanel } from "./BoostSelectionPanel";
import { LibraryTable } from "./LibraryTable";
import { LibraryToolbar } from "./LibraryToolbar";
import { appendManualAppId, nextDraftAppIds } from "./library-model";
import type { GameLibraryPanelProps } from "./types";
import { useGameLibraryController } from "./useGameLibraryController";
import { useLibraryRows } from "./useLibraryRows";

export function GameLibraryPanel({
  account,
  library,
  selection,
  rightRailExtra,
}: GameLibraryPanelProps) {
  const { messages: t } = useI18n();
  const {
    libraryFilter,
    setLibraryFilter,
    libraryMode,
    setLibraryMode,
    librarySort,
    setLibrarySort,
    libraryCollapsed,
    setLibraryCollapsed,
    selectionCollapsed,
    setSelectionCollapsed,
    manualAppId,
    setManualAppId,
    draftAppIdsRef,
    sorting,
    setSorting,
  } = useGameLibraryController(account.id, selection.draftAppIds);
  const rows = useLibraryRows({
    apps: library.apps,
    filter: libraryFilter,
    mode: libraryMode,
    draftAppIds: selection.draftAppIds,
    gameLimit: selection.gameLimit,
  });
  const selectedModeLabel =
    libraryFilterModes(t).find((mode) => mode.value === libraryMode)?.label ??
    t.common.all;

  function toggleDraftApp(appId: number) {
    const next = nextDraftAppIds(
      draftAppIdsRef.current,
      appId,
      selection.gameLimit,
    );
    if (next) selection.onChange(next);
  }

  function addManualAppId() {
    const next = appendManualAppId(
      selection.draftAppIds,
      manualAppId,
      selection.gameLimit,
    );
    if (!next) return;
    selection.onChange(next);
    setManualAppId("");
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="grid min-w-0 gap-3">
            <LibraryToolbar
              importAction={{
                loading: library.loading,
                available: library.canImport,
                onImport: library.onImport,
              }}
              search={{ value: libraryFilter, onChange: setLibraryFilter }}
              manualApp={{
                value: manualAppId,
                disabled: selection.draftAppIds.length >= selection.gameLimit,
                inputRef: selection.manualAppInputRef,
                onChange: setManualAppId,
                onAdd: addManualAppId,
              }}
              view={{
                mode: libraryMode,
                sort: librarySort,
                onModeChange: setLibraryMode,
                onSortChange: setLibrarySort,
              }}
            />

            {library.error ? (
              <Alert tone="danger">{library.error}</Alert>
            ) : null}

            <LibraryTable
              runtimeStatus={account.runtimeStatus}
              libraryCount={library.apps.length}
              rows={rows}
              modeLabel={selectedModeLabel}
              collapsed={libraryCollapsed}
              onToggleCollapsed={() => setLibraryCollapsed((value) => !value)}
              sorting={sorting}
              onSortingChange={setSorting}
              onToggleApp={toggleDraftApp}
              onUpdateMeta={library.onUpdateMeta}
            />
          </div>

          <div className="grid min-w-0 gap-3">
            <BoostSelectionPanel
              collapsed={selectionCollapsed}
              onToggleCollapsed={() => setSelectionCollapsed((value) => !value)}
              selection={selection}
            />
            {rightRailExtra}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
