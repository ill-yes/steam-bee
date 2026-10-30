import type { CardSet, InventoryItem } from "@steam-bee/contracts";
import { describe, expect, it } from "vitest";
import { buildInventoryVariants } from "../src/features/inventory/inventory-model";
import {
  cardNameKey,
  setSlots,
} from "../src/features/inventory/InventorySetBrowser";
import {
  addToBasket,
  basketEntries,
  basketTotals,
  pruneBasket,
} from "../src/features/inventory/sell-basket";
import { emptyVariantPrice } from "../src/features/inventory/inventory-prices";

const item = (
  assetId: string,
  name: string,
  overrides: Partial<InventoryItem> = {},
): InventoryItem => ({
  assetId,
  variantId: `v:${name}`,
  name,
  marketHashName: name,
  type: "Trading Card",
  iconUrl: null,
  quantity: 3,
  duplicateQuantity: 2,
  marketable: true,
  tradable: true,
  ...overrides,
});

describe("card set slots", () => {
  it("normalizes inventory card names to badge page names", () => {
    expect(cardNameKey("Zoté  (Trading Card)")).toBe("zote");
    expect(cardNameKey("Zote (Foil Trading Card)")).toBe("zote");
    expect(cardNameKey("Zote (Foil)")).toBe("zote");
  });

  it("orders owned cards like the set, fills gaps and keeps unmatched cards", () => {
    const variants = buildInventoryVariants([
      item("1", "Grimm (Trading Card)"),
      item("2", "Stray"),
      item("3", "Zote"),
    ]);
    const set: CardSet = {
      appId: 1,
      badgeLevel: 0,
      remainingDrops: null,
      fetchedAt: 0,
      cards: [
        { name: "Zote", imageUrl: null, owned: 3 },
        { name: "Hornet", imageUrl: null, owned: 0 },
        { name: "Grimm", imageUrl: null, owned: 3 },
      ],
    };
    const names = (slots: ReturnType<typeof setSlots>) =>
      slots.map((slot) =>
        slot.kind === "item" ? slot.variant.name : `missing:${slot.card.name}`,
      );
    expect(names(setSlots(variants, set, true))).toEqual([
      "Zote",
      "missing:Hornet",
      "Grimm (Trading Card)",
      "Stray",
    ]);
    expect(names(setSlots(variants, set, false))).toEqual([
      "Zote",
      "Grimm (Trading Card)",
      "Stray",
    ]);
    expect(names(setSlots(variants, null, true))).toHaveLength(3);
  });
});

describe("sell basket", () => {
  const variants = buildInventoryVariants([
    item("1", "A"),
    item("2", "B", { quantity: 1, duplicateQuantity: 0 }),
    item("3", "C", { marketable: false }),
  ]);

  it("adds only sellable extras and prunes vanished or reduced stock", () => {
    const { basket, skipped } = addToBasket({}, variants, variants);
    expect(basket).toEqual({ "v:A": 2 });
    expect(skipped).toBe(0);
    const reduced = buildInventoryVariants([
      item("1", "A", { quantity: 2, duplicateQuantity: 1 }),
    ]);
    expect(basketEntries(basket, reduced)[0]?.quantity).toBe(1);
    expect(pruneBasket(basket, reduced)).toEqual({ "v:A": 1 });
    expect(pruneBasket(basket, [])).toEqual({});
    const same = { "v:A": 2 };
    expect(pruneBasket(same, variants)).toBe(same);
  });

  it("totals only displayable estimates", () => {
    const currency = { id: 1, code: "USD", minorUnit: 2 };
    const entries = basketEntries({ "v:A": 2 }, variants);
    expect(
      basketTotals(
        entries,
        {
          "v:A": {
            ...emptyVariantPrice,
            status: "ready",
            buyerPrice: 115,
            sellerReceivesPerItem: 100,
            currency,
            displayUntil: 2_000,
          },
        },
        1_000,
      ),
    ).toEqual({ buyer: 230, receive: 200, fees: 30, priced: 1, currency });
    expect(basketTotals(entries, {}, 1_000).priced).toBe(0);
  });
});
