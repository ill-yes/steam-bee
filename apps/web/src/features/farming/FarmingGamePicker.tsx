import { useId, useMemo, useState } from "react";
import type { FarmingSnapshot, SteamApp } from "@steam-bee/contracts";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input, Label, Select } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { SteamAppArtwork } from "../library/SteamAppArtwork";
import { farmingCopy } from "./copy";
import { parseDraftIds, type FarmingDraft } from "./drafts";
import { useFarmingLibrary } from "./useFarmingLibrary";

type Choice = "neutral" | "allowed" | "excluded";
type Filter = "all" | "drops" | "allowed" | "excluded";
const pageSize = 12;

export function FarmingGamePicker({
  accountId,
  snapshot,
  draft,
  disabled,
  library: provided,
  onChange,
}: {
  accountId: string;
  snapshot: FarmingSnapshot;
  draft: FarmingDraft;
  disabled: boolean;
  library?: SteamApp[] | undefined;
  onChange: (change: Partial<FarmingDraft>) => void;
}) {
  const { locale, localeInfo } = useI18n();
  const t = farmingCopy(locale);
  const id = useId();
  const { library, loading, error, retry } = useFarmingLibrary(
    accountId,
    provided,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const allowed = parseDraftIds(draft.whitelist);
  const excluded = parseDraftIds(draft.blacklist);
  const invalidIds = allowed === null || excluded === null;
  const allowedSet = new Set(allowed ?? []);
  const excludedSet = new Set(excluded ?? []);
  const choice = (appId: number): Choice =>
    excludedSet.has(appId)
      ? "excluded"
      : allowedSet.has(appId)
        ? "allowed"
        : "neutral";

  const games = useMemo(() => {
    const byId = new Map<
      number,
      { appId: number; name: string; drops: number | null }
    >();
    for (const game of library)
      byId.set(game.appId, { appId: game.appId, name: game.name, drops: null });
    for (const game of snapshot.games)
      byId.set(game.appId, {
        appId: game.appId,
        name: byId.get(game.appId)?.name ?? game.name,
        drops: game.remainingDrops,
      });
    for (const appId of [...(allowed ?? []), ...(excluded ?? [])]) {
      if (!byId.has(appId))
        byId.set(appId, {
          appId,
          name: interpolate(t.unknownGame, { appId }),
          drops: null,
        });
    }
    return [...byId.values()].sort(
      (a, b) =>
        Number((b.drops ?? 0) > 0) - Number((a.drops ?? 0) > 0) ||
        a.name.localeCompare(b.name, localeInfo.dateLocale) ||
        a.appId - b.appId,
    );
  }, [
    library,
    snapshot.games,
    draft.whitelist,
    draft.blacklist,
    t.unknownGame,
    localeInfo.dateLocale,
  ]);
  const terms = query
    .trim()
    .toLocaleLowerCase(localeInfo.dateLocale)
    .split(/\s+/)
    .filter(Boolean);
  const filtered = games.filter(
    (game) =>
      terms.every((term) =>
        `${game.name} ${game.appId}`
          .toLocaleLowerCase(localeInfo.dateLocale)
          .includes(term),
      ) &&
      (filter === "all" ||
        (filter === "drops" && (game.drops ?? 0) > 0) ||
        filter === choice(game.appId)),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  function select(appId: number, state: Choice) {
    if (disabled || invalidIds) return;
    const nextAllowed = (allowed ?? []).filter((id) => id !== appId);
    const nextExcluded = (excluded ?? []).filter((id) => id !== appId);
    if (state === "allowed") nextAllowed.push(appId);
    if (state === "excluded") nextExcluded.push(appId);
    if (nextAllowed.length > 500 || nextExcluded.length > 500) {
      setSelectionError(t.selectionLimit);
      return;
    }
    setSelectionError(null);
    onChange({
      whitelist: nextAllowed.join(", "),
      blacklist: nextExcluded.join(", "),
    });
  }

  return (
    <section
      className="grid min-w-0 gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3"
      aria-labelledby={`${id}-title`}
    >
      <div className="grid gap-1">
        <h4 id={`${id}-title`} className="text-sm font-semibold">
          {t.chooseGames}
        </h4>
        <p id={`${id}-hint`} className="text-xs leading-5 text-[var(--muted)]">
          {t.selectionHint}
        </p>
        <p className="text-xs font-semibold text-[var(--muted-strong)]">
          {allowedSet.size === 0
            ? t.considerAll
            : interpolate(t.allowedCount, {
                count: [...allowedSet].filter(
                  (appId) => !excludedSet.has(appId),
                ).length,
              })}{" "}
          · {interpolate(t.excludedCount, { count: excludedSet.size })}
        </p>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Label className="min-w-0">
          <span className="sr-only">{t.searchGames}</span>
          <div className="relative">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <Input
              type="search"
              className="ps-9"
              value={query}
              placeholder={t.searchGames}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </div>
        </Label>
        <Select
          aria-label={t.filterGames}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as Filter);
            setPage(0);
          }}
        >
          <option value="all">{t.allGames}</option>
          <option value="drops">{t.withDrops}</option>
          <option value="allowed">{t.allowed}</option>
          <option value="excluded">{t.excluded}</option>
        </Select>
      </div>
      {loading && (
        <p role="status" className="text-xs text-[var(--muted)]">
          {t.libraryLoading}
        </p>
      )}
      {error && (
        <Alert tone="warning">
          <span className="block">{t.libraryFailed}</span>
          <span className="mt-1 block text-xs">{error}</span>
          <Button size="sm" variant="ghost" onClick={retry}>
            {t.retryLibrary}
          </Button>
        </Alert>
      )}
      {invalidIds && <Alert tone="warning">{t.fixManualIds}</Alert>}
      {selectionError && <Alert tone="warning">{selectionError}</Alert>}
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--line-strong)] p-3 text-xs leading-5 text-[var(--muted)]">
          {games.length === 0 ? t.libraryEmpty : t.noGameMatches}
        </p>
      ) : (
        <ul
          className="grid max-h-[28rem] min-w-0 gap-2 overflow-auto sm:grid-cols-2"
          aria-label={t.chooseGames}
        >
          {visible.map((game) => {
            const selected = choice(game.appId);
            return (
              <li
                key={game.appId}
                className="grid min-w-0 gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <SteamAppArtwork
                    appId={game.appId}
                    name={game.name}
                    size="mini"
                  />
                  <div className="min-w-0 flex-1">
                    <strong
                      className="block truncate text-xs"
                      title={game.name}
                    >
                      {game.name}
                    </strong>
                    <span className="block text-[11px] text-[var(--muted)]">
                      {game.drops === null
                        ? `AppID ${game.appId}`
                        : `${game.drops} ${t.drops}`}
                    </span>
                  </div>
                </div>
                <fieldset
                  className="grid min-w-0 grid-cols-3 gap-1"
                  disabled={disabled || invalidIds}
                  aria-describedby={`${id}-hint`}
                >
                  <legend className="sr-only">
                    {interpolate(t.preferenceFor, { name: game.name })}
                  </legend>
                  {(["neutral", "allowed", "excluded"] as const).map(
                    (state) => (
                      <label
                        key={state}
                        className={`grid min-h-9 min-w-0 cursor-pointer place-content-center break-words rounded border px-1 text-center [overflow-wrap:anywhere] text-[11px] font-semibold leading-4 focus-within:ring-2 focus-within:ring-[var(--ring)] max-sm:min-h-11 ${selected === state ? (state === "excluded" ? "border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)]" : state === "allowed" ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line-strong)] bg-[var(--surface-3)] text-[var(--ink)]") : "border-[var(--line)] text-[var(--muted-strong)]"} ${disabled || invalidIds ? "cursor-not-allowed opacity-60" : "hover:border-[var(--line-strong)]"}`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`${id}-game-${game.appId}`}
                          value={state}
                          checked={selected === state}
                          onChange={() => select(game.appId, state)}
                        />
                        {state === "neutral"
                          ? t.neutral
                          : state === "allowed"
                            ? t.allowed
                            : t.excluded}
                      </label>
                    ),
                  )}
                </fieldset>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-xs text-[var(--muted)]">
          {interpolate(t.gamesPage, {
            from: filtered.length === 0 ? 0 : currentPage * pageSize + 1,
            to: Math.min(filtered.length, (currentPage + 1) * pageSize),
            total: filtered.length,
          })}
        </p>
        {lastPage > 0 && (
          <div className="flex gap-1">
            <Button
              size="sm"
              aria-label={t.previousGames}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={15} aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              aria-label={t.nextGames}
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="whitespace-normal"
          disabled={
            disabled || invalidIds || allowedSet.size + excludedSet.size === 0
          }
          onClick={() => {
            setSelectionError(null);
            onChange({ whitelist: "", blacklist: "" });
          }}
        >
          {t.clearGameFilters}
        </Button>
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">{t.filtersOnly}</p>
    </section>
  );
}
