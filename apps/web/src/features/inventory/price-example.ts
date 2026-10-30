import type { MarketPriceSettings } from "@steam-bee/contracts";

/** Typical card prices in wallet minor units, used only for the worked example. */
export const exampleSource: Record<MarketPriceSettings["priceMode"], number> = {
  lowestSellOrder: 17,
  highestBuyOrder: 14,
};
const steamFeeRate = 0.05;
const publisherFeeRate = 0.1;

export type PriceExample = {
  source: number;
  adjustment: number;
  buyerPays: number;
  /** The server refuses sales outside the saved minimum/maximum instead of clamping. */
  blocked: boolean;
  fees: number;
  receive: number;
};

/**
 * Estimates one sale with Steam's default fee rates (5 % Steam, 10 % game,
 * each at least one minor unit). Real quotes come from the server.
 */
export function priceExample({
  mode,
  adjustment,
  minimum,
  maximum,
}: {
  mode: MarketPriceSettings["priceMode"];
  adjustment: number;
  minimum: number | null;
  maximum: number | null;
}): PriceExample {
  const source = exampleSource[mode];
  const buyerPays = Math.max(source + adjustment, 3);
  const blocked =
    (minimum !== null && buyerPays < minimum) ||
    (maximum !== null && buyerPays > maximum);
  const receive = sellerReceives(buyerPays);
  return {
    source,
    adjustment,
    buyerPays,
    blocked,
    fees: buyerPays - receive,
    receive,
  };
}

export function sellerReceives(buyerPays: number) {
  for (
    // Floored fees can leave room above buyerPays / 1.15; fees >= 0.15 * seller - 2 bounds it.
    let seller = Math.floor(
      (buyerPays + 2) / (1 + steamFeeRate + publisherFeeRate),
    );
    seller > 0;
    seller -= 1
  ) {
    const fees =
      Math.max(Math.floor(seller * steamFeeRate), 1) +
      Math.max(Math.floor(seller * publisherFeeRate), 1);
    if (seller + fees <= buyerPays) return seller;
  }
  return 0;
}
