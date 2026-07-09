import { type ReactNode, type RefObject, useMemo } from "react";
import {
  ChevronDown,
  ChevronUp,
  EyeOff,
  Gamepad2,
  Library,
  RefreshCw,
  Save,
  Search,
  Star,
  X,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { SteamApp } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "../../components/ui/card";
import { Input, Label, Select } from "../../components/ui/form";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { formatPlaytime } from "../../lib/format";
import {
  libraryEmptyState,
  libraryFilterModes,
  maxVisibleLibraryRows,
  type LibrarySortMode,
} from "../../lib/status";
import { cn } from "../../lib/utils";
import { interpolate, useI18n } from "../../i18n";
import { SteamAppArtwork } from "./SteamAppArtwork";
import { useGameLibraryController } from "./useGameLibraryController";

type SelectedGame = {
  appId: number;
  name: string;
  playtimeForever?: number;
};

type SelectionStateCopy = {
  label: string;
  body: string;
  tone: "busy" | "applied" | "queued" | "idle" | "dirty";
};

type LibraryRow = SteamApp & {
  selected: boolean;
  blockedByLimit: boolean;
};

export function GameLibraryPanel({
  accountId,
  runtimeStatus,
  library,
  libraryLoading,
  libraryError,
  canImportLibrary,
  onImport,
  draftAppIds,
  appliedAppIds,
  selectedGames,
  gameLimit,
  draftOverLimit,
  gamesApplying,
  gamesAppliedAt,
  selectionDirty,
  selectionState,
  manualAppInputRef,
  onDraftChange,
  onUpdateLibraryMeta,
  onApply,
  onRevert,
  rightRailExtra,
}: {
  accountId: string;
  runtimeStatus: string;
  library: SteamApp[];
  libraryLoading: boolean;
  libraryError: string | null;
  canImportLibrary: boolean;
  onImport: () => Promise<void>;
  draftAppIds: number[];
  appliedAppIds: number[];
  selectedGames: SelectedGame[];
  gameLimit: number;
  draftOverLimit: boolean;
  gamesApplying: boolean;
  gamesAppliedAt: number | null;
  selectionDirty: boolean;
  selectionState: SelectionStateCopy;
  manualAppInputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: (appIds: number[]) => void;
  onUpdateLibraryMeta: (
    appId: number,
    patch: { favorite?: boolean; hidden?: boolean },
  ) => Promise<void>;
  onApply: () => Promise<void>;
  onRevert: () => void;
  rightRailExtra?: ReactNode;
}) {
  const { messages: t, localeInfo } = useI18n();
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
  } = useGameLibraryController(accountId, draftAppIds);

  const draftAppIdSet = useMemo(() => new Set(draftAppIds), [draftAppIds]);

  const rows = useMemo<LibraryRow[]>(() => {
    const query = libraryFilter.trim().toLowerCase();
    return library
      .filter((app) => {
        if (
          query &&
          !app.name.toLowerCase().includes(query) &&
          !String(app.appId).includes(query)
        ) {
          return false;
        }

        if (app.hidden && libraryMode !== "hidden") return false;
        if (libraryMode === "selected") return draftAppIdSet.has(app.appId);
        if (libraryMode === "unselected") return !draftAppIdSet.has(app.appId);
        if (libraryMode === "played") {
          return Boolean(app.playtimeForever && app.playtimeForever > 0);
        }
        if (libraryMode === "unplayed") return !app.playtimeForever;
        if (libraryMode === "favorites") return Boolean(app.favorite);
        if (libraryMode === "hidden") return Boolean(app.hidden);
        return true;
      })
      .map((app) => {
        const selected = draftAppIdSet.has(app.appId);
        return {
          ...app,
          selected,
          blockedByLimit: !selected && draftAppIds.length >= gameLimit,
        };
      });
  }, [
    draftAppIdSet,
    draftAppIds.length,
    gameLimit,
    library,
    libraryFilter,
    libraryMode,
  ]);

  const columns = useMemo<ColumnDef<LibraryRow>[]>(
    () => [
      {
        id: "select",
        header: "",
        cell: ({ row }) => {
          const app = row.original;
          return (
            <input
              type="checkbox"
              checked={app.selected}
              disabled={app.blockedByLimit}
              title={
                app.blockedByLimit
                  ? t.library.slotLimitReached
                  : t.library.select
              }
              aria-label={interpolate(t.library.selectGame, {
                name: app.name,
              })}
              onClick={(event) => event.stopPropagation()}
              onChange={() => toggleDraftApp(app.appId)}
            />
          );
        },
        enableSorting: false,
      },
      {
        id: "artwork",
        header: "",
        cell: ({ row }) => (
          <SteamAppArtwork
            appId={row.original.appId}
            name={row.original.name}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: t.common.game,
        cell: ({ row }) => (
          <div className="min-w-0">
            <strong className="block truncate text-sm">
              {row.original.name}
            </strong>
            <small className="text-xs text-[var(--muted)]">
              {formatPlaytime(row.original.playtimeForever, t, localeInfo)}
            </small>
          </div>
        ),
      },
      {
        accessorKey: "playtimeForever",
        header: t.common.playtime,
        cell: ({ row }) =>
          formatPlaytime(row.original.playtimeForever, t, localeInfo),
      },
      {
        accessorKey: "appId",
        header: "AppID",
        cell: ({ row }) => row.original.appId,
      },
      {
        id: "meta",
        header: "",
        cell: ({ row }) => {
          const app = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  void onUpdateLibraryMeta(app.appId, {
                    favorite: !app.favorite,
                  });
                }}
                aria-label={
                  app.favorite
                    ? interpolate(t.library.removeFromFavorites, {
                        name: app.name,
                      })
                    : interpolate(t.library.addToFavorites, { name: app.name })
                }
                title={
                  app.favorite ? t.common.removeFavorite : t.common.favorite
                }
                className={app.favorite ? "text-[var(--accent)]" : undefined}
              >
                <Star size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  void onUpdateLibraryMeta(app.appId, { hidden: !app.hidden });
                }}
                aria-label={
                  app.hidden
                    ? interpolate(t.library.showGame, { name: app.name })
                    : interpolate(t.library.hideGame, { name: app.name })
                }
                title={app.hidden ? t.common.show : t.common.hide}
                className={app.hidden ? "text-[var(--muted)]" : undefined}
              >
                <EyeOff size={14} />
              </Button>
            </div>
          );
        },
        enableSorting: false,
      },
    ],
    [localeInfo, onDraftChange, onUpdateLibraryMeta, t],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const sortedRows = table.getRowModel().rows;
  const visibleRows = sortedRows.slice(0, maxVisibleLibraryRows);
  const libraryModes = libraryFilterModes(t);
  const selectedModeLabel =
    libraryModes.find((mode) => mode.value === libraryMode)?.label ??
    t.common.all;

  function toggleDraftApp(appId: number) {
    const currentDraftAppIds = draftAppIdsRef.current;
    const selected = currentDraftAppIds.includes(appId);
    if (!selected && currentDraftAppIds.length >= gameLimit) return;
    onDraftChange(
      selected
        ? currentDraftAppIds.filter((id) => id !== appId)
        : [...currentDraftAppIds, appId],
    );
  }

  function addManualAppId() {
    const appId = Number(manualAppId);
    if (Number.isInteger(appId) && appId > 0) {
      onDraftChange([...draftAppIds, appId]);
      setManualAppId("");
    }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="grid min-w-0 gap-3">
            <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-2)]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-3 py-2">
                <div className="min-w-0">
                  <CardTitle>
                    <Library size={16} />
                    {t.library.title}
                  </CardTitle>
                  <CardDescription>{t.library.description}</CardDescription>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void onImport()}
                  disabled={libraryLoading || !canImportLibrary}
                  title={
                    canImportLibrary
                      ? t.common.importLibrary
                      : t.library.importUnavailable
                  }
                >
                  <RefreshCw size={15} />
                  {libraryLoading ? t.library.importing : t.library.import}
                </Button>
              </div>

              <div className="grid gap-2 p-3">
                <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_minmax(260px,1fr)]">
                  <Label className="min-w-0" htmlFor="library-search">
                    {t.library.searchLabel}
                    <div className="relative">
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                      />
                      <Input
                        id="library-search"
                        value={libraryFilter}
                        onChange={(event) =>
                          setLibraryFilter(event.target.value)
                        }
                        placeholder={t.library.searchPlaceholder}
                        className="pl-9"
                      />
                    </div>
                  </Label>
                  <Label className="min-w-0" htmlFor="manual-appid">
                    {t.library.addAppId}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Input
                        ref={manualAppInputRef}
                        id="manual-appid"
                        inputMode="numeric"
                        value={manualAppId}
                        onChange={(event) => setManualAppId(event.target.value)}
                        placeholder={t.library.appIdPlaceholder}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addManualAppId();
                          }
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={draftAppIds.length >= gameLimit}
                        onClick={addManualAppId}
                      >
                        {t.library.add}
                      </Button>
                    </div>
                  </Label>
                </div>

                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_150px] lg:items-end">
                  <SegmentedControl
                    value={libraryMode}
                    onChange={setLibraryMode}
                    ariaLabel={t.library.viewAria}
                    className="min-h-8 w-full max-w-full overflow-auto p-0.5 [&_button]:whitespace-nowrap [&_button]:px-2 [&_button]:py-1"
                    options={libraryModes}
                  />
                  <Select
                    id="library-sort"
                    value={librarySort}
                    aria-label={t.library.sortAria}
                    className="min-h-8 py-0 text-xs"
                    onChange={(event) =>
                      setLibrarySort(event.target.value as LibrarySortMode)
                    }
                  >
                    <option value="name">{t.common.name}</option>
                    <option value="playtime">{t.common.playtime}</option>
                    <option value="appid">AppID</option>
                  </Select>
                </div>
              </div>
            </section>

            {libraryError && <Alert tone="danger">{libraryError}</Alert>}

            <section
              className={cn(
                "min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]",
                libraryCollapsed && "min-h-0",
              )}
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {t.library.importedLibrary}
                  </strong>
                  <span className="text-xs text-[var(--muted)]">
                    {interpolate(t.library.libraryStats, {
                      libraryCount: library.length,
                      resultCount: sortedRows.length,
                      mode: selectedModeLabel,
                    })}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLibraryCollapsed((value) => !value)}
                  aria-label={
                    libraryCollapsed ? t.library.expand : t.library.collapse
                  }
                  title={
                    libraryCollapsed ? t.library.expand : t.library.collapse
                  }
                >
                  {libraryCollapsed ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronUp size={16} />
                  )}
                </Button>
              </div>

              {libraryCollapsed ? (
                <div className="flex items-center gap-2 p-4 text-sm text-[var(--muted)]">
                  <Library size={18} />
                  {t.library.collapsed}
                </div>
              ) : (
                <div className="max-h-[650px] overflow-auto">
                  {library.length === 0 ? (
                    <LibraryEmpty status={runtimeStatus} />
                  ) : sortedRows.length === 0 ? (
                    <div className="grid justify-items-center gap-2 p-8 text-center text-sm text-[var(--muted)]">
                      <Search size={20} />
                      <strong className="text-[var(--ink)]">
                        {t.library.noResultTitle}
                      </strong>
                      <span>{t.library.noResultBody}</span>
                    </div>
                  ) : (
                    <table className="w-full min-w-[760px] border-collapse text-sm">
                      <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
                        {table.getHeaderGroups().map((headerGroup) => (
                          <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                              <th
                                key={header.id}
                                className={cn(
                                  "border-b border-[var(--line)] px-3 py-2 text-left text-xs font-semibold text-[var(--muted-strong)]",
                                  header.id === "select" && "w-10",
                                  header.id === "artwork" && "w-[110px]",
                                  header.id === "playtimeForever" && "w-28",
                                  header.id === "appId" && "w-24",
                                  header.id === "meta" && "w-32",
                                )}
                              >
                                {header.isPlaceholder
                                  ? null
                                  : flexRender(
                                      header.column.columnDef.header,
                                      header.getContext(),
                                    )}
                              </th>
                            ))}
                          </tr>
                        ))}
                      </thead>
                      <tbody>
                        {visibleRows.map((row) => (
                          <tr
                            key={row.id}
                            tabIndex={row.original.blockedByLimit ? -1 : 0}
                            aria-label={`${row.original.name} ${t.library.selectionTitle}`}
                            aria-selected={row.original.selected}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleDraftApp(row.original.appId);
                              }
                            }}
                            className={cn(
                              "cursor-pointer border-b border-[var(--line)] transition hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
                              row.original.selected && "bg-[var(--selected)]",
                              row.original.blockedByLimit &&
                                "cursor-not-allowed opacity-60",
                            )}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <td
                                key={cell.id}
                                onClick={(event) => {
                                  if (cell.column.id === "meta") return;
                                  event.stopPropagation();
                                  const checkbox =
                                    event.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                                      'input[type="checkbox"]',
                                    );
                                  if (checkbox && !checkbox.disabled) {
                                    checkbox.checked = !checkbox.checked;
                                  }
                                  toggleDraftApp(row.original.appId);
                                }}
                                className={cn(
                                  "px-3 py-2 align-middle",
                                  cell.column.id === "playtimeForever" &&
                                    "text-xs text-[var(--muted)]",
                                  cell.column.id === "appId" &&
                                    "text-xs font-semibold text-[var(--muted)]",
                                )}
                              >
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext(),
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {sortedRows.length > maxVisibleLibraryRows ? (
                    <div className="border-t border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
                      {interpolate(t.library.visibleRows, {
                        visible: maxVisibleLibraryRows,
                        total: sortedRows.length,
                      })}
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>

          <div className="grid min-w-0 gap-3">
            <BoostSelectionPanel
              collapsed={selectionCollapsed}
              onToggleCollapsed={() => setSelectionCollapsed((value) => !value)}
              selectedGames={selectedGames}
              draftAppIds={draftAppIds}
              appliedAppIds={appliedAppIds}
              gameLimit={gameLimit}
              draftOverLimit={draftOverLimit}
              gamesApplying={gamesApplying}
              gamesAppliedAt={gamesAppliedAt}
              selectionDirty={selectionDirty}
              selectionState={selectionState}
              onDraftChange={onDraftChange}
              onApply={onApply}
              onRevert={onRevert}
            />
            {rightRailExtra}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function LibraryEmpty({ status }: { status: string }) {
  const { messages: t } = useI18n();
  const empty = libraryEmptyState(status, t);
  return (
    <div className="grid justify-items-center gap-2 p-8 text-center text-sm text-[var(--muted)]">
      <Library size={20} />
      <strong className="text-[var(--ink)]">{empty.title}</strong>
      <span className="max-w-lg leading-6">{empty.body}</span>
    </div>
  );
}

function BoostSelectionPanel({
  collapsed,
  onToggleCollapsed,
  selectedGames,
  draftAppIds,
  appliedAppIds,
  gameLimit,
  draftOverLimit,
  gamesApplying,
  gamesAppliedAt,
  selectionDirty,
  selectionState,
  onDraftChange,
  onApply,
  onRevert,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selectedGames: SelectedGame[];
  draftAppIds: number[];
  appliedAppIds: number[];
  gameLimit: number;
  draftOverLimit: boolean;
  gamesApplying: boolean;
  gamesAppliedAt: number | null;
  selectionDirty: boolean;
  selectionState: SelectionStateCopy;
  onDraftChange: (appIds: number[]) => void;
  onApply: () => Promise<void>;
  onRevert: () => void;
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
                time: new Date(gamesAppliedAt).toLocaleTimeString(
                  localeInfo.dateLocale,
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                ),
              })}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
