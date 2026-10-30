import { allocateVariantSale, type InventoryVariant } from "./inventory-model";
import type { VariantPriceState } from "./inventory-prices";

/** Variant ID to the number of extra copies to sell, in the order they were added. */
export type SellBasket = Record<string, number>;
export type SellBasketEntry = { variant: InventoryVariant; quantity: number };

export const MAX_SALE_ACTIONS = 50;

/** Drop variants that left the inventory and clamp to what is still sellable. */
export function pruneBasket(
  basket: SellBasket,
  variants: readonly InventoryVariant[],
): SellBasket {
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  let changed = false;
  const next: SellBasket = {};
  for (const [id, quantity] of Object.entries(basket)) {
    const capacity = byId.get(id)?.saleCapacity ?? 0;
    const value = Math.min(quantity, capacity);
    if (value !== quantity) changed = true;
    if (value > 0) next[id] = value;
  }
  return changed ? next : basket;
}

export function basketEntries(
  basket: SellBasket,
  variants: readonly InventoryVariant[],
): SellBasketEntry[] {
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  return Object.entries(basket).flatMap(([id, quantity]) => {
    const variant = byId.get(id);
    // A refresh can shrink stock before the basket itself is pruned.
    const value = Math.min(quantity, variant?.saleCapacity ?? 0);
    return variant && value > 0 ? [{ variant, quantity: value }] : [];
  });
}

/** Real Steam listings the basket needs; every asset row is one action. */
export function basketAllocations(entries: readonly SellBasketEntry[]) {
  return entries.flatMap((entry) =>
    allocateVariantSale(entry.variant, entry.quantity),
  );
}

/** Copies of a variant that fit into the given number of Steam actions. */
export function quantityWithin(variant: InventoryVariant, actions: number) {
  if (variant.saleCapacity < 1 || actions < 1) return 0;
  return allocateVariantSale(variant, variant.saleCapacity)
    .slice(0, actions)
    .reduce((total, row) => total + row.quantity, 0);
}

/**
 * Add every extra copy of each variant. Once the batch limit is reached the
 * rest is reported as skipped rather than silently dropped.
 */
export function addToBasket(
  basket: SellBasket,
  variants: readonly InventoryVariant[],
  all: readonly InventoryVariant[],
): { basket: SellBasket; skipped: number } {
  const next = { ...basket };
  let actions = basketAllocations(basketEntries(next, all)).length;
  let skipped = 0;
  for (const variant of variants) {
    if (variant.saleCapacity < 1 || next[variant.variantId]) continue;
    const quantity = quantityWithin(variant, MAX_SALE_ACTIONS - actions);
    if (quantity < variant.saleCapacity) skipped += 1;
    if (quantity < 1) continue;
    next[variant.variantId] = quantity;
    actions += allocateVariantSale(variant, quantity).length;
  }
  return { basket: next, skipped };
}

export function basketTotals(
  entries: readonly SellBasketEntry[],
  prices: Record<string, VariantPriceState>,
  now: number,
) {
  let buyer = 0;
  let receive = 0;
  let priced = 0;
  let currency: VariantPriceState["currency"] = null;
  for (const { variant, quantity } of entries) {
    const price = prices[variant.variantId];
    if (
      !price ||
      price.buyerPrice === null ||
      price.sellerReceivesPerItem === null ||
      !price.currency ||
      (price.displayUntil !== null && price.displayUntil <= now)
    )
      continue;
    currency ??= price.currency;
    buyer += price.buyerPrice * quantity;
    receive += price.sellerReceivesPerItem * quantity;
    priced += 1;
  }
  return { buyer, receive, fees: buyer - receive, priced, currency };
}
