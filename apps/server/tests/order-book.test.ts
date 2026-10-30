import { describe, expect, it } from "vitest";
import { parseListingOrderBook } from "../src/inventory/order-book.js";

const state = (data: string) =>
  `{"state":{"data":${data},"dataUpdateCount":1,"status":"success"},"queryKey":["market","orderbook",753,"209330-Card"],"queryHash":"x"}`;
const embedded = (data: string) =>
  `<script>window.SSR = JSON.parse("${state(data).replaceAll('"', '\\"')}");</script>`;

describe("listing order book", () => {
  it("reads the order book embedded in Steam's listing page", () => {
    expect(
      parseListingOrderBook(
        embedded(
          '{"amtMaxBuyOrder":7,"amtMinSellOrder":10,"eCurrency":3,"cBuyOrders":18,"rgCompactSellOrders":[10,1]}',
        ),
      ),
    ).toEqual({ currencyId: 3, lowestSellOrder: 10, highestBuyOrder: 7 });
  });

  it("reads unescaped state and treats empty sides as missing", () => {
    expect(
      parseListingOrderBook(
        state('{"amtMaxBuyOrder":0,"amtMinSellOrder":null,"eCurrency":1}'),
      ),
    ).toEqual({ currencyId: 1, lowestSellOrder: null, highestBuyOrder: null });
  });

  it("returns null for pages without an order book", () => {
    expect(
      parseListingOrderBook("<script>Market_LoadOrderSpread( 123 );</script>"),
    ).toBeNull();
    expect(
      parseListingOrderBook(state('{"amtMaxBuyOrder":7,"eCurrency":3}')),
    ).toBeNull();
  });
});
