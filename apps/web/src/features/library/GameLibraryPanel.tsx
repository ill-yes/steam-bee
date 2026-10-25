import { Alert } from "../../components/ui/alert";
import { useId } from "react";
import { Gamepad2, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ToolPageHeader } from "../../components/ui/tool-page-header";
import { libraryFilterModes } from "../../lib/status";
import { useI18n } from "../../i18n";
import { BoostSelectionPanel } from "./BoostSelectionPanel";
import { LibraryTable } from "./LibraryTable";
import { LibraryToolbar, ManualAppIdRow } from "./LibraryToolbar";
import { hubCopy } from "../accounts/detail/hubCopy";
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
  const { messages: t, locale } = useI18n();
  const id = useId();
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
    <section className="grid min-w-0 gap-4" aria-labelledby={`${id}-title`}>
      <ToolPageHeader
        icon={Gamepad2}
        titleId={`${id}-title`}
        title={hubCopy(locale).library}
        description={t.library.description}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void library.onImport()}
            disabled={library.loading || !library.canImport}
            title={
              library.canImport
                ? t.common.importLibrary
                : t.library.importUnavailable
            }
          >
            <RefreshCw
              size={15}
              aria-hidden="true"
              className={library.loading ? "animate-spin" : undefined}
            />
            {library.loading ? t.library.importing : t.library.import}
          </Button>
        }
      />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="grid min-w-0 gap-3">
          <LibraryToolbar
            search={{ value: libraryFilter, onChange: setLibraryFilter }}
            view={{
              mode: libraryMode,
              sort: librarySort,
              onModeChange: setLibraryMode,
              onSortChange: setLibrarySort,
            }}
          />

          {library.error ? <Alert tone="danger">{library.error}</Alert> : null}

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
            footer={
              <ManualAppIdRow
                manualApp={{
                  value: manualAppId,
                  disabled: selection.draftAppIds.length >= selection.gameLimit,
                  inputRef: selection.manualAppInputRef,
                  onChange: setManualAppId,
                  onAdd: addManualAppId,
                }}
              />
            }
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
      </div>
    </section>
  );
}
