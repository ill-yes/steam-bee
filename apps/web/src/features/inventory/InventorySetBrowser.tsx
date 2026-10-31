import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import type { CardSet, CardSetCard } from "@steam-bee/contracts";
import { Button } from "../../components/ui/button";
import { Input, Label, Select } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { advancedInventoryCopy } from "./advanced-copy";
import { inventoryCopy } from "./copy";
import {
  filterInventoryVariants,
  groupInventoryItems,
  inventoryCategory,
  type InventoryGameGroup,
  type InventoryVariant,
} from "./inventory-model";
import type { VariantPriceState } from "./inventory-prices";
import { formatMoney, InventoryArtwork } from "./inventory-ui";
import { setInventoryCopy } from "./set-copy";
import type { SellBasket } from "./sell-basket";
import { useCardSets, type CardSetState } from "./useCardSets";

type Chip = "all" | "card" | "foil" | "background" | "emoticon" | "other";
type GameSort = "name" | "extras";
type Slot =
  | { kind: "item"; variant: InventoryVariant }
  | { kind: "missing"; card: CardSetCard };

const GAMES_PER_PAGE = 10;

/** Matches inventory names like "Zote (Trading Card)" to the badge page's "Zote". */
export function cardNameKey(name: string) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(
      /\s*\((?:foil\s*)?(?:trading\s*card|foil|sammelkarte|glanzsammelkarte)\)\s*$/,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function chipOf(variant: InventoryVariant): Exclude<Chip, "all"> {
  const category = inventoryCategory(variant);
  return category === "card" ||
    category === "foil" ||
    category === "background" ||
    category === "emoticon"
    ? category
    : "other";
}

/** Owned cards in set order, missing cards as gaps, unmatched owned cards last. */
export function setSlots(
  cards: readonly InventoryVariant[],
  set: CardSet | null,
  showMissing: boolean,
): Slot[] {
  if (!set) return cards.map((variant) => ({ kind: "item", variant }));
  const byName = new Map<string, InventoryVariant[]>();
  for (const variant of cards) {
    const key = cardNameKey(variant.name);
    byName.set(key, [...(byName.get(key) ?? []), variant]);
  }
  const slots: Slot[] = [];
  for (const card of set.cards) {
    const key = cardNameKey(card.name);
    const owned = byName.get(key);
    if (owned?.length) {
      for (const variant of owned) slots.push({ kind: "item", variant });
      byName.delete(key);
    } else if (showMissing && card.owned === 0) {
      slots.push({ kind: "missing", card });
    }
  }
  for (const rest of byName.values())
    for (const variant of rest) slots.push({ kind: "item", variant });
  return slots;
}

export function InventorySetBrowser({
  accountId,
  variants,
  basket,
  prices,
  disabled,
  now,
  onToggle,
  onAddGame,
  onRemoveGame,
  onVisibleVariantsChange,
}: {
  accountId: string;
  variants: InventoryVariant[];
  basket: SellBasket;
  prices: Record<string, VariantPriceState>;
  disabled: boolean;
  now: number;
  onToggle: (variant: InventoryVariant) => void;
  onAddGame: (variants: InventoryVariant[]) => void;
  onRemoveGame: (variants: InventoryVariant[]) => void;
  onVisibleVariantsChange?: ((ids: string[]) => void) | undefined;
}) {
  const { locale } = useI18n();
  const s = setInventoryCopy(locale);
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [sort, setSort] = useState<GameSort>("name");
  const [page, setPage] = useState(0);
  const region = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () =>
      filterInventoryVariants(variants, { search, duplicatesOnly }).filter(
        (variant) => chip === "all" || chipOf(variant) === chip,
      ),
    [variants, search, duplicatesOnly, chip],
  );
  const groups = useMemo(() => {
    const grouped = groupInventoryItems(visible);
    if (sort === "extras")
      grouped.sort(
        (left, right) => right.duplicateQuantity - left.duplicateQuantity,
      );
    return grouped;
  }, [visible, sort]);
  const pageCount = Math.max(1, Math.ceil(groups.length / GAMES_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageGroups = groups.slice(
    currentPage * GAMES_PER_PAGE,
    (currentPage + 1) * GAMES_PER_PAGE,
  );
  const setIds = pageGroups
    .filter(
      (group) =>
        group.gameAppId !== null &&
        group.items.some((item) => chipOf(item) === "card"),
    )
    .map((group) => group.gameAppId!);
  const cardSets = useCardSets(accountId, setIds);
  const showMissing =
    !search.trim() && !duplicatesOnly && (chip === "all" || chip === "card");

  useEffect(() => setPage(0), [search, chip, duplicatesOnly, sort]);

  const visibleCallback = useRef(onVisibleVariantsChange);
  visibleCallback.current = onVisibleVariantsChange;
  const visibleKey = pageGroups
    .flatMap((group) => group.items.map((item) => item.variantId))
    .join("\n");
  useEffect(() => {
    const ids = visibleKey ? visibleKey.split("\n") : [];
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
        const key = next.join("\n");
        if (key !== published) {
          published = key;
          visibleCallback.current?.(next);
        }
      },
      { root: null, threshold: 0.01 },
    );
    for (const tile of region.current?.querySelectorAll("[data-variant-id]") ??
      [])
      observer.observe(tile);
    return () => {
      observer.disconnect();
      visibleCallback.current?.([]);
    };
  }, [visibleKey]);

  const chips: { id: Chip; label: string }[] = [
    { id: "all", label: s.all },
    { id: "card", label: s.cards },
    { id: "foil", label: s.foil },
    { id: "background", label: s.backgrounds },
    { id: "emoticon", label: s.emoticons },
    { id: "other", label: s.other },
  ];

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-[12rem] flex-1 gap-1">
            <Label htmlFor={`${accountId}-inventory-search`}>{t.search}</Label>
            <div className="relative">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute inset-s-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
              />
              <Input
                id={`${accountId}-inventory-search`}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="ps-8"
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${accountId}-inventory-sort`}>{s.sortLabel}</Label>
            <Select
              id={`${accountId}-inventory-sort`}
              value={sort}
              onChange={(event) => setSort(event.target.value as GameSort)}
            >
              <option value="name">{s.sortName}</option>
              <option value="extras">{s.sortExtras}</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label={s.filterLabel}
            className="flex flex-wrap gap-1.5"
          >
            {chips.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={chip === item.id}
                onClick={() => setChip(item.id)}
                className={cn(
                  "min-h-8 rounded-full border px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  chip === item.id
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]"
                    : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-[var(--surface-2)]",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="ms-auto flex min-h-8 items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={duplicatesOnly}
              onChange={(event) => setDuplicatesOnly(event.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {s.duplicatesOnly}
          </label>
        </div>
      </div>

      <div ref={region} className="grid min-w-0 gap-3">
        {pageGroups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            {variants.length ? t.noMatches : t.noItems}
          </p>
        ) : (
          pageGroups.map((group) => (
            <GameSet
              key={group.key}
              group={group}
              state={
                group.gameAppId === null
                  ? undefined
                  : cardSets.sets[group.gameAppId]
              }
              onRetry={() =>
                group.gameAppId !== null && cardSets.retry(group.gameAppId)
              }
              showMissing={showMissing}
              basket={basket}
              prices={prices}
              disabled={disabled}
              now={now}
              onToggle={onToggle}
              onAddGame={onAddGame}
              onRemoveGame={onRemoveGame}
            />
          ))
        )}
      </div>

      {pageCount > 1 && (
        <nav
          aria-label={s.gamePages}
          className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]"
        >
          <span aria-live="polite">
            {interpolate(s.gamesPage, {
              from: currentPage * GAMES_PER_PAGE + 1,
              to: Math.min(groups.length, (currentPage + 1) * GAMES_PER_PAGE),
              total: groups.length,
            })}
          </span>
          <span className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              aria-label={t.previous}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={t.next}
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </span>
        </nav>
      )}
    </div>
  );
}

function GameSet({
  group,
  state,
  onRetry,
  showMissing,
  basket,
  prices,
  disabled,
  now,
  onToggle,
  onAddGame,
  onRemoveGame,
}: {
  group: InventoryGameGroup<InventoryVariant>;
  state: CardSetState | undefined;
  onRetry: () => void;
  showMissing: boolean;
  basket: SellBasket;
  prices: Record<string, VariantPriceState>;
  disabled: boolean;
  now: number;
  onToggle: (variant: InventoryVariant) => void;
  onAddGame: (variants: InventoryVariant[]) => void;
  onRemoveGame: (variants: InventoryVariant[]) => void;
}) {
  const { locale } = useI18n();
  const s = setInventoryCopy(locale);
  const a = advancedInventoryCopy(locale);
  const name = group.gameName ?? a.unknownGame;
  const cards = group.items.filter((item) => chipOf(item) === "card");
  const foils = group.items.filter((item) => chipOf(item) === "foil");
  const others = group.items.filter(
    (item) => chipOf(item) !== "card" && chipOf(item) !== "foil",
  );
  const set = state?.status === "ready" ? state.set : null;
  const total = set?.cards.length ?? 0;
  const owned = set
    ? set.cards.filter(
        (card) =>
          card.owned > 0 ||
          cards.some(
            (variant) => cardNameKey(variant.name) === cardNameKey(card.name),
          ),
      ).length
    : 0;
  const sellable = group.items.filter((item) => item.saleCapacity > 0);
  const allInBasket =
    sellable.length > 0 && sellable.every((item) => basket[item.variantId]);
  const copies = group.items.reduce((sum, item) => sum + item.quantity, 0);
  const extras = group.items.reduce((sum, item) => sum + item.saleCapacity, 0);

  return (
    <article
      aria-label={name}
      className="min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-3">
        <InventoryArtwork src={group.gameIconUrl} game />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-bold">{name}</h4>
          <p className="text-xs text-[var(--muted)]">
            {interpolate(s.copies, { copies, extra: extras })}
          </p>
        </div>
        {cards.length > 0 && (
          <div className="grid min-w-[10rem] gap-1 text-xs">
            {state?.status === "loading" ? (
              <span role="status" className="text-[var(--muted)]">
                {s.setLoading}
              </span>
            ) : state?.status === "error" ? (
              <span className="flex items-center gap-2 text-[var(--warn)]">
                {s.setFailed}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={onRetry}
                >
                  {s.retrySet}
                </button>
              </span>
            ) : set ? (
              <>
                <span className="flex flex-wrap gap-x-2 font-semibold">
                  <span>{interpolate(s.setProgress, { owned, total })}</span>
                  {set.badgeLevel > 0 && (
                    <span className="text-[var(--muted)]">
                      {interpolate(s.badgeLevel, { level: set.badgeLevel })}
                    </span>
                  )}
                  {set.remainingDrops !== null && (
                    <span className="text-[var(--info)]">
                      {set.remainingDrops > 0
                        ? interpolate(s.dropsLeft, {
                            count: set.remainingDrops,
                          })
                        : s.noDrops}
                    </span>
                  )}
                </span>
                <progress
                  max={Math.max(total, 1)}
                  value={owned}
                  aria-label={interpolate(s.setProgress, { owned, total })}
                  className="h-1.5 w-full overflow-hidden rounded-full accent-[var(--primary)]"
                />
              </>
            ) : null}
          </div>
        )}
        {sellable.length > 0 && (
          <Button
            size="sm"
            variant={allInBasket ? "ghost" : "outline"}
            disabled={disabled}
            onClick={() =>
              allInBasket ? onRemoveGame(sellable) : onAddGame(sellable)
            }
          >
            {allInBasket ? s.removeExtras : s.addExtras}
          </Button>
        )}
      </header>
      <div className="grid gap-3 p-3">
        {(cards.length > 0 || (set && showMissing)) && (
          <TileRow
            gameName={name}
            label={s.setRow}
            slots={setSlots(cards, set, showMissing)}
            basket={basket}
            prices={prices}
            disabled={disabled}
            now={now}
            onToggle={onToggle}
          />
        )}
        {foils.length > 0 && (
          <TileRow
            gameName={name}
            label={s.foilRow}
            slots={foils.map((variant) => ({ kind: "item", variant }))}
            basket={basket}
            prices={prices}
            disabled={disabled}
            now={now}
            onToggle={onToggle}
          />
        )}
        {others.length > 0 && (
          <TileRow
            gameName={name}
            label={s.otherRow}
            compact
            slots={others.map((variant) => ({ kind: "item", variant }))}
            basket={basket}
            prices={prices}
            disabled={disabled}
            now={now}
            onToggle={onToggle}
          />
        )}
      </div>
    </article>
  );
}

function TileRow({
  gameName,
  label,
  compact = false,
  slots,
  basket,
  prices,
  disabled,
  now,
  onToggle,
}: {
  gameName: string;
  label: string;
  compact?: boolean;
  slots: Slot[];
  basket: SellBasket;
  prices: Record<string, VariantPriceState>;
  disabled: boolean;
  now: number;
  onToggle: (variant: InventoryVariant) => void;
}) {
  const { locale, localeInfo } = useI18n();
  const s = setInventoryCopy(locale);
  return (
    <section className="grid min-w-0 gap-1.5">
      <h5 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </h5>
      <ul
        role="list"
        aria-label={interpolate(s.rowRegion, { name: gameName, row: label })}
        className={cn(
          "grid min-w-0 gap-2",
          compact
            ? "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(92px,1fr))]",
        )}
      >
        {slots.map((slot) =>
          slot.kind === "missing" ? (
            <li
              key={`missing:${slot.card.name}`}
              aria-label={interpolate(s.missingLabel, { name: slot.card.name })}
              className="grid min-w-0 content-start gap-1 rounded-md border border-dashed border-[var(--line-strong)] p-1.5 opacity-70"
            >
              <InventoryArtwork
                src={slot.card.imageUrl}
                className="grid h-28 w-full place-items-center overflow-hidden rounded bg-[var(--surface-2)] grayscale"
              />
              <span className="line-clamp-2 text-[11px] leading-4">
                {slot.card.name}
              </span>
              <span className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                {s.missing}
              </span>
            </li>
          ) : (
            <li key={slot.variant.variantId} className="min-w-0">
              <Tile
                compact={compact}
                variant={slot.variant}
                inBasket={!!basket[slot.variant.variantId]}
                price={prices[slot.variant.variantId]}
                disabled={disabled}
                now={now}
                locale={localeInfo.dateLocale}
                onToggle={onToggle}
              />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function Tile({
  compact = false,
  variant,
  inBasket,
  price,
  disabled,
  now,
  locale: numberLocale,
  onToggle,
}: {
  compact?: boolean;
  variant: InventoryVariant;
  inBasket: boolean;
  price: VariantPriceState | undefined;
  disabled: boolean;
  now: number;
  locale: string;
  onToggle: (variant: InventoryVariant) => void;
}) {
  const { locale } = useI18n();
  const s = setInventoryCopy(locale);
  const sellable = variant.saleCapacity > 0;
  const reason = !variant.marketable
    ? s.notMarketable
    : !sellable
      ? s.keepOne
      : null;
  const current =
    price?.currency && (price.displayUntil === null || price.displayUntil > now)
      ? price
      : null;
  const money = (value: number | null | undefined) =>
    current?.currency && value !== null && value !== undefined
      ? formatMoney(value, current.currency, numberLocale)
      : null;
  const market = money(current?.sourceBuyerPrice);
  const receive = sellable ? money(current?.sellerReceivesPerItem) : null;
  const priceFailed =
    price?.status === "error" || price?.status === "unavailable";
  // Only a reason the user can act on is shown; "keep one copy" stays a hint.
  const visibleReason = variant.marketable ? null : reason;
  const priceText = variant.marketable ? (
    <span className="flex flex-wrap items-center justify-between gap-x-1 text-[10px] text-[var(--muted)]">
      <span
        className="whitespace-nowrap tabular-nums text-[var(--ink)]"
        title={s.marketPrice}
      >
        {market ?? (priceFailed ? "–" : "…")}
      </span>
      {sellable && (
        <span
          className="flex items-center gap-0.5 whitespace-nowrap tabular-nums"
          title={s.receivePerExtra}
        >
          {receive && `+${receive}`}
          {!inBasket && <Plus size={12} aria-hidden="true" />}
        </span>
      )}
    </span>
  ) : visibleReason ? (
    <span className="text-[10px] text-[var(--muted)]">{visibleReason}</span>
  ) : null;
  const badges = (
    <>
      {variant.quantity > 1 && (
        <span className="absolute inset-e-1 top-1 rounded-full bg-[var(--ink)] px-1.5 text-[10px] font-bold text-[var(--surface)]">
          ×{variant.quantity}
        </span>
      )}
      {inBasket && (
        <span className="absolute inset-s-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--primary)] text-[var(--primary-fg)]">
          <Check size={12} aria-hidden="true" />
        </span>
      )}
    </>
  );
  return (
    <button
      type="button"
      data-variant-id={variant.variantId}
      aria-pressed={sellable ? inBasket : undefined}
      aria-label={interpolate(s.tileLabel, {
        name: variant.name,
        count: variant.quantity,
      })}
      aria-description={reason ?? (inBasket ? s.inBasket : undefined)}
      title={reason ?? undefined}
      disabled={disabled || !sellable}
      onClick={() => onToggle(variant)}
      className={cn(
        "relative w-full min-w-0 rounded-md border p-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-default",
        compact ? "flex items-center gap-2 pe-8" : "grid content-start gap-1",
        inBasket
          ? "border-[var(--primary)] bg-[var(--info-soft)]"
          : "border-[var(--line)] bg-[var(--surface-2)] enabled:hover:border-[var(--line-strong)]",
        !sellable && "opacity-80",
      )}
    >
      <InventoryArtwork
        src={variant.iconUrl}
        className={cn(
          "grid place-items-center overflow-hidden rounded bg-[var(--surface-3)]",
          compact ? "h-10 w-10 shrink-0" : "h-28 w-full",
        )}
      />
      {badges}
      {compact ? (
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-[11px] font-semibold leading-4">
            {variant.name}
          </span>
          {priceText}
        </span>
      ) : (
        <>
          <span className="line-clamp-2 text-[11px] font-semibold leading-4">
            {variant.name}
          </span>
          {priceText}
        </>
      )}
    </button>
  );
}
