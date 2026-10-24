import { ChevronDown, ChevronUp, Library, Search } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  flexRender,
  useTable,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import type { AccountStatus } from "@steam-bee/contracts";
import { Button } from "../../components/ui/button";
import { libraryEmptyState, maxVisibleLibraryRows } from "../../lib/status";
import { cn } from "../../lib/utils";
import { formatPlaytime } from "../../lib/format";
import { interpolate, useI18n } from "../../i18n";
import { SteamAppArtwork } from "./SteamAppArtwork";
import {
  libraryTableFeatures,
  useLibraryTableColumns,
} from "./LibraryTableColumns";
import type { LibraryRow, LibraryUpdatePatch } from "./types";

export function LibraryTable({
  runtimeStatus,
  libraryCount,
  rows,
  modeLabel,
  collapsed,
  onToggleCollapsed,
  sorting,
  onSortingChange,
  onToggleApp,
  onUpdateMeta,
}: {
  runtimeStatus: AccountStatus;
  libraryCount: number;
  rows: LibraryRow[];
  modeLabel: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  onToggleApp: (appId: number) => void;
  onUpdateMeta: (appId: number, patch: LibraryUpdatePatch) => Promise<void>;
}) {
  const { messages: t, localeInfo } = useI18n();
  const container = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = (width: number) => {
      // Hidden containers and layout-free test environments have no useful width.
      if (width > 0) setCompact(width < 760);
    };
    const measure = () => resize(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((value) => value.target === element);
        if (entry) resize(entry.contentRect.width);
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [collapsed]);
  const columns = useLibraryTableColumns({ onToggleApp, onUpdateMeta });
  const table = useTable({
    features: libraryTableFeatures,
    data: rows,
    columns,
    state: { sorting },
    onSortingChange,
  });
  const sortedRows = table.getRowModel().rows;
  const visibleRows = sortedRows.slice(0, maxVisibleLibraryRows);

  return (
    <section
      ref={container}
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]",
        collapsed && "min-h-0",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0">
          <strong className="block truncate text-sm">
            {t.library.importedLibrary}
          </strong>
          <span className="text-xs text-[var(--muted)]">
            {interpolate(t.library.libraryStats, {
              libraryCount,
              resultCount: sortedRows.length,
              mode: modeLabel,
            })}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t.library.expand : t.library.collapse}
          title={collapsed ? t.library.expand : t.library.collapse}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </Button>
      </div>

      {collapsed ? (
        <div className="flex items-center gap-2 p-4 text-sm text-[var(--muted)]">
          <Library size={18} />
          {t.library.collapsed}
        </div>
      ) : (
        <div className="max-h-[650px] overflow-auto">
          {libraryCount === 0 ? (
            <LibraryEmpty status={runtimeStatus} />
          ) : sortedRows.length === 0 ? (
            <div className="grid justify-items-center gap-2 p-8 text-center text-sm text-[var(--muted)]">
              <Search size={20} />
              <strong className="text-[var(--ink)]">
                {t.library.noResultTitle}
              </strong>
              <span>{t.library.noResultBody}</span>
            </div>
          ) : compact ? (
            <ul
              aria-label={t.library.importedLibrary}
              className="grid min-w-0 divide-y divide-[var(--line)]"
            >
              {visibleRows.map((row) => {
                const app = row.original;
                const cells = row.getVisibleCells();
                const selection = cells.find(
                  (cell) => cell.column.id === "select",
                )!;
                const metadata = cells.find(
                  (cell) => cell.column.id === "meta",
                )!;
                return (
                  <li
                    key={row.id}
                    className={cn(
                      "grid min-w-0 gap-2 p-3",
                      app.selected && "bg-[var(--selected)]",
                    )}
                  >
                    <label
                      className={cn(
                        "flex min-w-0 cursor-pointer items-center gap-3",
                        app.blockedByLimit && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <span className="shrink-0">
                        {flexRender(
                          selection.column.columnDef.cell,
                          selection.getContext(),
                        )}
                      </span>
                      <SteamAppArtwork
                        appId={app.appId}
                        name={app.name}
                        size="mini"
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block break-words text-sm">
                          {app.name}
                        </strong>
                        <span className="mt-1 block text-xs text-[var(--muted)]">
                          {formatPlaytime(app.playtimeForever, t, localeInfo)}
                        </span>
                      </span>
                    </label>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-[var(--muted)]">
                        AppID: {app.appId}
                      </span>
                      {flexRender(
                        metadata.column.columnDef.cell,
                        metadata.getContext(),
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
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
                    aria-selected={row.original.selected}
                    className={cn(
                      "cursor-pointer border-b border-[var(--line)] transition hover:bg-[var(--surface-2)]",
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
                          onToggleApp(row.original.appId);
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
  );
}

function LibraryEmpty({ status }: { status: AccountStatus }) {
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
