import type { RefObject } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input, Select } from "../../components/ui/form";
import {
  libraryFilterModes,
  type LibraryFilterMode,
  type LibrarySortMode,
} from "../../lib/status";
import { useI18n } from "../../i18n";

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
  search,
  view,
}: {
  search: { value: string; onChange: (value: string) => void };
  view: LibraryViewControl;
}) {
  const { messages: t } = useI18n();
  const libraryModes = libraryFilterModes(t);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-[1_1_260px]">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <Input
          id="library-search"
          type="search"
          aria-label={t.library.searchLabel}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          placeholder={t.library.searchPlaceholder}
          className="pl-9"
        />
      </div>
      <Select
        id="library-filter"
        value={view.mode}
        aria-label={t.library.viewAria}
        className="w-auto min-w-[140px] flex-[0_1_auto]"
        onChange={(event) => {
          const next = libraryModes.find(
            (mode) => mode.value === event.target.value,
          );
          if (next) view.onModeChange(next.value);
        }}
      >
        {libraryModes.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </Select>
      <Select
        id="library-sort"
        value={view.sort}
        aria-label={t.library.sortAria}
        className="w-auto min-w-[120px] flex-[0_1_auto]"
        onChange={(event) => {
          const value = event.target.value;
          if (value === "name" || value === "playtime" || value === "appid") {
            view.onSortChange(value);
          }
        }}
      >
        <option value="name">{t.common.name}</option>
        <option value="playtime">{t.common.playtime}</option>
        <option value="appid">AppID</option>
      </Select>
    </div>
  );
}

export function ManualAppIdRow({ manualApp }: { manualApp: ManualAppControl }) {
  const { messages: t } = useI18n();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
      <label
        htmlFor="manual-appid"
        className="text-xs font-semibold text-[var(--muted-strong)]"
      >
        {t.library.addAppId}
      </label>
      <Input
        ref={manualApp.inputRef}
        id="manual-appid"
        inputMode="numeric"
        value={manualApp.value}
        onChange={(event) => manualApp.onChange(event.target.value)}
        placeholder={t.library.appIdPlaceholder}
        className="h-8 min-h-8 w-40 max-w-full"
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
        <Plus size={14} aria-hidden="true" />
        {t.library.add}
      </Button>
    </div>
  );
}

export type { ManualAppControl };
