import { ShieldCheck } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { cn } from "../../lib/utils";
import { interpolate, useI18n } from "../../i18n";
import { advancedInventoryCopy } from "./advanced-copy";
import { inventoryCopy } from "./copy";
import { inventoryCategory, type InventoryVariant } from "./inventory-model";
import { emptyVariantPrice, type VariantPriceState } from "./inventory-prices";
import { variantInventoryCopy } from "./variant-copy";

export function InventoryItemCard({
  item,
  artwork,
  selection,
  selected,
  quantity,
  quantityText,
  maxQuantity,
  quantityError,
  disabled,
  salesBlocked,
  blockedReason,
  price = emptyVariantPrice,
  now,
  onQuantity,
  onPreview,
  onRetryPrice,
}: {
  item: InventoryVariant;
  artwork: ReactNode;
  selection: ReactNode;
  selected: boolean;
  quantity: number | null;
  quantityText: string;
  maxQuantity: number;
  quantityError: string | null;
  disabled: boolean;
  salesBlocked: boolean;
  blockedReason: string | null;
  price?: VariantPriceState | undefined;
  now: number;
  onQuantity: (value: string) => void;
  onPreview: (trigger: HTMLElement) => void;
  onRetryPrice?: (() => void) | undefined;
}) {
  const { locale, localeInfo } = useI18n();
  const t = locale === "de" ? inventoryCopy.de : inventoryCopy.en;
  const a = advancedInventoryCopy(locale);
  const c = variantInventoryCopy(locale);
  const titleId = useId();
  const canSell = item.saleCapacity > 0;
  const category = inventoryCategory(item);
  const allMarketable = item.assets.every((asset) => asset.marketable);
  const allTradable = item.assets.every((asset) => asset.tradable);
  const status = (any: boolean, all: boolean) =>
    !any ? c.unavailable : all ? c.available : c.partlyAvailable;
  const displayPrice = price.displayUntil === null || price.displayUntil > now;
  const money = (amount: number | null) => {
    if (
      !displayPrice ||
      amount === null ||
      !price.currency ||
      !Number.isSafeInteger(amount)
    )
      return "—";
    return new Intl.NumberFormat(localeInfo.dateLocale, {
      style: "currency",
      currency: price.currency.code,
      minimumFractionDigits: price.currency.minorUnit,
      maximumFractionDigits: price.currency.minorUnit,
    }).format(amount / 10 ** price.currency.minorUnit);
  };
  const priceAge =
    price.fetchedAt === null
      ? null
      : Math.max(0, Math.floor((now - price.fetchedAt) / 60_000));
  const unavailableEstimate =
    price.sourceBuyerPrice !== null && price.buyerPrice === null;
  const errorMessages: Record<
    NonNullable<VariantPriceState["error"]>,
    string
  > = {
    UNKNOWN_VARIANT: c.priceUnknownVariant,
    NOT_MARKETABLE: c.notMarketable,
    NO_ORDERS: c.priceNoOrders,
    BELOW_MINIMUM_FEES: c.priceBelowFees,
    OUTSIDE_PRICE_LIMITS: c.priceOutsideLimits,
    CURRENCY_MISMATCH: c.priceCurrencyMismatch,
    UNSUPPORTED_PRICE: c.priceUnsupported,
    STEAM_UNAVAILABLE: c.priceSteamUnavailable,
    RATE_LIMITED: c.priceRateLimited,
    CONTEXT_EXPIRED: c.priceContextExpired,
    CONTEXT_TOO_LARGE: c.priceContextTooLarge,
    REQUEST_FAILED: c.priceError,
  };
  const errorMessage = price.error ? errorMessages[price.error] : null;
  const priceMessage = price.refreshing
    ? c.priceRefreshing
    : !displayPrice || price.status === "stale"
      ? `${c.stalePrice}${errorMessage ? ` ${errorMessage}` : ""}`
      : price.status === "loading"
        ? c.priceLoading
        : price.status === "idle"
          ? c.priceWaiting
          : price.status === "error"
            ? (errorMessage ?? c.priceError)
            : unavailableEstimate
              ? (errorMessage ?? c.estimateUnavailable)
              : price.status === "unavailable"
                ? (errorMessage ?? c.priceUnavailable)
                : null;
  const retryAllowed =
    !price.refreshing &&
    price.status !== "loading" &&
    (price.retryAt === null || price.retryAt <= now);
  const protection = !item.marketable
    ? c.notMarketable
    : item.quantity === 1 && item.duplicateQuantity === 0
      ? c.unique
      : c.noEligible;
  const proceeds =
    quantity === null
      ? null
      : price.sellerReceivesPerItem === null
        ? null
        : price.sellerReceivesPerItem * quantity;

  return (
    <article
      aria-labelledby={titleId}
      data-variant-id={item.variantId}
      className={cn(
        "row-span-4 grid min-w-0 grid-rows-subgrid gap-0 self-stretch rounded-lg border border-[var(--line)] bg-[var(--surface)]",
        selected && "border-[var(--accent-line)] bg-[var(--selected)]",
      )}
    >
      <header className="grid content-start gap-2 p-3">
        <div className="flex min-w-0 items-start gap-2">
          {artwork}
          <div className="min-w-0 flex-1">
            <h5 id={titleId} className="break-words text-sm font-semibold">
              {item.name}
            </h5>
            <p className="mt-1 break-words text-xs text-[var(--muted)]">
              {a[category]}
            </p>
          </div>
          <label
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md max-sm:h-11 max-sm:w-11"
            title={c.choose}
          >
            {selection}
          </label>
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-xs">
          <dt className="text-[var(--muted)]">{c.market}</dt>
          <dd className="text-right">
            {status(item.marketable, allMarketable)}
          </dd>
          <dt className="text-[var(--muted)]">{c.trade}</dt>
          <dd className="text-right">{status(item.tradable, allTradable)}</dd>
        </dl>
      </header>

      <dl className="grid grid-cols-2 gap-3 border-t border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs">
        <div>
          <dt className="text-[var(--muted)]">{c.inInventory}</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">
            {item.quantity}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">{c.extraCopies}</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">
            {item.duplicateQuantity}
          </dd>
        </div>
      </dl>

      <div className="grid content-start gap-2 border-t border-[var(--line)] p-3">
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 text-xs">
          <dt className="text-[var(--muted)]">
            {price.priceMode === "highestBuyOrder"
              ? c.referenceBuy
              : price.priceMode === "lowestSellOrder"
                ? c.referenceSell
                : c.referenceUnknown}
          </dt>
          <dd className="text-right tabular-nums">
            {money(price.sourceBuyerPrice)}
          </dd>
          <dt className="text-[var(--muted)]">{c.ownPrice}</dt>
          <dd className="text-right tabular-nums">{money(price.buyerPrice)}</dd>
          <dt className="font-semibold">
            {canSell
              ? quantity === 1
                ? c.proceedsOne
                : interpolate(c.proceeds, { count: quantity ?? "—" })
              : c.proceedsPerCopy}
          </dt>
          <dd className="text-right font-semibold tabular-nums text-[var(--good)]">
            {money(canSell ? proceeds : price.sellerReceivesPerItem)}
          </dd>
        </dl>
        <p className="text-xs text-[var(--muted)]">{c.afterFees}</p>
        {quantity === null && canSell && (
          <p className="text-xs text-[var(--warn)]">{c.invalidPriceQuantity}</p>
        )}
        {price.fetchedAt !== null && (
          <p className="text-xs text-[var(--muted)]">
            <time dateTime={new Date(price.fetchedAt).toISOString()}>
              {interpolate(c.priceAt, {
                time: new Intl.DateTimeFormat(localeInfo.dateLocale, {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(price.fetchedAt),
              })}
            </time>
            {" · "}
            {priceAge === 0
              ? c.priceNow
              : interpolate(c.priceAge, { count: priceAge ?? 0 })}
          </p>
        )}
        {priceMessage && (
          <p
            role="status"
            className={cn(
              "text-xs leading-5",
              price.status === "error" ||
                price.status === "stale" ||
                price.status === "unavailable"
                ? "text-[var(--warn)]"
                : "text-[var(--muted)]",
            )}
          >
            {priceMessage}
          </p>
        )}
        {onRetryPrice &&
          !["CONTEXT_TOO_LARGE", "UNKNOWN_VARIANT", "NOT_MARKETABLE"].includes(
            price.error ?? "",
          ) &&
          (price.status === "error" ||
            price.status === "stale" ||
            price.status === "unavailable") && (
            <div className="grid gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={!retryAllowed || disabled}
                className="justify-self-start"
                onClick={onRetryPrice}
                aria-label={`${c.retryPrice}: ${item.name}`}
              >
                {c.retryPrice}
              </Button>
              {!retryAllowed && price.retryAt !== null && (
                <p className="text-xs text-[var(--muted)]">
                  {interpolate(c.retryAt, {
                    time: new Intl.DateTimeFormat(localeInfo.dateLocale, {
                      timeStyle: "short",
                    }).format(price.retryAt),
                  })}
                </p>
              )}
            </div>
          )}
      </div>

      <footer className="grid content-start gap-2 rounded-b-lg border-t border-[var(--line)] bg-[var(--surface-2)] p-3">
        {canSell ? (
          <>
            <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
              <Label htmlFor={`${titleId}-quantity`} className="min-w-0 gap-1">
                {c.quantity}
                <span className="flex items-center gap-2 font-normal">
                  <Input
                    id={`${titleId}-quantity`}
                    className="h-11 w-12 px-1 text-sm tabular-nums"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxQuantity}
                    step={1}
                    value={quantityText}
                    disabled={disabled}
                    aria-label={`${t.quantity}: ${item.name}`}
                    aria-invalid={!!quantityError}
                    aria-describedby={`${titleId}-quantity-help${quantityError ? ` ${titleId}-quantity-error` : ""}`}
                    onChange={(event) => onQuantity(event.target.value)}
                  />
                  <span
                    id={`${titleId}-quantity-help`}
                    className="max-w-16 text-xs"
                  >
                    {interpolate(c.maximum, { count: maxQuantity })}
                  </span>
                </span>
              </Label>
              <Button
                size="sm"
                className="min-h-11"
                disabled={
                  disabled ||
                  salesBlocked ||
                  !!quantityError ||
                  quantity === null
                }
                onClick={(event) => onPreview(event.currentTarget)}
                aria-label={`${t.preview}: ${item.name}`}
              >
                {t.preview}
              </Button>
            </div>
            {quantityError && (
              <p
                id={`${titleId}-quantity-error`}
                role="alert"
                className="text-xs leading-5 text-[var(--danger)]"
              >
                {quantityError}
              </p>
            )}
            {quantity !== null && (
              <p className="text-xs leading-5 text-[var(--muted)]">
                {item.quantity - quantity === 1
                  ? c.remainsOne
                  : interpolate(c.remains, { count: item.quantity - quantity })}
              </p>
            )}
            {item.sellableQuantity < item.duplicateQuantity && (
              <p className="text-xs leading-5 text-[var(--muted)]">
                {interpolate(c.partialSale, {
                  count: item.sellableQuantity,
                  total: item.duplicateQuantity,
                })}
              </p>
            )}
          </>
        ) : (
          <p className="flex items-start gap-2 text-xs leading-5 text-[var(--muted-strong)]">
            <ShieldCheck
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>{protection}</span>
          </p>
        )}
        {blockedReason && canSell && (
          <p className="text-xs leading-5 text-[var(--warn)]">
            {blockedReason}
          </p>
        )}
      </footer>
    </article>
  );
}
