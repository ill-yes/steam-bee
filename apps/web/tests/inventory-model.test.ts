import { describe, expect, it } from "vitest";
import {
  filterInventoryItems,
  formatMinorToMajor,
  groupInventoryItems,
  inventoryCategory,
  inventoryGameKey,
  parseMajorToMinor,
  type InventoryDisplayItem,
} from "../src/features/inventory/inventory-model";

function item(
  assetId: string,
  overrides: Partial<InventoryDisplayItem> = {},
): InventoryDisplayItem {
  return {
    assetId,
    name: assetId,
    marketHashName: null,
    type: "Trading Card",
    iconUrl: null,
    quantity: 1,
    duplicateQuantity: 0,
    marketable: true,
    tradable: true,
    ...overrides,
  };
}

describe("inventory categories and game groups", () => {
  it("uses metadata and distinguishes foil from normal cards", () => {
    expect(
      inventoryCategory(item("a", { category: "card", cardKind: "foil" })),
    ).toBe("foil");
    expect(
      inventoryCategory(item("b", { category: "card", cardKind: "normal" })),
    ).toBe("card");
    expect(
      inventoryCategory(item("c", { category: "other", type: "Trading Card" })),
    ).toBe("other");
    expect(inventoryCategory(item("d", { type: "Foil Trading Card" }))).toBe(
      "foil",
    );
    expect(inventoryCategory(item("e", { type: "Glanzsammelkarte" }))).toBe(
      "foil",
    );
    expect(inventoryCategory(item("f", { type: "Profile Background" }))).toBe(
      "background",
    );
    expect(inventoryCategory(item("g", { type: "Emoticon" }))).toBe("emoticon");
    expect(inventoryCategory(item("h", { type: "Booster Pack" }))).toBe(
      "booster",
    );
    expect(inventoryCategory(item("i", { type: "Coupon" }))).toBe("sale");
    expect(inventoryCategory(item("Trading Card", { type: "Unknown" }))).toBe(
      "other",
    );
  });

  it("groups by reliable app ID, retains unknown items, and counts copies", () => {
    const first = item("one", {
      gameAppId: 42,
      quantity: 3,
      duplicateQuantity: 2,
    });
    const second = item("two", {
      gameAppId: 42,
      gameName: "Bee Game",
      gameIconUrl: "https://example.com/bee.png",
      quantity: 2,
      duplicateQuantity: 1,
    });
    const unknown = item("unknown", { gameAppId: 0, gameName: " " });
    const groups = groupInventoryItems([unknown, first, second]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: "app:42",
      gameAppId: 42,
      gameName: "Bee Game",
      gameIconUrl: "https://example.com/bee.png",
      items: [first, second],
      totalQuantity: 5,
      duplicateQuantity: 3,
    });
    expect(groups[1]).toMatchObject({ key: "unknown", items: [unknown] });
  });

  it("normalizes name-only games without inferring a game from item names", () => {
    expect(inventoryGameKey(item("a", { gameName: "  Béé  Game " }))).toBe(
      "name:bee game",
    );
    expect(inventoryGameKey(item("Bee Game - Card"))).toBe("unknown");
    const groups = groupInventoryItems([
      item("one", { gameName: "Bee Game" }),
      item("two", { gameName: " bee game " }),
      item("three", { gameAppId: 15, gameName: "Bee Game" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(
      groups.find((group) => group.key === "name:bee game")?.items,
    ).toHaveLength(2);
  });
});

describe("inventory search, filters, and order", () => {
  const items = [
    item("Bee 10", {
      gameAppId: 20,
      gameName: "Zeta",
      category: "card",
      cardKind: "normal",
      quantity: 4,
      duplicateQuantity: 3,
    }),
    item("Bee 2", {
      gameAppId: 10,
      gameName: "Alphá",
      category: "card",
      cardKind: "foil",
      quantity: 2,
      duplicateQuantity: 1,
    }),
    item("Background", {
      gameAppId: 10,
      gameName: "Alphá",
      category: "background",
      quantity: 6,
      duplicateQuantity: 5,
      marketable: false,
    }),
    item("Locked", {
      category: "emoticon",
      quantity: 8,
      duplicateQuantity: 7,
      tradable: false,
    }),
  ];

  it("searches all source items and metadata before any pagination", () => {
    const source = [
      ...Array.from({ length: 50 }, (_, index) => item(`unrelated-${index}`)),
      item("Last item", {
        gameAppId: 1234,
        gameName: "Béé Story",
        marketHashName: "Hidden market name",
        type: "Emoticon",
      }),
    ];
    expect(
      filterInventoryItems(source, { search: "bee last" }).map(
        (value) => value.assetId,
      ),
    ).toEqual(["Last item"]);
    expect(filterInventoryItems(source, { search: "1234" })).toHaveLength(1);
    expect(
      filterInventoryItems(source, { search: "hidden market" }),
    ).toHaveLength(1);
    expect(filterInventoryItems(source, { search: "emoticon" })).toHaveLength(
      1,
    );
    expect(filterInventoryItems(source, { search: "not present" })).toEqual([]);
  });

  it("combines category, game, duplicate, marketable, and tradable filters", () => {
    expect(
      filterInventoryItems(items, { category: "card" }).map(
        (value) => value.assetId,
      ),
    ).toEqual(["Bee 10"]);
    expect(
      filterInventoryItems(items, {
        category: "foil",
        game: "app:10",
        duplicatesOnly: true,
        marketableOnly: true,
        tradableOnly: true,
      }).map((value) => value.assetId),
    ).toEqual(["Bee 2"]);
    expect(
      filterInventoryItems(items, { game: "app:10", marketableOnly: true }).map(
        (value) => value.assetId,
      ),
    ).toEqual(["Bee 2"]);
    expect(filterInventoryItems(items, { tradableOnly: true })).toHaveLength(3);
    expect(
      filterInventoryItems([item("single")], { duplicatesOnly: true }),
    ).toEqual([]);
    expect(
      filterInventoryItems(items, { game: "unknown" }).map(
        (value) => value.assetId,
      ),
    ).toEqual(["Locked"]);
    expect(
      filterInventoryItems(items, { category: "all", game: "all" }),
    ).toHaveLength(4);
  });

  it("sorts naturally and deterministically without modifying the source", () => {
    const original = [...items];
    expect(filterInventoryItems(items).map((value) => value.assetId)).toEqual([
      "Background",
      "Bee 2",
      "Bee 10",
      "Locked",
    ]);
    expect(
      filterInventoryItems(items, { sort: "game" }).map(
        (value) => value.assetId,
      ),
    ).toEqual(["Background", "Bee 2", "Bee 10", "Locked"]);
    expect(
      filterInventoryItems(items, { sort: "duplicates" }).map(
        (value) => value.assetId,
      ),
    ).toEqual(["Locked", "Background", "Bee 10", "Bee 2"]);
    expect(
      filterInventoryItems(items, { sort: "quantity" }).map(
        (value) => value.assetId,
      ),
    ).toEqual(["Locked", "Background", "Bee 10", "Bee 2"]);
    expect(items).toEqual(original);
    const ties = [item("2", { name: "same" }), item("1", { name: "same" })];
    expect(filterInventoryItems(ties).map((value) => value.assetId)).toEqual([
      "1",
      "2",
    ]);
  });
});

describe("exact currency input", () => {
  it("parses USD, JPY, and KWD using decimal strings", () => {
    expect(parseMajorToMinor("0.29", 2)).toBe(29);
    expect(parseMajorToMinor("1.15", 2)).toBe(115);
    expect(parseMajorToMinor(" 001,2 ", 2)).toBe(120);
    expect(parseMajorToMinor(".05", 2)).toBe(5);
    expect(parseMajorToMinor("1.", 2)).toBe(100);
    expect(parseMajorToMinor("123", 0)).toBe(123);
    expect(parseMajorToMinor("1.234", 3)).toBe(1234);
    expect(parseMajorToMinor("0", 2)).toBe(0);
  });

  it("never rounds precision or accepts exponent, grouping, or unsigned-mode signs", () => {
    for (const input of [
      "",
      " ",
      ".",
      "1e2",
      "1E2",
      "+1",
      "-1",
      "1,234.56",
      "1 234",
      "Infinity",
      "NaN",
      "1.001",
      "1.230",
    ])
      expect(parseMajorToMinor(input, 2), input).toBeNull();
    expect(parseMajorToMinor("1.0", 0)).toBeNull();
    expect(parseMajorToMinor("-0.01", 2, { allowNegative: true })).toBe(-1);
    expect(parseMajorToMinor("-0", 2, { allowNegative: true })).toBe(0);
    expect(parseMajorToMinor("+0.01", 2, { allowNegative: true })).toBeNull();
  });

  it("bounds results to safe integer minor units", () => {
    expect(parseMajorToMinor("90071992547409.91", 2)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(parseMajorToMinor("90071992547409.92", 2)).toBeNull();
    expect(parseMajorToMinor("9007199254740991", 0)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(
      parseMajorToMinor("-90071992547409.91", 2, { allowNegative: true }),
    ).toBe(-Number.MAX_SAFE_INTEGER);
    expect(parseMajorToMinor("999999999999999999999999999", 2)).toBeNull();
    for (const unit of [-1, 1.5, Infinity, NaN, 21])
      expect(parseMajorToMinor("1", unit)).toBeNull();
  });

  it("formats exact fixed decimal input strings and round-trips safe integers", () => {
    expect(formatMinorToMajor(29, 2)).toBe("0.29");
    expect(formatMinorToMajor(120, 2)).toBe("1.20");
    expect(formatMinorToMajor(123, 0)).toBe("123");
    expect(formatMinorToMajor(1234, 3)).toBe("1.234");
    expect(formatMinorToMajor(-5, 2)).toBe("-0.05");
    expect(formatMinorToMajor(Number.MAX_SAFE_INTEGER, 2)).toBe(
      "90071992547409.91",
    );
    for (const unit of [0, 2, 3]) {
      for (const amount of [0, 1, 29, 100, -123, Number.MAX_SAFE_INTEGER]) {
        expect(
          parseMajorToMinor(formatMinorToMajor(amount, unit)!, unit, {
            allowNegative: true,
          }),
        ).toBe(amount);
      }
    }
    expect(formatMinorToMajor(1.5, 2)).toBeNull();
    expect(formatMinorToMajor(Number.MAX_SAFE_INTEGER + 1, 2)).toBeNull();
    expect(formatMinorToMajor(1, -1)).toBeNull();
  });
});
