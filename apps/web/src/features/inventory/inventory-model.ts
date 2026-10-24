import type { InventoryItem } from "@steam-bee/contracts";

export type InventoryCategory =
  "card" | "foil" | "background" | "emoticon" | "booster" | "sale" | "other";
export type InventoryFilterCategory = "all" | InventoryCategory;
export type InventorySort = "name" | "game" | "duplicates" | "quantity";

// Optional fields keep older snapshots usable while richer inventory metadata loads.
export type InventoryDisplayItem = InventoryItem & {
  gameAppId?: number | null;
  gameName?: string | null;
  gameIconUrl?: string | null;
  category?: Exclude<InventoryCategory, "foil">;
  cardKind?: "normal" | "foil" | null;
};

/** Shared display metadata for both individual assets and complete variants. */
export type InventoryItemMetadata = Omit<InventoryDisplayItem, "assetId">;

export type InventoryVariant = Omit<InventoryItem, "assetId"> & {
  variantId: string;
  assets: InventoryItem[];
  /** All marketable extra copies, before the per-asset sale limit. */
  sellableQuantity: number;
  /** Extra copies that fit within 100 units for each actual asset. */
  saleCapacity: number;
};

export type InventorySaleAllocation = { assetId: string; quantity: number };

export type InventoryFilters = {
  search?: string;
  category?: InventoryFilterCategory;
  game?: string;
  duplicatesOnly?: boolean;
  marketableOnly?: boolean;
  tradableOnly?: boolean;
  sort?: InventorySort;
};

export type InventoryGameGroup<
  T extends InventoryItemMetadata = InventoryDisplayItem,
> = {
  key: string;
  gameAppId: number | null;
  gameName: string | null;
  gameIconUrl: string | null;
  items: T[];
  totalQuantity: number;
  duplicateQuantity: number;
};

const collator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function gameAppId(item: InventoryItemMetadata): number | null {
  const value = item.gameAppId;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function gameName(item: InventoryItemMetadata): string | null {
  return item.gameName?.trim() || null;
}

export function inventoryCategory(
  item: InventoryItemMetadata,
): InventoryCategory {
  if (item.category) {
    return item.category === "card" && item.cardKind === "foil"
      ? "foil"
      : item.category;
  }

  const type = normalize(item.type);
  // Foil must be checked before the broader trading-card match.
  if (/foil.*(?:card|sammelkarte)|glanzsammelkarte/.test(type)) return "foil";
  if (/trading\s*card|sammelkarte/.test(type)) return "card";
  if (/emoticon|emotikon/.test(type)) return "emoticon";
  if (/background|hintergrund/.test(type)) return "background";
  if (/booster/.test(type)) return "booster";
  if (/coupon|gutschein|sale item/.test(type)) return "sale";
  return "other";
}

export function inventoryGameKey(item: InventoryItemMetadata): string {
  const appId = gameAppId(item);
  if (appId !== null) return `app:${appId}`;
  const name = gameName(item);
  return name ? `name:${normalize(name).replace(/\s+/g, " ")}` : "unknown";
}

/** Group full snapshots without dropping items whose game cannot be identified. */
export function groupInventoryItems<T extends InventoryItemMetadata>(
  items: readonly T[],
  { preserveOrder = false }: { preserveOrder?: boolean } = {},
): InventoryGameGroup<T>[] {
  const groups = new Map<string, InventoryGameGroup<T>>();
  for (const item of items) {
    const key = inventoryGameKey(item);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        gameAppId: gameAppId(item),
        gameName: gameName(item),
        gameIconUrl: item.gameIconUrl || null,
        items: [],
        totalQuantity: 0,
        duplicateQuantity: 0,
      };
      groups.set(key, group);
    }
    group.gameName ??= gameName(item);
    group.gameIconUrl ??= item.gameIconUrl || null;
    group.items.push(item);
    group.totalQuantity += item.quantity;
    group.duplicateQuantity += item.duplicateQuantity;
  }
  // Ranked views keep the first matching group's position rather than silently
  // replacing a quantity/name sort with another alphabetical game sort.
  if (preserveOrder) return [...groups.values()];
  return [...groups.values()].sort((left, right) => {
    if (left.key === "unknown") return right.key === "unknown" ? 0 : 1;
    if (right.key === "unknown") return -1;
    return (
      collator.compare(
        left.gameName || left.key,
        right.gameName || right.key,
      ) || collator.compare(left.key, right.key)
    );
  });
}

/** Apply to the complete snapshot before slicing pages so search covers all items. */
export function filterInventoryItems<T extends InventoryDisplayItem>(
  items: readonly T[],
  filters: InventoryFilters = {},
): T[] {
  return filterInventoryEntries(items, filters, (item) => item.assetId);
}

/** Filter whole variants so hiding assets never changes the displayed stock. */
export function filterInventoryVariants(
  variants: readonly InventoryVariant[],
  filters: InventoryFilters = {},
): InventoryVariant[] {
  return filterInventoryEntries(
    variants,
    filters,
    (variant) => variant.variantId,
  );
}

function filterInventoryEntries<T extends InventoryItemMetadata>(
  items: readonly T[],
  filters: InventoryFilters,
  itemKey: (item: T) => string,
): T[] {
  const terms = normalize(filters.search?.trim() || "")
    .split(/\s+/)
    .filter(Boolean);
  const filtered = items.filter((item) => {
    const category = inventoryCategory(item);
    if (
      filters.category &&
      filters.category !== "all" &&
      category !== filters.category
    )
      return false;
    if (
      filters.game &&
      filters.game !== "all" &&
      inventoryGameKey(item) !== filters.game
    )
      return false;
    if (filters.duplicatesOnly && item.duplicateQuantity <= 0) return false;
    if (filters.marketableOnly && !item.marketable) return false;
    if (filters.tradableOnly && !item.tradable) return false;
    if (!terms.length) return true;
    const searchable = normalize(
      [
        item.name,
        item.marketHashName || "",
        item.type,
        gameName(item) || "",
        gameAppId(item) ?? "",
        category,
      ].join(" "),
    );
    return terms.every((term) =>
      /^\d+$/.test(term)
        ? searchable
            .split(/[^\p{L}\p{N}]+/u)
            .some((word) => word.startsWith(term))
        : searchable.includes(term),
    );
  });

  return filtered.sort((left, right) => {
    let comparison = 0;
    if (filters.sort === "duplicates") {
      comparison = right.duplicateQuantity - left.duplicateQuantity;
    } else if (filters.sort === "quantity") {
      comparison = right.quantity - left.quantity;
    } else if (filters.sort === "game") {
      const leftKey = inventoryGameKey(left);
      const rightKey = inventoryGameKey(right);
      if (leftKey === "unknown" && rightKey !== "unknown") return 1;
      if (rightKey === "unknown" && leftKey !== "unknown") return -1;
      comparison = collator.compare(
        gameName(left) || leftKey,
        gameName(right) || rightKey,
      );
    }
    return (
      comparison ||
      collator.compare(left.name, right.name) ||
      collator.compare(itemKey(left), itemKey(right))
    );
  });
}

function sellableAssetQuantity(asset: InventoryItem): number {
  if (
    !asset.marketable ||
    !Number.isSafeInteger(asset.quantity) ||
    !Number.isSafeInteger(asset.duplicateQuantity) ||
    asset.quantity <= 0 ||
    asset.duplicateQuantity <= 0
  )
    return 0;
  return Math.min(asset.quantity, asset.duplicateQuantity);
}

/** Build from the complete snapshot, before filters and pagination. */
export function buildInventoryVariants(
  items: readonly InventoryItem[],
): InventoryVariant[] {
  const variants = new Map<string, InventoryVariant>();
  for (const item of items) {
    // Older snapshots lack canonical variant IDs: keep their assets separate.
    const variantId =
      (item as InventoryItem & { variantId?: string }).variantId ||
      `asset:${item.assetId}`;
    const sellableQuantity = sellableAssetQuantity(item);
    const saleCapacity = Math.min(sellableQuantity, 100);
    const existing = variants.get(variantId);
    if (existing) {
      existing.assets.push(item);
      existing.quantity += item.quantity;
      existing.duplicateQuantity += item.duplicateQuantity;
      existing.sellableQuantity += sellableQuantity;
      existing.saleCapacity += saleCapacity;
      // A filter matches a variant when any member supports that action.
      existing.marketable ||= item.marketable;
      existing.tradable ||= item.tradable;
      existing.gameAppId ??= item.gameAppId ?? null;
      existing.gameName ||= item.gameName ?? null;
      existing.gameIconUrl ||= item.gameIconUrl ?? null;
      existing.iconUrl ||= item.iconUrl;
    } else {
      const { assetId: _assetId, ...metadata } = item;
      variants.set(variantId, {
        ...metadata,
        variantId,
        assets: [item],
        sellableQuantity,
        saleCapacity,
      });
    }
  }
  return [...variants.values()];
}

function compareAssetIds(left: InventoryItem, right: InventoryItem): number {
  // Steam IDs can exceed Number.MAX_SAFE_INTEGER; compare decimal IDs exactly.
  if (/^\d+$/.test(left.assetId) && /^\d+$/.test(right.assetId)) {
    const leftId = BigInt(left.assetId);
    const rightId = BigInt(right.assetId);
    if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  }
  return (
    collator.compare(left.assetId, right.assetId) ||
    (left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0)
  );
}

/** Expand a variant sale into real, eligible asset rows without selling kept copies. */
export function allocateVariantSale(
  variant: InventoryVariant,
  quantity: number,
): InventorySaleAllocation[] {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError("Sale quantity must be a positive whole number.");
  }
  const assets = [...variant.assets].sort(compareAssetIds);
  const capacity = assets.reduce(
    (total, asset) => total + Math.min(sellableAssetQuantity(asset), 100),
    0,
  );
  if (quantity > capacity) {
    throw new RangeError("Sale quantity exceeds the available extra copies.");
  }
  const allocations: InventorySaleAllocation[] = [];
  let remaining = quantity;
  for (const asset of assets) {
    const amount = Math.min(remaining, sellableAssetQuantity(asset), 100);
    if (amount > 0) {
      allocations.push({ assetId: asset.assetId, quantity: amount });
      remaining -= amount;
    }
    if (remaining === 0) break;
  }
  // The caller applies the batch limit to these real rows, not to variant count.
  return allocations;
}

/** Parse a major-unit price exactly. No grouping, rounding, or floating-point multiplication. */
export function parseMajorToMinor(
  value: string,
  minorUnit: number,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): number | null {
  if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 20)
    return null;
  const input = value.trim();
  const match = /^(-?)(?:(\d+)(?:[.,](\d*))?|[.,](\d+))$/.exec(input);
  if (!match || (match[1] === "-" && !allowNegative)) return null;
  const fraction = match[3] ?? match[4] ?? "";
  if (fraction.length > minorUnit) return null;
  const digits = `${match[2] || "0"}${fraction.padEnd(minorUnit, "0")}`.replace(
    /^0+/,
    "",
  );
  // A safe integer has at most 16 decimal digits. Bound before constructing a BigInt.
  if (digits.length > 16) return null;
  const magnitude = BigInt(digits || "0");
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(match[1] === "-" ? -magnitude : magnitude);
}

/** Fixed, exact decimal text suitable for a price input, including signed adjustments. */
export function formatMinorToMajor(
  amount: number,
  minorUnit: number,
): string | null {
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isInteger(minorUnit) ||
    minorUnit < 0 ||
    minorUnit > 20
  )
    return null;
  const negative = amount < 0;
  const digits = (negative ? -BigInt(amount) : BigInt(amount))
    .toString()
    .padStart(minorUnit + 1, "0");
  const decimal = minorUnit
    ? `${digits.slice(0, -minorUnit)}.${digits.slice(-minorUnit)}`
    : digits;
  return `${negative ? "-" : ""}${decimal}`;
}
