import type { MarketListings, MarketListing } from "@steam-bee/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { Clock3 } from "lucide-react";
import { interpolate, useI18n } from "../../i18n";
import { advancedInventoryCopy } from "./advanced-copy";
import { inventoryCopy } from "./copy";
import { SelectionCheckbox } from "./inventory-ui";

export function MarketListingsPanel({
  market,
  loading,
  busy,
  stale,
  onPreview,
  onBatchPreview,
  onRefresh,
}: {
  market: MarketListings;
  loading: boolean;
  busy: boolean;
  stale: boolean;
  onPreview: (listing: MarketListing, trigger: HTMLElement) => void;
  onBatchPreview: (ids: string[], trigger: HTMLElement) => void;
  /** Re-reads the listings, e.g. right after confirming in Steam. */
  onRefresh?: () => void;
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
    (filtered.every((listing) => validSelection.includes(listing.listingId)) ||
      (validSelection.length >= 50 &&
        filtered.some((listing) =>
          validSelection.includes(listing.listingId),
        )));
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
  // Unconfirmed listings are not on the market yet and expire if never confirmed.
  const totalReceive = market.listings.reduce(
    (sum, listing) =>
      listing.pendingConfirmation
        ? sum
        : sum + listing.sellerReceives * listing.quantity,
    0,
  );
  const pageListings = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  const statusFilters = [
    { id: "all", label: a.allListings, count: market.listings.length },
    {
      id: "active",
      label: a.active,
      count: market.listings.length - pendingCount,
    },
    { id: "pending", label: a.confirmInSteam, count: pendingCount },
  ];
  return (
    <div className="grid min-w-0 gap-3" aria-busy={loading}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-medium">
          {interpolate(a.listingsSummary, {
            count: market.listings.length,
            amount: money(totalReceive),
          })}
        </p>
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
      {pendingCount > 0 && (
        <div
          role="status"
          className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] p-3 text-[var(--warn)]"
        >
          <Clock3 size={18} aria-hidden="true" className="shrink-0" />
          <div className="min-w-0 flex-[1_1_260px]">
            <p className="text-sm font-semibold">
              {pendingCount === 1
                ? a.pendingBannerTitleOne
                : interpolate(a.pendingBannerTitle, { count: pendingCount })}
            </p>
            <p className="text-xs leading-5">{a.pendingBannerBody}</p>
          </div>
          {onRefresh && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading || busy}
              onClick={onRefresh}
            >
              {a.checkNow}
            </Button>
          )}
        </div>
      )}
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--line)] p-3">
          <Label className="min-w-0 flex-[1_1_220px]">
            <span className="sr-only">{a.searchListings}</span>
            <Input
              type="search"
              placeholder={a.searchListings}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </Label>
          <div
            role="group"
            aria-label={a.listingFilters}
            className="flex flex-wrap gap-1"
          >
            {statusFilters.map((filter) => (
              <Button
                key={filter.id}
                size="sm"
                variant={status === filter.id ? "primary" : "ghost"}
                aria-pressed={status === filter.id}
                onClick={() => {
                  setStatus(filter.id);
                  setPage(0);
                }}
              >
                {filter.label}{" "}
                <span className="tabular-nums opacity-70">{filter.count}</span>
              </Button>
            ))}
          </div>
        </div>
        {market.listings.length > 0 && (
          <div
            ref={selectionAction}
            className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2"
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || filtered.length === 0}
              onClick={() =>
                toggle(filtered.map((listing) => listing.listingId))
              }
            >
              {clearsFiltered ? a.clearFilteredListings : a.selectedListings}
            </Button>
            <span className="text-xs text-[var(--muted)]" aria-live="polite">
              {interpolate(a.selected, { count: validSelection.length })}
            </span>
            {validSelection.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
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
                  variant="danger"
                  className="ms-auto"
                  disabled={disabled}
                  onClick={(event) =>
                    onBatchPreview(validSelection, event.currentTarget)
                  }
                >
                  {a.batchCancel}
                </Button>
              </>
            )}
            {validSelection.length > 0 && limitNotice && (
              <p
                role="status"
                className="basis-full text-xs text-[var(--warn)]"
              >
                {limitNotice}
              </p>
            )}
            {hiddenSelected > 0 && (
              <p
                role="status"
                className="basis-full text-xs text-[var(--warn)]"
              >
                {interpolate(a.hiddenSelection, { count: hiddenSelected })}
              </p>
            )}
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">
            {market.listings.length ? t.noMatches : t.noListings}
          </p>
        ) : (
          <div
            ref={listStart}
            role="group"
            aria-label={t.listings}
            tabIndex={-1}
            className="min-w-0 scroll-mt-24 overflow-x-auto outline-none"
          >
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <caption className="sr-only">{t.listings}</caption>
              <thead>
                <tr className="text-start text-xs text-[var(--muted)]">
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">{a.selectedListings}</span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {a.listingItem}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold">
                    {a.listingBuyerPays}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold">
                    {a.listingYouReceive}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {a.listingStatusColumn}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t.cancelListing}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageListings.map((listing) => {
                  const checked = validSelection.includes(listing.listingId);
                  return (
                    <tr
                      key={listing.listingId}
                      className={`border-t border-[var(--line)] ${checked ? "bg-[var(--surface-2)]" : ""}`}
                    >
                      <td className="px-3 py-1.5">
                        <label className="grid h-8 w-8 cursor-pointer place-items-center rounded-md max-sm:h-11 max-sm:w-11">
                          <SelectionCheckbox
                            checked={checked}
                            disabled={disabled}
                            label={interpolate(a.select, {
                              name: listing.name,
                            })}
                            onChange={() => toggle([listing.listingId])}
                          />
                        </label>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {listing.iconUrl ? (
                            <img
                              src={listing.iconUrl}
                              alt=""
                              loading="lazy"
                              className="h-10 w-10 shrink-0 rounded object-contain"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="h-10 w-10 shrink-0 rounded bg-[var(--surface-2)]"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="break-words font-semibold">
                              {listing.name}
                              {listing.quantity > 1 && (
                                <span className="ms-1 text-xs font-normal text-[var(--muted)]">
                                  × {listing.quantity}
                                </span>
                              )}
                            </p>
                            {listing.type && (
                              <p className="truncate text-xs text-[var(--muted)]">
                                {listing.type}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-end tabular-nums text-[var(--muted-strong)]">
                        {money(listing.buyerPays)}
                      </td>
                      <td className="px-3 py-1.5 text-end font-semibold tabular-nums">
                        <span className="sr-only">{t.receivePerItem}: </span>
                        {money(listing.sellerReceives)}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge
                          tone={listing.pendingConfirmation ? "warn" : "good"}
                        >
                          {listing.pendingConfirmation ? t.pending : a.active}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[var(--danger)]"
                          disabled={disabled}
                          onClick={(event) =>
                            onPreview(listing, event.currentTarget)
                          }
                          aria-label={`${t.cancelListing}: ${listing.name}`}
                        >
                          {a.withdraw}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
