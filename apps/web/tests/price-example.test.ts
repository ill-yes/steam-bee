import { describe, expect, it } from "vitest";
import {
  priceExample,
  sellerReceives,
} from "../src/features/inventory/price-example";

describe("price rule example", () => {
  it("estimates Steam fees with a minimum of one unit each", () => {
    expect(sellerReceives(3)).toBe(1);
    expect(sellerReceives(16)).toBe(14);
    expect(sellerReceives(115)).toBe(100);
    // Floored fees allow more than buyerPays / 1.15 here: 28 + 1 + 2 = 31.
    expect(sellerReceives(31)).toBe(28);
  });

  it("matches a brute-force search for the largest payout", () => {
    const fees = (seller: number) =>
      Math.max(Math.floor(seller * 0.05), 1) +
      Math.max(Math.floor(seller * 0.1), 1);
    for (let buyer = 1; buyer <= 5000; buyer++) {
      let best = 0;
      for (let seller = 1; seller + fees(seller) <= buyer; seller++)
        best = seller;
      expect(sellerReceives(buyer)).toBe(best);
    }
  });

  it("flags prices the server would refuse instead of clamping them", () => {
    expect(
      priceExample({
        mode: "lowestSellOrder",
        adjustment: -1,
        minimum: null,
        maximum: null,
      }),
    ).toEqual({
      source: 17,
      adjustment: -1,
      buyerPays: 16,
      blocked: false,
      fees: 2,
      receive: 14,
    });
    expect(
      priceExample({
        mode: "highestBuyOrder",
        adjustment: 0,
        minimum: 20,
        maximum: null,
      }),
    ).toMatchObject({ buyerPays: 14, blocked: true });
    expect(
      priceExample({
        mode: "lowestSellOrder",
        adjustment: 0,
        minimum: null,
        maximum: 10,
      }),
    ).toMatchObject({ buyerPays: 17, blocked: true });
  });
});
