import type {
  InventoryPriceOverviewError,
  MarketCurrency,
  MarketPriceSettings,
} from "@steam-bee/contracts";

/** Display estimates never authorize a market action. All amounts use minor units. */
export type VariantPriceState = {
  status: "idle" | "loading" | "ready" | "stale" | "error" | "unavailable";
  sourceBuyerPrice: number | null;
  buyerPrice: number | null;
  sellerReceivesPerItem: number | null;
  currency: MarketCurrency | null;
  priceMode: MarketPriceSettings["priceMode"] | null;
  fetchedAt: number | null;
  freshUntil: number | null;
  displayUntil: number | null;
  error:
    | InventoryPriceOverviewError
    | "CONTEXT_EXPIRED"
    | "CONTEXT_TOO_LARGE"
    | "REQUEST_FAILED"
    | null;
  retryAt: number | null;
  refreshing?: boolean;
};

export const emptyVariantPrice: VariantPriceState = {
  status: "idle",
  sourceBuyerPrice: null,
  buyerPrice: null,
  sellerReceivesPerItem: null,
  currency: null,
  priceMode: null,
  fetchedAt: null,
  freshUntil: null,
  displayUntil: null,
  error: null,
  retryAt: null,
};
