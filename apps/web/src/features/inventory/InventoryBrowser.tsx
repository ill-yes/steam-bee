import type { InventorySnapshot } from "@steam-bee/contracts";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { Package, ShoppingCart, X } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Label, Select } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { advancedInventoryCopy } from "./advanced-copy";
import { inventoryCopy } from "./copy";
import { variantInventoryCopy } from "./variant-copy";
import { InventoryItemCard } from "./InventoryItemCard";
import {
  allocateVariantSale,
  buildInventoryVariants,
  filterInventoryVariants,
  groupInventoryItems,
  type InventoryFilterCategory,
  type InventorySort,
  type InventoryVariant,
} from "./inventory-model";
import type { VariantPriceState } from "./inventory-prices";

export function SelectionCheckbox({
  checked,
  mixed = false,
  onChange,
  label,
  disabled = false,
  descriptionId,
}: {
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  descriptionId?: string | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed && !checked;
  }, [checked, mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      aria-describedby={descriptionId}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="h-4 w-4 shrink-0 accent-[var(--primary)]"
    />
  );
}

export function InventoryArtwork({
  src,
  game = false,
}: {
  src: string | null | undefined;
  game?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--surface-3)] ${game ? "h-8 w-16" : "h-16 w-14"}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Package
          aria-hidden="true"
          size={game ? 20 : 24}
          className="text-[var(--muted)]"
        />
      )}
    </span>
  );
}

export function InventoryBrowser({
  inventory,
  loading,
  busy,
  stale,
  salesBlocked = false,
  quantities,
  onQuantity,
  selected,
  onSelection,
  onPreview,
  onBatchPreview,
  prices = {},
  onRetryPrice,
  onVisibleVariantsChange,
  onValidityChange,
}: {
  inventory: InventorySnapshot;
  loading: boolean;
  busy: boolean;
  stale: boolean;
  salesBlocked?: boolean;
  quantities: Record<string, number>;
  onQuantity: (variantId: string, value: number) => void;
  selected: Set<string>;
  onSelection: (selection: Set<string>) => void;
  onPreview: (variant: InventoryVariant, trigger: HTMLElement) => void;
  onBatchPreview: (trigger: HTMLElement) => void;
  prices?: Record<string, VariantPriceState>;
  onRetryPrice?: (variantId: string) => void;
  onVisibleVariantsChange?: (ids: string[]) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const { locale, localeInfo } = useI18n();
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const a = advancedInventoryCopy(locale);
  const c = variantInventoryCopy(locale);
  const groupHintId = useId();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<InventoryFilterCategory>("all");
  const [game, setGame] = useState("");
  const [sort, setSort] = useState<InventorySort>("game");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [marketableOnly, setMarketableOnly] = useState(false);
  const [tradableOnly, setTradableOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selectionNotice, setSelectionNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [shortViewport, setShortViewport] = useState(
    () => window.innerHeight <= 450,
  );
  const [now, setNow] = useState(Date.now);
  const itemsRegion = useRef<HTMLDivElement>(null);
  const selectionAction = useRef<HTMLDivElement>(null);
  const filteredAction = useRef<HTMLDivElement>(null);
  const pageChangeRequested = useRef(false);
  const disabled = loading || busy || stale;
  const variants = useMemo(
    () => buildInventoryVariants(inventory.items),
    [inventory.items],
  );
  const quantityLimits = useMemo(
    () =>
      new Map(
        variants.map((variant) => [
          variant.variantId,
          variant.saleCapacity > 0
            ? allocateVariantSale(variant, variant.saleCapacity)
                .slice(0, 50)
                .reduce((total, row) => total + row.quantity, 0)
            : 0,
        ]),
      ),
    [variants],
  );
  const groups = useMemo(() => groupInventoryItems(variants), [variants]);
  const visible = useMemo(
    () =>
      filterInventoryVariants(variants, {
        search,
        category,
        game,
        sort,
        duplicatesOnly,
        marketableOnly,
        tradableOnly,
      }),
    [
      variants,
      search,
      category,
      game,
      sort,
      duplicatesOnly,
      marketableOnly,
      tradableOnly,
    ],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const pageVariants = useMemo(
    () => visible.slice(currentPage * 25, (currentPage + 1) * 25),
    [visible, currentPage],
  );
  const pageGroups = groupInventoryItems(pageVariants, {
    preserveOrder: sort !== "game",
  });
  const visibleGroups = groupInventoryItems(visible);
  const eligible = (items: InventoryVariant[]) =>
    items.filter((item) => item.saleCapacity > 0);
  const visibleIds = new Set(visible.map((item) => item.variantId));
  const hiddenSelected = [...selected].filter(
    (id) => !visibleIds.has(id),
  ).length;
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  const textQuantity = (item: InventoryVariant) =>
    drafts[item.variantId] ??
    String(Math.min(quantities[item.variantId] ?? 1, item.saleCapacity));
  const parseQuantity = (
    item: InventoryVariant,
    override?: string,
  ): number | null => {
    const text = override ?? textQuantity(item);
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    return Number.isSafeInteger(value) &&
      value >= 1 &&
      value <= item.saleCapacity
      ? value
      : null;
  };
  const summary = (ids: Set<string>, change?: { id: string; text: string }) => {
    let copies = 0,
      actions = 0,
      valid = true;
    for (const id of ids) {
      const variant = byId.get(id);
      if (!variant || variant.saleCapacity < 1) continue;
      const quantity = parseQuantity(
        variant,
        change?.id === id ? change.text : undefined,
      );
      if (quantity === null) {
        valid = false;
        continue;
      }
      copies += quantity;
      actions += allocateVariantSale(variant, quantity).length;
    }
    return { copies, actions, valid: valid && actions <= 50 };
  };
  const selectedSummary = summary(selected);
  const quantityError = (item: InventoryVariant) => {
    const quantity = parseQuantity(item);
    if (quantity === null)
      return interpolate(c.invalidQuantity, {
        max: quantityLimits.get(item.variantId) ?? item.saleCapacity,
      });
    if (
      allocateVariantSale(item, quantity).length > 50 ||
      (budgetDraft === item.variantId &&
        selected.has(item.variantId) &&
        selectedSummary.actions > 50)
    )
      return c.actionQuantityLimit;
    return null;
  };
  const clearsSelection = (items: InventoryVariant[]) => {
    const available = eligible(items);
    return (
      available.length > 0 &&
      available.every((item) => selected.has(item.variantId))
    );
  };
  const visibleCallback = useRef(onVisibleVariantsChange);
  visibleCallback.current = onVisibleVariantsChange;
  const validityCallback = useRef(onValidityChange);
  validityCallback.current = onValidityChange;
  const visibleKey = JSON.stringify(pageVariants.map((item) => item.variantId));
  useEffect(() => {
    const ids = JSON.parse(visibleKey) as string[];
    if (typeof IntersectionObserver === "undefined") {
      visibleCallback.current?.(ids);
      return () => visibleCallback.current?.([]);
    }
    const intersecting = new Set<string>();
    let published = "";
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.variantId;
          if (!id) continue;
          if (entry.isIntersecting) intersecting.add(id);
          else intersecting.delete(id);
        }
        const next = ids.filter((id) => intersecting.has(id));
        const key = JSON.stringify(next);
        if (key !== published) {
          published = key;
          visibleCallback.current?.(next);
        }
      },
      {
        root: null,
        rootMargin: `-${64 + (shortViewport ? 0 : toolbarHeight)}px 0px 0px 0px`,
        threshold: 0.01,
      },
    );
    for (const article of itemsRegion.current?.querySelectorAll(
      "article[data-variant-id]",
    ) ?? [])
      observer.observe(article);
    return () => {
      observer.disconnect();
      visibleCallback.current?.([]);
    };
  }, [visibleKey, toolbarHeight, shortViewport]);
  useEffect(
    () => validityCallback.current?.(selectedSummary.valid),
    [selectedSummary.valid],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    const element = selectionAction.current;
    if (!element) return;
    const update = () => {
      setToolbarHeight(Math.ceil(element.getBoundingClientRect().height));
      setShortViewport(window.innerHeight <= 450);
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(
    () => setPage((value) => Math.min(value, pageCount - 1)),
    [pageCount],
  );
  useEffect(() => {
    if (!pageChangeRequested.current) return;
    pageChangeRequested.current = false;
    itemsRegion.current?.focus({ preventScroll: true });
    itemsRegion.current?.scrollIntoView?.({ block: "start" });
  }, [currentPage]);
  useEffect(() => {
    const valid = new Set(
      variants
        .filter((item) => item.saleCapacity > 0)
        .map((item) => item.variantId),
    );
    const next = new Set([...selected].filter((id) => valid.has(id)));
    if (next.size !== selected.size) onSelection(next);
  }, [variants, selected, onSelection]);

  function toggleItems(items: InventoryVariant[]) {
    const ids = eligible(items).map((item) => item.variantId);
    const next = new Set(selected);
    if (clearsSelection(items)) for (const id of ids) next.delete(id);
    else for (const id of ids) next.add(id);
    const nextSummary = summary(next);
    if (nextSummary.actions > 50 && next.size > selected.size) {
      setSelectionNotice(
        interpolate(c.actionLimit, { count: nextSummary.actions }),
      );
      return;
    }
    setSelectionNotice("");
    onSelection(next);
  }
  function updateQuantity(item: InventoryVariant, text: string) {
    setDrafts((previous) => ({ ...previous, [item.variantId]: text }));
    const value = parseQuantity(item, text);
    if (value === null) return;
    const next = summary(selected, { id: item.variantId, text });
    setBudgetDraft(next.actions > 50 ? item.variantId : null);
    onQuantity(item.variantId, value);
  }
  function resetFilters() {
    setSearch("");
    setCategory("all");
    setGame("");
    setSort("game");
    setDuplicatesOnly(false);
    setMarketableOnly(false);
    setTradableOnly(false);
    setPage(0);
  }
  const chips: { key: string; name: string; clear: () => void }[] = [];
  if (search.trim())
    chips.push({
      key: "search",
      name: interpolate(c.searchFilter, { query: search.trim() }),
      clear: () => setSearch(""),
    });
  if (game)
    chips.push({
      key: "game",
      name:
        groups.find((group) => group.key === game)?.gameName ?? a.unknownGame,
      clear: () => setGame(""),
    });
  if (category !== "all")
    chips.push({
      key: "category",
      name: a[category],
      clear: () => setCategory("all"),
    });
  if (duplicatesOnly)
    chips.push({
      key: "duplicates",
      name: t.duplicates,
      clear: () => setDuplicatesOnly(false),
    });
  if (marketableOnly)
    chips.push({
      key: "marketable",
      name: t.marketable,
      clear: () => setMarketableOnly(false),
    });
  if (tradableOnly)
    chips.push({
      key: "tradable",
      name: a.tradableOnly,
      clear: () => setTradableOnly(false),
    });
  const sortName = {
    game: a.sortGame,
    name: a.sortName,
    duplicates: a.sortDuplicates,
    quantity: a.sortQuantity,
  }[sort];
  if (sort !== "game")
    chips.push({
      key: "sort",
      name: interpolate(c.sortFilter, { name: sortName }),
      clear: () => setSort("game"),
    });
  const blockedReason = stale
    ? c.stockStale
    : loading
      ? c.stockLoading
      : busy
        ? c.actionBusy
        : salesBlocked
          ? c.rulesBlocked
          : null;
  const contextTop = shortViewport
    ? "4.5rem"
    : "calc(4rem + var(--inventory-toolbar-height) + .5rem)";

  return (
    <div
      className="@container/inventory grid min-w-0 gap-3"
      style={
        { "--inventory-toolbar-height": `${toolbarHeight}px` } as CSSProperties
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{interpolate(c.variants, { count: variants.length })}</Badge>
        <Badge>
          {interpolate(c.copies, { count: inventory.totalQuantity })}
        </Badge>
        <Badge tone={inventory.duplicateQuantity > 0 ? "info" : "neutral"}>
          {interpolate(c.additional, { count: inventory.duplicateQuantity })}
        </Badge>
        <time
          dateTime={new Date(inventory.fetchedAt).toISOString()}
          className="text-xs text-[var(--muted)] sm:ms-auto"
          title={t.inventorySnapshot}
        >
          {new Intl.DateTimeFormat(localeInfo.dateLocale, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(inventory.fetchedAt)}
        </time>
      </div>
      <Label>
        {t.search}
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </Label>
      <details className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3">
        <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[var(--muted-strong)]">
          {a.filters}
          {chips.length > 0 && (
            <span className="ms-2 text-[var(--accent-ink)]">
              {interpolate(a.activeFilters, { count: chips.length })}
            </span>
          )}
        </summary>
        <div className="grid min-w-0 gap-3 pb-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <Label>
              {a.game}
              <Select
                value={game}
                onChange={(event) => {
                  setGame(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">{a.allGames}</option>
                {groups.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.gameName ?? a.unknownGame}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              {a.category}
              <Select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as InventoryFilterCategory);
                  setPage(0);
                }}
              >
                {(
                  [
                    "all",
                    "card",
                    "foil",
                    "background",
                    "emoticon",
                    "booster",
                    "sale",
                    "other",
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {value === "all" ? a.allTypes : a[value]}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              {a.sort}
              <Select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as InventorySort);
                  setPage(0);
                }}
              >
                {(["game", "name", "duplicates", "quantity"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {
                        {
                          game: a.sortGame,
                          name: a.sortName,
                          duplicates: a.sortDuplicates,
                          quantity: a.sortQuantity,
                        }[value]
                      }
                    </option>
                  ),
                )}
              </Select>
            </Label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {[
              [t.duplicates, duplicatesOnly, setDuplicatesOnly],
              [t.marketable, marketableOnly, setMarketableOnly],
              [a.tradableOnly, tradableOnly, setTradableOnly],
            ].map(([label, checked, setter]) => (
              <label
                key={String(label)}
                className="flex min-h-11 items-center gap-2"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--primary)]"
                  checked={checked as boolean}
                  onChange={(event) => {
                    (setter as (value: boolean) => void)(event.target.checked);
                    setPage(0);
                  }}
                />
                {label as string}
              </label>
            ))}
          </div>
          {chips.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="justify-self-start"
              onClick={resetFilters}
            >
              {a.resetFilters}
            </Button>
          )}
        </div>
      </details>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              size="sm"
              variant="outline"
              className="max-w-full whitespace-normal text-left"
              aria-label={interpolate(c.filterRemove, { name: chip.name })}
              onClick={() => {
                chip.clear();
                setPage(0);
              }}
            >
              <span className="break-words">{chip.name}</span>
              <X size={13} aria-hidden="true" className="shrink-0" />
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs leading-5 text-[var(--muted)]">{c.estimateHelp}</p>
      <div ref={filteredAction} className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || eligible(visible).length === 0}
          onClick={() => toggleItems(visible)}
        >
          {clearsSelection(visible) ? c.clearFiltered : c.selectFiltered}
        </Button>
        <p className="text-xs leading-5 text-[var(--muted)]">{c.keepOne}</p>
      </div>
      <div
        ref={selectionAction}
        className={`${shortViewport ? "" : "sticky top-16"} z-20 grid min-w-0 gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] p-2 shadow-sm`}
      >
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          aria-live="polite"
        >
          <strong>
            {interpolate(c.selectionVariants, { count: selected.size })}
          </strong>
          {selected.size > 0 && (
            <>
              <span>
                {interpolate(c.selectionCopies, {
                  count: selectedSummary.valid ? selectedSummary.copies : "—",
                })}
              </span>
              <span>
                {interpolate(c.selectionActions, {
                  count: selectedSummary.valid ? selectedSummary.actions : "—",
                })}
              </span>
            </>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <>
              <Button
                size="sm"
                disabled={disabled || salesBlocked || !selectedSummary.valid}
                aria-label={a.previewBatch}
                onClick={(event) => {
                  if (summary(selected).valid)
                    onBatchPreview(event.currentTarget);
                }}
              >
                <ShoppingCart size={14} aria-hidden="true" />
                {c.previewSelected}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onSelection(new Set());
                  setSelectionNotice("");
                  window.requestAnimationFrame(() =>
                    filteredAction.current?.querySelector("button")?.focus(),
                  );
                }}
              >
                {a.clearSelection}
              </Button>
            </>
          </div>
        )}
        {hiddenSelected > 0 && (
          <p role="status" className="text-xs text-[var(--warn)]">
            {interpolate(c.hiddenSelection, { count: hiddenSelected })}
          </p>
        )}
        {selectionNotice && (
          <p role="status" className="text-xs leading-5 text-[var(--warn)]">
            {selectionNotice}
          </p>
        )}
      </div>
      <div
        ref={itemsRegion}
        role="region"
        aria-label={t.inventoryItems}
        tabIndex={-1}
        aria-busy={loading}
        className="grid min-w-0 items-start gap-3 outline-none"
        style={{ scrollMarginTop: contextTop }}
      >
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--muted)]">
            {variants.length ? t.noMatches : t.noItems}
          </p>
        ) : (
          pageGroups.map((group, groupIndex) => {
            const all = visibleGroups.find((entry) => entry.key === group.key)!;
            const full = groups.find((entry) => entry.key === group.key)!;
            const selectable = eligible(all.items);
            const selectedCount = selectable.filter((item) =>
              selected.has(item.variantId),
            ).length;
            const name = group.gameName ?? a.unknownGame;
            const fragmented = group.items.length < all.items.length;
            const hintId = `${groupHintId}-scope-${groupIndex}`;
            const gameArt =
              group.gameIconUrl ??
              (group.gameAppId
                ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${group.gameAppId}/header.jpg`
                : null);
            return (
              <section
                key={group.key}
                className="grid min-w-0 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] @min-[38rem]/inventory:grid-cols-[160px_minmax(0,1fr)]"
                aria-label={name}
              >
                <header
                  className={`${shortViewport ? "" : "sticky"} z-10 grid min-w-0 gap-2 self-start rounded-t-lg border-b border-[var(--line)] bg-[var(--surface-2)] p-2 @min-[38rem]/inventory:rounded-l-lg @min-[38rem]/inventory:rounded-tr-none @min-[38rem]/inventory:border-b-0`}
                  style={{ top: contextTop }}
                >
                  <div className="flex min-w-0 items-start gap-2 @min-[38rem]/inventory:flex-col">
                    <InventoryArtwork
                      key={gameArt ?? "unknown"}
                      src={gameArt}
                      game
                    />
                    <div className="min-w-0">
                      <h4 className="break-words text-sm font-semibold">
                        {name}
                      </h4>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {interpolate(c.group, {
                          variants: full.items.length,
                          copies: full.totalQuantity,
                          extra: full.duplicateQuantity,
                        })}
                      </p>
                      {all.items.length !== full.items.length && (
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          {interpolate(c.groupMatches, {
                            matching: all.items.length,
                            total: full.items.length,
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs">
                    <SelectionCheckbox
                      descriptionId={fragmented ? hintId : undefined}
                      label={interpolate(
                        clearsSelection(all.items) ? a.clearGame : a.selectGame,
                        { name },
                      )}
                      checked={
                        selectable.length > 0 &&
                        selectedCount === selectable.length
                      }
                      mixed={selectedCount > 0}
                      disabled={disabled || selectable.length === 0}
                      onChange={() => toggleItems(all.items)}
                    />
                    <span>
                      {clearsSelection(all.items) ? c.clearGame : c.selectGame}
                    </span>
                  </label>
                  {fragmented && (
                    <p
                      id={hintId}
                      className="text-xs leading-5 text-[var(--muted)]"
                    >
                      {interpolate(a.groupPageItems, {
                        shown: group.items.length,
                        total: all.items.length,
                      })}{" "}
                      {a.groupSelectionScope}
                    </p>
                  )}
                </header>
                <div className="min-w-0 p-2 @min-[38rem]/inventory:border-s @min-[38rem]/inventory:border-[var(--line)]">
                  <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,264px),1fr))] items-stretch gap-2">
                    {group.items.map((item) => {
                      const error =
                        item.saleCapacity > 0 ? quantityError(item) : null;
                      const quantity =
                        item.saleCapacity > 0 ? parseQuantity(item) : null;
                      return (
                        <InventoryItemCard
                          key={item.variantId}
                          item={item}
                          artwork={
                            <InventoryArtwork
                              key={item.iconUrl ?? "fallback"}
                              src={item.iconUrl}
                            />
                          }
                          selection={
                            <SelectionCheckbox
                              checked={selected.has(item.variantId)}
                              disabled={disabled || item.saleCapacity < 1}
                              label={interpolate(a.select, { name: item.name })}
                              onChange={() => toggleItems([item])}
                            />
                          }
                          selected={selected.has(item.variantId)}
                          quantity={error ? null : quantity}
                          quantityText={textQuantity(item)}
                          maxQuantity={
                            quantityLimits.get(item.variantId) ??
                            item.saleCapacity
                          }
                          quantityError={error}
                          disabled={disabled}
                          salesBlocked={salesBlocked}
                          blockedReason={blockedReason}
                          price={prices[item.variantId]}
                          now={now}
                          onQuantity={(value) => updateQuantity(item, value)}
                          onRetryPrice={
                            onRetryPrice
                              ? () => onRetryPrice(item.variantId)
                              : undefined
                          }
                          onPreview={(trigger) => {
                            if (
                              quantity !== null &&
                              !error &&
                              allocateVariantSale(item, quantity).length <= 50
                            )
                              onPreview(item, trigger);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
      {visible.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--muted)]" aria-live="polite">
            {interpolate(c.page, {
              from: currentPage * 25 + 1,
              to: Math.min((currentPage + 1) * 25, visible.length),
              total: visible.length,
            })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage === 0}
              onClick={() => {
                pageChangeRequested.current = true;
                setPage(currentPage - 1);
              }}
            >
              {t.previous}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage >= pageCount - 1}
              onClick={() => {
                pageChangeRequested.current = true;
                setPage(currentPage + 1);
              }}
            >
              {t.next}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
