import type { RefObject } from "react";
import { Library, RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { CardDescription, CardTitle } from "../../components/ui/card";
import { Input, Label, Select } from "../../components/ui/form";
import { SegmentedControl } from "../../components/ui/segmented-control";
import {
  libraryFilterModes,
  type LibraryFilterMode,
  type LibrarySortMode,
} from "../../lib/status";
import { useI18n } from "../../i18n";

type ImportAction = {
  loading: boolean;
  available: boolean;
  onImport: () => Promise<void>;
};

type ManualAppControl = {
  value: string;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onAdd: () => void;
};

type LibraryViewControl = {
  mode: LibraryFilterMode;
  sort: LibrarySortMode;
  onModeChange: (mode: LibraryFilterMode) => void;
  onSortChange: (sort: LibrarySortMode) => void;
};

export function LibraryToolbar({
  importAction,
  search,
  manualApp,
  view,
}: {
  importAction: ImportAction;
  search: { value: string; onChange: (value: string) => void };
  manualApp: ManualAppControl;
  view: LibraryViewControl;
}) {
  const { messages: t } = useI18n();
  const libraryModes = libraryFilterModes(t);

  return (
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
          onClick={() => void importAction.onImport()}
          disabled={importAction.loading || !importAction.available}
          title={
            importAction.available
              ? t.common.importLibrary
              : t.library.importUnavailable
          }
        >
          <RefreshCw size={15} />
          {importAction.loading ? t.library.importing : t.library.import}
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
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                placeholder={t.library.searchPlaceholder}
                className="pl-9"
              />
            </div>
          </Label>
          <Label className="min-w-0" htmlFor="manual-appid">
            {t.library.addAppId}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                ref={manualApp.inputRef}
                id="manual-appid"
                inputMode="numeric"
                value={manualApp.value}
                onChange={(event) => manualApp.onChange(event.target.value)}
                placeholder={t.library.appIdPlaceholder}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    manualApp.onAdd();
                  }
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={manualApp.disabled}
                onClick={manualApp.onAdd}
              >
                {t.library.add}
              </Button>
            </div>
          </Label>
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_150px] lg:items-end">
          <SegmentedControl
            value={view.mode}
            onChange={view.onModeChange}
            ariaLabel={t.library.viewAria}
            className="min-h-8 w-full max-w-full overflow-auto p-0.5 [&_button]:whitespace-nowrap [&_button]:px-2 [&_button]:py-1"
            options={libraryModes}
          />
          <Select
            id="library-sort"
            value={view.sort}
            aria-label={t.library.sortAria}
            className="min-h-8 py-0 text-xs"
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "name" ||
                value === "playtime" ||
                value === "appid"
              ) {
                view.onSortChange(value);
              }
            }}
          >
            <option value="name">{t.common.name}</option>
            <option value="playtime">{t.common.playtime}</option>
            <option value="appid">AppID</option>
          </Select>
        </div>
      </div>
    </section>
  );
}
