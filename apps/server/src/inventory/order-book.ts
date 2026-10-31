export type ListingOrderBook = {
  currencyId: number;
  lowestSellOrder: number | null;
  highestBuyOrder: number | null;
};

const orderBookKey = '"queryKey":["market","orderbook",';
const stateStart = '{"state":{"data":';

/**
 * Steam's current listing page embeds its order book in the dehydrated query
 * state instead of calling Market_LoadOrderSpread. Amounts are read as Steam
 * hundredths, the unit of itemordershistogram and the wallet info; that is only
 * confirmed for two-decimal wallets, not yet against a JPY or KRW page.
 */
export function parseListingOrderBook(html: string): ListingOrderBook | null {
  // The state is serialized inside a JS string, so quotes arrive escaped.
  for (const quote of ['\\"', '"']) {
    const key = orderBookKey.replaceAll('"', quote);
    const end = html.indexOf(key);
    if (end < 0) continue;
    const start = html.lastIndexOf(stateStart.replaceAll('"', quote), end);
    if (start < 0 || end - start > 20_000) return null;
    const state = html.slice(start, end).replaceAll(quote, '"');
    const field = (name: string) => {
      const match = new RegExp(`"${name}":(null|\\d{1,15})[,}]`).exec(state);
      if (!match) return undefined;
      return match[1] === "null" ? null : Number(match[1]);
    };
    const currencyId = field("eCurrency");
    const lowestSellOrder = field("amtMinSellOrder");
    const highestBuyOrder = field("amtMaxBuyOrder");
    if (
      typeof currencyId !== "number" ||
      lowestSellOrder === undefined ||
      highestBuyOrder === undefined
    )
      return null;
    return {
      currencyId,
      lowestSellOrder: lowestSellOrder || null,
      highestBuyOrder: highestBuyOrder || null,
    };
  }
  return null;
}
