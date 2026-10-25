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
  });

  it("applies the adjustment and the minimum and maximum limits", () => {
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
      limited: false,
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
    ).toMatchObject({ buyerPays: 20, limited: true });
    expect(
      priceExample({
        mode: "lowestSellOrder",
        adjustment: 0,
        minimum: null,
        maximum: 10,
      }),
    ).toMatchObject({ buyerPays: 10, limited: true });
  });
});
