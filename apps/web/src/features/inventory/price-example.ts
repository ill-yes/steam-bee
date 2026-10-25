import type { MarketPriceSettings } from "@steam-bee/contracts";

/** Typical card prices in wallet minor units, used only for the worked example. */
const exampleSource: Record<MarketPriceSettings["priceMode"], number> = {
  lowestSellOrder: 17,
  highestBuyOrder: 14,
};
const steamFeeRate = 0.05;
const publisherFeeRate = 0.1;

export type PriceExample = {
  source: number;
  adjustment: number;
  buyerPays: number;
  limited: boolean;
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
  const lowest = Math.max(minimum ?? 0, 3);
  let buyerPays = Math.max(source + adjustment, lowest);
  if (maximum !== null && buyerPays > maximum) buyerPays = Math.max(maximum, 3);
  const receive = sellerReceives(buyerPays);
  return {
    source,
    adjustment,
    buyerPays,
    limited: buyerPays !== source + adjustment,
    fees: buyerPays - receive,
    receive,
  };
}

export function sellerReceives(buyerPays: number) {
  for (
    let seller = Math.ceil(buyerPays / (1 + steamFeeRate + publisherFeeRate));
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
