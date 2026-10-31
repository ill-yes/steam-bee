import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import type { MarketCurrency, MarketPriceSettings } from "@steam-bee/contracts";
import { Button } from "../../components/ui/button";
import { interpolate, useI18n } from "../../i18n";
import type { VariantPriceState } from "./inventory-prices";
import { formatMoney, InventoryArtwork } from "./inventory-ui";
import { allocateVariantSale, formatMinorToMajor } from "./inventory-model";
import {
  basketAllocations,
  basketTotals,
  MAX_SALE_ACTIONS,
  type SellBasketEntry,
} from "./sell-basket";
import { setInventoryCopy } from "./set-copy";

export function SellBasketPanel({
  id,
  entries,
  prices,
  settings,
  currency,
  now,
  disabled,
  blockedReason,
  onQuantity,
  onRemove,
  onClear,
  onReview,
  onEditRules,
}: {
  id: string;
  entries: SellBasketEntry[];
  prices: Record<string, VariantPriceState>;
  settings: MarketPriceSettings | null;
  currency: MarketCurrency | null;
  now: number;
  disabled: boolean;
  blockedReason?: string | undefined;
  onQuantity: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
  onClear: () => void;
  onReview: (trigger: HTMLElement) => void;
  onEditRules: () => void;
}) {
  const { locale, localeInfo } = useI18n();
  const s = setInventoryCopy(locale);
  const money = (amount: number | null, unit = currency) =>
    formatMoney(amount, unit, localeInfo.dateLocale);
  const copies = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const actions = basketAllocations(entries).length;
  const totals = basketTotals(entries, prices, now);
  const totalCurrency = totals.currency ?? currency;
  const overLimit = actions > MAX_SALE_ACTIONS;
  const rule = settings
    ? interpolate(s.rulePrice, {
        rule:
          settings.priceMode === "highestBuyOrder"
            ? s.ruleHighest
            : s.ruleLowest,
        adjustment:
          settings.adjustment && currency
            ? ` ${settings.adjustment > 0 ? "+" : ""}${formatMinorToMajor(settings.adjustment, currency.minorUnit)} ${currency.code}`
            : "",
      })
    : null;

  return (
    <aside
      id={id}
      aria-label={s.basket}
      tabIndex={-1}
      className="grid min-w-0 content-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 outline-none xl:sticky xl:top-20"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold">
            <ShoppingCart size={16} aria-hidden="true" />
            {s.basket}
          </h4>
          <p className="text-xs text-[var(--muted)]" aria-live="polite">
            {interpolate(s.basketSummary, { items: entries.length, copies })}
          </p>
        </div>
        {entries.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={onClear}
          >
            <Trash2 size={14} aria-hidden="true" />
            {s.clear}
          </Button>
        )}
      </header>

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--line)] p-4 text-center text-xs leading-5 text-[var(--muted)]">
          {s.basketEmpty}
        </p>
      ) : (
        <ul className="grid max-h-[50vh] gap-2 overflow-y-auto">
          {entries.map(({ variant, quantity }) => {
            const price = prices[variant.variantId];
            const shown =
              price?.currency &&
              (price.displayUntil === null || price.displayUntil > now);
            const canAdd =
              quantity < variant.saleCapacity &&
              actions -
                allocateVariantSale(variant, quantity).length +
                allocateVariantSale(variant, quantity + 1).length <=
                MAX_SALE_ACTIONS;
            return (
              <li
                key={variant.variantId}
                className="flex items-center gap-2 rounded-md border border-[var(--line)] p-1.5"
              >
                <InventoryArtwork
                  src={variant.iconUrl}
                  className="grid h-12 w-10 shrink-0 place-items-center overflow-hidden rounded bg-[var(--surface-3)]"
                />
                <div className="grid min-w-0 flex-1 gap-1">
                  <span className="truncate text-xs font-semibold">
                    {variant.name}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={interpolate(s.less, { name: variant.name })}
                      disabled={disabled || quantity <= 1}
                      onClick={() =>
                        onQuantity(variant.variantId, quantity - 1)
                      }
                      className="grid h-6 w-6 place-items-center rounded border border-[var(--line)] disabled:opacity-40"
                    >
                      <Minus size={12} aria-hidden="true" />
                    </button>
                    <output
                      aria-label={interpolate(s.quantity, {
                        name: variant.name,
                      })}
                      className="min-w-6 text-center text-xs font-bold"
                    >
                      {quantity}
                    </output>
                    <button
                      type="button"
                      aria-label={interpolate(s.more, { name: variant.name })}
                      disabled={disabled || !canAdd}
                      onClick={() =>
                        onQuantity(variant.variantId, quantity + 1)
                      }
                      className="grid h-6 w-6 place-items-center rounded border border-[var(--line)] disabled:opacity-40"
                    >
                      <Plus size={12} aria-hidden="true" />
                    </button>
                    <span className="text-[10px] text-[var(--muted)]">
                      {interpolate(s.stays, {
                        count: variant.quantity - quantity,
                      })}
                    </span>
                  </span>
                </div>
                <span className="grid justify-items-end text-xs">
                  <span className="font-semibold">
                    {shown && price.sellerReceivesPerItem !== null
                      ? money(
                          price.sellerReceivesPerItem * quantity,
                          price.currency,
                        )
                      : "—"}
                  </span>
                  <button
                    type="button"
                    aria-label={interpolate(s.remove, { name: variant.name })}
                    disabled={disabled}
                    onClick={() => onRemove(variant.variantId)}
                    className="grid h-6 w-6 place-items-center rounded text-[var(--muted)] hover:text-[var(--danger)]"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {entries.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-[var(--line)] pt-2 text-xs">
          <dt className="text-[var(--muted)]">{s.buyerPays}</dt>
          <dd className="text-end">
            {totals.priced ? money(totals.buyer, totalCurrency) : "—"}
          </dd>
          <dt className="text-[var(--muted)]">{s.fees}</dt>
          <dd className="text-end">
            {totals.priced ? money(totals.fees, totalCurrency) : "—"}
          </dd>
          <dt className="font-semibold">{s.receive}</dt>
          <dd className="text-end font-semibold text-[var(--good)]">
            {totals.priced ? money(totals.receive, totalCurrency) : "—"}
          </dd>
        </dl>
      )}
      {entries.length > 0 && totals.priced < entries.length && (
        <p className="text-[11px] text-[var(--muted)]">
          {interpolate(s.partialPrices, {
            count: totals.priced,
            total: entries.length,
          })}
        </p>
      )}
      {entries.length > 0 && (
        <p
          className={
            overLimit
              ? "text-xs font-semibold text-[var(--danger)]"
              : "text-xs text-[var(--muted)]"
          }
          role={overLimit ? "alert" : undefined}
        >
          {overLimit
            ? s.actionLimit
            : settings
              ? interpolate(s.actions, {
                  count: actions,
                  delay: settings.delaySeconds,
                })
              : interpolate(s.actionsCount, { count: actions })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {rule && <span className="text-[var(--muted-strong)]">{rule}</span>}
        <button
          type="button"
          onClick={onEditRules}
          className="font-semibold text-[var(--info)] underline"
        >
          {s.editRules}
        </button>
      </div>
      {blockedReason && (
        <p className="text-xs text-[var(--warn)]">{blockedReason}</p>
      )}
      <Button
        variant="primary"
        disabled={disabled || !entries.length || overLimit || !!blockedReason}
        onClick={(event) => onReview(event.currentTarget)}
      >
        {s.review}
      </Button>
      <p className="text-[11px] leading-4 text-[var(--muted)]">
        {s.reviewHint}
      </p>
    </aside>
  );
}
