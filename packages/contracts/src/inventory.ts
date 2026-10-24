/** Prices use integer ISO currency minor units; minorUnit is the exponent. */
export type MarketCurrency = { id: number; code: string; minorUnit: number };
export type InventoryItem = {
  assetId: string;
  /** Steam description identity, shared by separate assets of the same variant. */
  variantId?: string;
  name: string;
  marketHashName: string | null;
  type: string;
  iconUrl: string | null;
  quantity: number;
  duplicateQuantity: number;
  marketable: boolean;
  tradable: boolean;
  gameAppId?: number | null;
  gameName?: string | null;
  gameIconUrl?: string | null;
  category?: InventoryCategory;
  cardKind?: "normal" | "foil" | null;
};
export type InventorySnapshot = {
  appId: 753;
  contextId: "6";
  fetchedAt: number;
  items: InventoryItem[];
  totalQuantity: number;
  duplicateQuantity: number;
};
export type MarketListing = {
  listingId: string;
  assetId: string;
  name: string;
  quantity: number;
  buyerPays: number;
  sellerReceives: number;
  pendingConfirmation: boolean;
};
export type MarketListings = {
  fetchedAt: number;
  listings: MarketListing[];
  currency: MarketCurrency | null;
};
export type MarketSalePreview = {
  token: string;
  expiresAt: number;
  assetId: string;
  name: string;
  quantity: number;
  buyerPaysPerItem: number;
  sellerReceivesPerItem: number;
  steamFeePerItem: number;
  publisherFeePerItem: number;
  totalBuyerPays: number;
  totalSellerReceives: number;
  currency: MarketCurrency;
};
export type MarketCancelPreview = {
  token: string;
  expiresAt: number;
  listingId: string;
  name: string;
};
export type MarketActionResult = {
  ok: boolean;
  listingId: string | null;
  pendingConfirmation: boolean;
  message: string;
};

export type InventoryCategory =
  "card" | "background" | "emoticon" | "booster" | "sale" | "other";
export type MarketPriceSettings = {
  priceMode: "lowestSellOrder" | "highestBuyOrder";
  /** Signed price adjustment in the bound wallet's ISO minor units. */
  adjustment: number;
  minBuyerPrice: number | null;
  maxBuyerPrice: number | null;
  delaySeconds: number;
  currencyId: number | null;
};
export const DEFAULT_MARKET_PRICE_SETTINGS: MarketPriceSettings = {
  priceMode: "lowestSellOrder",
  adjustment: 0,
  minBuyerPrice: null,
  maxBuyerPrice: null,
  delaySeconds: 10,
  currencyId: null,
};

/** Canonical display-rule identity, shared by server responses and browser drafts. */
export function marketRulesFingerprint(settings: MarketPriceSettings): string {
  return JSON.stringify([
    settings.priceMode,
    settings.adjustment,
    settings.minBuyerPrice,
    settings.maxBuyerPrice,
    settings.currencyId,
  ]);
}

export type InventoryPriceOverviewError =
  | "UNKNOWN_VARIANT"
  | "NOT_MARKETABLE"
  | "NO_ORDERS"
  | "BELOW_MINIMUM_FEES"
  | "OUTSIDE_PRICE_LIMITS"
  | "CURRENCY_MISMATCH"
  | "UNSUPPORTED_PRICE"
  | "STEAM_UNAVAILABLE"
  | "RATE_LIMITED";

export type InventoryPriceOverviewRequest = { variantIds: string[] };
export type InventoryPriceOverviewRow = {
  variantId: string;
  rawReferenceBuyerPrice: number | null;
  estimate: {
    buyerPaysPerItem: number;
    sellerReceivesPerItem: number;
  } | null;
  observedAt: number | null;
  freshUntil: number | null;
  displayUntil: number | null;
  stale: boolean;
  error: InventoryPriceOverviewError | null;
  retryAt: number | null;
};
/** Informational unit prices only; never authorizes a sale or reserves an asset. */
export type InventoryPriceOverview = {
  accountId: string;
  inventoryFetchedAt: number;
  currency: MarketCurrency | null;
  priceMode: MarketPriceSettings["priceMode"];
  rulesFingerprint: string;
  walletFingerprint: string | null;
  rows: InventoryPriceOverviewRow[];
};
export type MarketBatchPreviewItem = {
  assetId: string | null;
  variantId?: string;
  listingId: string | null;
  name: string;
  quantity: number;
  /** Total amounts for this row, not the unit price. */
  buyerPays: number | null;
  sellerReceives: number | null;
  steamFee: number | null;
  publisherFee: number | null;
  status: "ready" | "unavailable";
  message: string | null;
};
export type MarketBatchPreview = {
  token: string;
  expiresAt: number;
  kind: "sale" | "cancel";
  currency: MarketCurrency | null;
  items: MarketBatchPreviewItem[];
  totalBuyerPays: number;
  totalSellerReceives: number;
  delaySeconds: number;
};
export type MarketBatchJobItem = {
  assetId: string | null;
  variantId?: string;
  listingId: string | null;
  name: string;
  quantity: number;
  status:
    | "queued"
    | "running"
    | "listed"
    | "pending_confirmation"
    | "cancelled"
    | "failed"
    | "skipped";
  message: string | null;
};
export type MarketBatchJob = {
  id: string;
  kind: "sale" | "cancel";
  status: "running" | "waiting" | "completed" | "stopped";
  createdAt: number;
  updatedAt: number;
  nextActionAt: number | null;
  items: MarketBatchJobItem[];
  completedCount: number;
  totalCount: number;
  stopRequested: boolean;
};
