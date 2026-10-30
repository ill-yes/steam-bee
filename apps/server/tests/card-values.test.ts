import { describe, expect, it } from "vitest";
import {
  cardSearchPath,
  cardValueFromSearch,
  parsePriceText,
} from "../src/farming/card-values.js";

describe("card values", () => {
  it("reads common Steam price formats", () => {
    expect(parsePriceText("0,12€")).toMatchObject({
      amount: 0.12,
      suffix: "€",
    });
    expect(parsePriceText("$0.08")).toMatchObject({
      amount: 0.08,
      prefix: "$",
    });
    expect(parsePriceText("1.234,56€")?.amount).toBe(1234.56);
    expect(parsePriceText("CDN$ 1.05")).toMatchObject({
      amount: 1.05,
      prefix: "CDN$",
    });
    expect(parsePriceText("free")).toBeNull();
  });

  it("averages listed normal cards in the session currency", () => {
    expect(
      cardValueFromSearch({
        success: true,
        results: [
          { sell_price_text: "0,10€" },
          { sell_price_text: "0,20€" },
          { sell_price_text: "broken" },
        ],
      }),
    ).toEqual({ average: expect.closeTo(0.15), text: "0,15€" });
    expect(cardValueFromSearch({ results: [] })).toBeNull();
    expect(cardValueFromSearch(null)).toBeNull();
  });

  it("searches only normal trading cards of one game", () => {
    const path = cardSearchPath(413150);
    expect(path.startsWith("/market/search/render/?")).toBe(true);
    const query = new URLSearchParams(path.split("?")[1]);
    expect(query.get("category_753_Game[]")).toBe("tag_app_413150");
    expect(query.get("category_753_cardborder[]")).toBe("tag_cardborder_0");
    expect(query.get("norender")).toBe("1");
  });
});
