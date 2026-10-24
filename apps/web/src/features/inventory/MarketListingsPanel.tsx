import type { MarketListings, MarketListing } from "@steam-bee/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Label, Select } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { advancedInventoryCopy } from "./advanced-copy";
import { inventoryCopy } from "./copy";
import { SelectionCheckbox } from "./InventoryBrowser";

export function MarketListingsPanel({
  market,
  loading,
  busy,
  stale,
  onPreview,
  onBatchPreview,
}: {
  market: MarketListings;
  loading: boolean;
  busy: boolean;
  stale: boolean;
  onPreview: (listing: MarketListing, trigger: HTMLElement) => void;
  onBatchPreview: (ids: string[], trigger: HTMLElement) => void;
}) {
  const { locale, localeInfo } = useI18n();
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const a = advancedInventoryCopy(locale);
  const pendingCount = market.listings.filter(
    (listing) => listing.pendingConfirmation,
  ).length;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set<string>());
  const [limitNotice, setLimitNotice] = useState("");
  const selectionAction = useRef<HTMLDivElement>(null);
  const listStart = useRef<HTMLDivElement>(null);
  const pageChangeRequested = useRef(false);
  const disabled = busy || loading || stale;
  const filtered = useMemo(
    () =>
      market.listings.filter(
        (listing) =>
          listing.name
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()) &&
          (status === "all" ||
            (status === "pending"
              ? listing.pendingConfirmation
              : !listing.pendingConfirmation)),
      ),
    [market.listings, query, status],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const validSelection = [...selected].filter((id) =>
    market.listings.some((listing) => listing.listingId === id),
  );
  const filteredIds = new Set(filtered.map((listing) => listing.listingId));
  const hiddenSelected = validSelection.filter(
    (id) => !filteredIds.has(id),
  ).length;
  const clearsFiltered =
    filtered.length > 0 &&
    (filtered.every((listing) => selected.has(listing.listingId)) ||
      (validSelection.length >= 50 &&
        filtered.some((listing) => selected.has(listing.listingId))));
  useEffect(() => {
    setPage((value) => Math.min(value, pageCount - 1));
  }, [pageCount]);
  useEffect(() => {
    if (!pageChangeRequested.current) return;
    pageChangeRequested.current = false;
    listStart.current?.focus({ preventScroll: true });
    listStart.current?.scrollIntoView?.({ block: "start" });
  }, [currentPage]);
  useEffect(() => {
    const ids = new Set(market.listings.map((listing) => listing.listingId));
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => ids.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [market.listings]);
  const money = (value: number) =>
    market.currency
      ? new Intl.NumberFormat(localeInfo.dateLocale, {
          style: "currency",
          currency: market.currency.code,
          minimumFractionDigits: market.currency.minorUnit,
          maximumFractionDigits: market.currency.minorUnit,
        }).format(value / 10 ** market.currency.minorUnit)
      : t.unavailableCurrency;
  function toggle(ids: string[]) {
    const next = new Set(validSelection);
    if (
      ids.every((id) => next.has(id)) ||
      (next.size >= 50 && ids.some((id) => next.has(id)))
    )
      for (const id of ids) next.delete(id);
    else for (const id of ids) if (next.size < 50 || next.has(id)) next.add(id);
    setLimitNotice(
      ids.some((id) => !next.has(id)) && next.size === 50 ? a.batchLimit : "",
    );
    setSelected(next);
  }
  function changePage(next: number) {
    if (next === currentPage || next < 0 || next >= pageCount) return;
    pageChangeRequested.current = true;
    setPage(next);
  }
  return (
    <div className="grid min-w-0 gap-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>
          {interpolate(a.marketCount, { count: market.listings.length })}
        </Badge>
        {pendingCount > 0 && (
          <Badge tone="warn">
            {interpolate(a.marketPendingCount, { count: pendingCount })}
          </Badge>
        )}
        <time
          dateTime={new Date(market.fetchedAt).toISOString()}
          title={t.marketSnapshot}
          className="text-xs text-[var(--muted)] sm:ms-auto"
        >
          {new Intl.DateTimeFormat(localeInfo.dateLocale, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(market.fetchedAt)}
        </time>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label>
          {a.searchListings}
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </Label>
        <Label>
          {a.listingStatus}
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">{a.allListings}</option>
            <option value="active">{a.active}</option>
            <option value="pending">{a.pendingOnly}</option>
          </Select>
        </Label>
      </div>
      {market.listings.length > 0 && (
        <div
          ref={selectionAction}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs" aria-live="polite">
            {interpolate(a.selected, { count: validSelection.length })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || filtered.length === 0}
            onClick={() => toggle(filtered.map((listing) => listing.listingId))}
          >
            {clearsFiltered ? a.clearFilteredListings : a.selectedListings}
          </Button>
          {validSelection.length > 0 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || validSelection.length === 0}
                onClick={() => {
                  setSelected(new Set());
                  setLimitNotice("");
                  window.requestAnimationFrame(() =>
                    selectionAction.current?.querySelector("button")?.focus(),
                  );
                }}
              >
                {a.clearSelection}
              </Button>
              <Button
                size="sm"
                disabled={disabled || validSelection.length === 0}
                onClick={(event) =>
                  onBatchPreview(validSelection, event.currentTarget)
                }
              >
                {a.batchCancel}
              </Button>
            </>
          )}
          {validSelection.length > 0 && limitNotice && (
            <p role="status" className="basis-full text-xs text-[var(--warn)]">
              {limitNotice}
            </p>
          )}
          {hiddenSelected > 0 && (
            <p role="status" className="basis-full text-xs text-[var(--warn)]">
              {interpolate(a.hiddenSelection, { count: hiddenSelected })}
            </p>
          )}
        </div>
      )}
      {filtered.length === 0 && (
        <p className="text-sm text-[var(--muted)]">
          {market.listings.length ? t.noMatches : t.noListings}
        </p>
      )}
      <div
        ref={listStart}
        role="group"
        aria-label={t.listings}
        tabIndex={-1}
        className="grid min-w-0 scroll-mt-24 gap-2 outline-none"
      >
        {filtered
          .slice(currentPage * 25, (currentPage + 1) * 25)
          .map((listing) => (
            <article
              key={listing.listingId}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-md border border-[var(--line)] p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            >
              <label className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md max-sm:h-11 max-sm:w-11">
                <SelectionCheckbox
                  checked={validSelection.includes(listing.listingId)}
                  disabled={disabled}
                  label={interpolate(a.select, { name: listing.name })}
                  onChange={() => toggle([listing.listingId])}
                />
              </label>
              <div className="min-w-0 flex-1">
                <h4 className="break-words text-sm font-semibold">
                  {listing.name}
                </h4>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {t.quantity}: {listing.quantity} · {t.receivePerItem}:{" "}
                  {money(listing.sellerReceives)}
                </p>
                <Badge
                  tone={listing.pendingConfirmation ? "warn" : "neutral"}
                  className="mt-2"
                >
                  {listing.pendingConfirmation ? t.pending : a.active}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="col-span-2 w-full sm:col-span-1 sm:w-auto"
                disabled={disabled}
                onClick={(event) => onPreview(listing, event.currentTarget)}
                aria-label={`${t.cancelListing}: ${listing.name}`}
              >
                {t.cancelListing}
              </Button>
            </article>
          ))}
      </div>
      {filtered.length > 25 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--muted)]">
            {interpolate(t.pageStatus, {
              from: currentPage * 25 + 1,
              to: Math.min((currentPage + 1) * 25, filtered.length),
              total: filtered.length,
            })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage === 0}
              onClick={() => changePage(currentPage - 1)}
            >
              {t.previous}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage >= pageCount - 1}
              onClick={() => changePage(currentPage + 1)}
            >
              {t.next}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
