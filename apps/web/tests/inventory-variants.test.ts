import type { InventoryItem } from "@steam-bee/contracts";
import { describe, expect, it } from "vitest";
import {
  allocateVariantSale,
  buildInventoryVariants,
  filterInventoryVariants,
  groupInventoryItems,
  type InventoryVariant,
} from "../src/features/inventory/inventory-model";

type VariantAsset = InventoryItem & { variantId?: string };

function asset(
  assetId: string,
  overrides: Partial<VariantAsset> = {},
): VariantAsset {
  return {
    assetId,
    variantId: "class:10:instance:0",
    name: "The Bee",
    marketHashName: "Bee Game - The Bee",
    type: "Trading Card",
    iconUrl: null,
    quantity: 1,
    duplicateQuantity: 1,
    marketable: true,
    tradable: true,
    gameAppId: 42,
    gameName: "Bee Game",
    category: "card",
    cardKind: "normal",
    ...overrides,
  };
}

function firstVariant(items: readonly InventoryItem[]): InventoryVariant {
  return buildInventoryVariants(items)[0]!;
}

describe("complete inventory variants", () => {
  it("combines three separate assets into one variant with three owned and two extra copies", () => {
    const assets = [
      asset("11", { duplicateQuantity: 0 }),
      asset("13"),
      asset("12"),
    ];
    const source = structuredClone(assets);
    const variants = buildInventoryVariants(assets);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      variantId: "class:10:instance:0",
      quantity: 3,
      duplicateQuantity: 2,
      sellableQuantity: 2,
      saleCapacity: 2,
      assets,
    });
    expect(variants[0]).not.toHaveProperty("assetId");
    expect(assets).toEqual(source);
    expect(allocateVariantSale(variants[0]!, 2)).toEqual([
      { assetId: "12", quantity: 1 },
      { assetId: "13", quantity: 1 },
    ]);
  });

  it("uses canonical IDs rather than names, hashes, foil labels, or games", () => {
    const olderFirst = asset("4");
    const olderSecond = asset("5");
    delete olderFirst.variantId;
    delete olderSecond.variantId;
    const variants = buildInventoryVariants([
      asset("1"),
      asset("2", { variantId: "class:11:instance:0", cardKind: "foil" }),
      asset("3", {
        variantId: "class:12:instance:0",
        gameAppId: 43,
        gameName: "Other Game",
      }),
      olderFirst,
      olderSecond,
    ]);
    expect(variants.map((variant) => variant.variantId)).toEqual([
      "class:10:instance:0",
      "class:11:instance:0",
      "class:12:instance:0",
      "asset:4",
      "asset:5",
    ]);
    expect(filterInventoryVariants(variants, { category: "foil" })).toEqual([
      variants[1],
    ]);
    const groups = groupInventoryItems(variants);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.key === "app:42")).toMatchObject({
      totalQuantity: 4,
      duplicateQuantity: 4,
      items: [variants[0], variants[1], variants[3], variants[4]],
    });
  });

  it("filters complete variants without hiding their protected or unavailable stock", () => {
    const variants = buildInventoryVariants([
      asset("1", { duplicateQuantity: 0, marketable: false, tradable: false }),
      asset("2"),
      asset("3", { marketable: false }),
      asset("4", {
        variantId: "class:other",
        name: "Other",
        duplicateQuantity: 0,
      }),
    ]);
    const filtered = filterInventoryVariants(variants, {
      search: "bee",
      game: "app:42",
      category: "card",
      duplicatesOnly: true,
      marketableOnly: true,
      tradableOnly: true,
    })[0]!;
    expect(filtered).toBe(variants[0]);
    expect(filtered).toMatchObject({
      quantity: 3,
      duplicateQuantity: 2,
      sellableQuantity: 1,
      saleCapacity: 1,
      marketable: true,
      tradable: true,
    });
    expect(filtered.assets).toHaveLength(3);
    expect(allocateVariantSale(filtered, 1)).toEqual([
      { assetId: "2", quantity: 1 },
    ]);
    expect(() => allocateVariantSale(filtered, 2)).toThrow(RangeError);
  });

  it("sorts whole variants by quantities and stable IDs without modifying the source", () => {
    const variants = buildInventoryVariants([
      asset("1", { variantId: "variant:10", quantity: 2 }),
      asset("2", { variantId: "variant:2", quantity: 3, duplicateQuantity: 2 }),
      asset("3", { variantId: "variant:1", quantity: 1 }),
    ]);
    const order = variants.map((variant) => variant.variantId);
    expect(
      filterInventoryVariants(variants).map((variant) => variant.variantId),
    ).toEqual(["variant:1", "variant:2", "variant:10"]);
    expect(
      filterInventoryVariants(variants, { sort: "quantity" }).map(
        (variant) => variant.variantId,
      ),
    ).toEqual(["variant:2", "variant:10", "variant:1"]);
    expect(variants.map((variant) => variant.variantId)).toEqual(order);
  });
});

describe("variant sale allocation", () => {
  it("keeps the protected copy in a stack and caps each real asset at 100 units", () => {
    const variant = firstVariant([
      asset("10", { quantity: 3, duplicateQuantity: 3 }),
      asset("2", { quantity: 250, duplicateQuantity: 249 }),
      asset("1", { quantity: 7, duplicateQuantity: 0 }),
      asset("3", { quantity: 8, duplicateQuantity: 8, marketable: false }),
    ]);
    expect(variant).toMatchObject({
      quantity: 268,
      duplicateQuantity: 260,
      sellableQuantity: 252,
      saleCapacity: 103,
    });
    expect(allocateVariantSale(variant, 102)).toEqual([
      { assetId: "2", quantity: 100 },
      { assetId: "10", quantity: 2 },
    ]);
    expect(allocateVariantSale(variant, 103)).toEqual([
      { assetId: "2", quantity: 100 },
      { assetId: "10", quantity: 3 },
    ]);
    expect(() => allocateVariantSale(variant, 104)).toThrow(RangeError);
    expect(variant.assets.map((item) => item.assetId)).toEqual([
      "10",
      "2",
      "1",
      "3",
    ]);
  });

  it("compares numeric Steam asset IDs exactly, including IDs above the safe integer limit", () => {
    const variant = firstVariant([
      asset("9007199254740993"),
      asset("10"),
      asset("9007199254740992"),
      asset("2"),
    ]);
    expect(allocateVariantSale(variant, 4).map((row) => row.assetId)).toEqual([
      "2",
      "10",
      "9007199254740992",
      "9007199254740993",
    ]);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 3])(
    "rejects invalid or unavailable quantities (%s) atomically",
    (quantity) => {
      const variant = firstVariant([asset("1"), asset("2")]);
      expect(() => allocateVariantSale(variant, quantity)).toThrow(RangeError);
      expect(variant.assets.map((item) => item.duplicateQuantity)).toEqual([
        1, 1,
      ]);
    },
  );

  it("recalculates availability from actual assets instead of trusting stale aggregate fields", () => {
    const variant = firstVariant([
      asset("1", { quantity: 2, duplicateQuantity: 5 }),
      asset("2", { marketable: false }),
      asset("3", { duplicateQuantity: 0 }),
    ]);
    const stale: InventoryVariant = { ...variant, saleCapacity: 999 };
    expect(allocateVariantSale(stale, 2)).toEqual([
      { assetId: "1", quantity: 2 },
    ]);
    expect(() => allocateVariantSale(stale, 3)).toThrow(RangeError);
  });

  it("exposes every actual asset action so the caller can apply the 50-action batch limit", () => {
    const variant = firstVariant(
      Array.from({ length: 60 }, (_, index) => asset(String(100 + index))),
    );
    const rows = allocateVariantSale(variant, 60);
    expect(rows).toHaveLength(60);
    expect(rows.every((row) => row.quantity === 1)).toBe(true);
    expect(new Set(rows.map((row) => row.assetId))).toEqual(
      new Set(variant.assets.map((item) => item.assetId)),
    );
    expect(rows.length > 50).toBe(true);
  });
});
