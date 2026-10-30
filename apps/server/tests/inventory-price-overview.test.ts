import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MARKET_PRICE_SETTINGS,
  marketRulesFingerprint,
} from "@steam-bee/contracts";
import { InventoryMarketService } from "../src/inventory/service.js";
import {
  InventoryPriceOverviewService,
  maxPriceContextVariants,
  priceContextTtl,
} from "../src/inventory/price-overview.js";

const variant = "753:6:10:0";
function harness() {
  const state = {
    now: 1_000_000,
    settings: structuredClone(DEFAULT_MARKET_PRICE_SETTINGS),
    currency: 3,
    lowest: "115" as string | null,
    highest: "110" as string | null,
    histogramStatus: 200,
    histogramGate: null as (() => Promise<void>) | null,
    inventoryGate: null as (() => Promise<void>) | null,
    incomplete: false,
  };
  const assets = [
    { assetid: "100", amount: "1" },
    { assetid: "101", amount: "1" },
    { assetid: "102", amount: "1" },
  ].map((asset) => ({
    ...asset,
    appid: 753,
    contextid: "6",
    classid: "10",
    instanceid: "0",
  }));
  const descriptions = [
    {
      classid: "10",
      instanceid: "0",
      name: "Card",
      market_hash_name: "123-Card",
      marketable: 1,
      tradable: 1,
      market_fee: "0.10",
    },
  ];
  const request = vi.fn(
    async (_accountId: string, path: string, init?: { method?: string }) => {
      if (init?.method === "POST")
        throw new Error("Price rendering must never submit a Steam action");
      if (path.startsWith("/inventory/")) {
        if (state.inventoryGate) await state.inventoryGate();
        return Response.json({
          success: 1,
          total_inventory_count: assets.length + (state.incomplete ? 1 : 0),
          assets,
          descriptions,
        });
      }
      if (path.startsWith("/market/?"))
        return new Response(
          `var g_rgWalletInfo = ${JSON.stringify({
            wallet_currency: state.currency,
            wallet_country: "US",
            wallet_fee: 1,
            wallet_fee_percent: "0.05",
            wallet_fee_minimum: 1,
            wallet_fee_base: 0,
            wallet_publisher_fee_percent_default: "0.10",
          })};`,
        );
      if (path.startsWith("/market/listings/"))
        return new Response("Market_LoadOrderSpread(12345);");
      if (path.startsWith("/market/mylistings?"))
        return Response.json({
          success: 1,
          num_active_listings: 0,
          listings: [],
          assets: [],
        });
      if (path.startsWith("/market/itemordershistogram?")) {
        if (state.histogramGate) await state.histogramGate();
        return Response.json(
          {
            success: 1,
            lowest_sell_order: state.lowest,
            highest_buy_order: state.highest,
          },
          { status: state.histogramStatus },
        );
      }
      throw new Error(`Unexpected read: ${path}`);
    },
  );
  const service = new InventoryMarketService({
    request,
    steamId: () => "76561198000000000",
    now: () => state.now,
    settings: async () => structuredClone(state.settings),
  });
  return { state, assets, descriptions, request, service };
}
const countRequests = (
  request: ReturnType<typeof harness>["request"],
  prefix: string,
) => request.mock.calls.filter(([, path]) => path.startsWith(prefix)).length;

describe("read-only inventory price overview", () => {
  it("retains distinct Steam instances even when their class ID and display name match", async () => {
    const { service, assets, descriptions } = harness();
    assets.push({
      ...assets[0]!,
      assetid: "103",
      instanceid: "1",
      amount: "2",
    });
    descriptions.push({
      ...descriptions[0]!,
      instanceid: "1",
      market_hash_name: "123-Card (Foil)",
    });
    const inventory = await service.inventory("a");
    expect(inventory.items.map((item) => item.variantId)).toEqual([
      variant,
      variant,
      variant,
      "753:6:10:1",
    ]);
    expect(inventory.items[3]).toMatchObject({
      quantity: 2,
      duplicateQuantity: 1,
    });
    expect(inventory.duplicateQuantity).toBe(3);
    expect(
      (await service.priceOverview("a", [variant, "753:6:10:1"])).rows.map(
        (row) => row.variantId,
      ),
    ).toEqual([variant, "753:6:10:1"]);
  });
  it("keeps separate Steam assets and their keep-one stock while sharing one stable price variant", async () => {
    const { service, request } = harness();
    const preview = vi.spyOn(service, "previewSale");
    const batch = vi.spyOn(service, "previewBatch");
    const inventory = await service.inventory("a");
    expect(
      inventory.items.map((item) => [
        item.assetId,
        item.variantId,
        item.quantity,
        item.duplicateQuantity,
      ]),
    ).toEqual([
      ["100", variant, 1, 0],
      ["101", variant, 1, 1],
      ["102", variant, 1, 1],
    ]);
    expect(inventory.duplicateQuantity).toBe(2);
    const prices = await service.priceOverview("a", [variant]);
    expect(prices).toMatchObject({
      accountId: "a",
      inventoryFetchedAt: inventory.fetchedAt,
      currency: { id: 3, code: "EUR", minorUnit: 2 },
      priceMode: "lowestSellOrder",
      rows: [
        {
          variantId: variant,
          rawReferenceBuyerPrice: 115,
          estimate: { buyerPaysPerItem: 115, sellerReceivesPerItem: 100 },
          error: null,
          stale: false,
        },
      ],
    });
    expect(prices.walletFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(prices).not.toHaveProperty("token");
    expect(preview).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(service.currentBatch("a", "browser")).toBeNull();
    expect(
      request.mock.calls.every(([, , init]) => init?.method !== "POST"),
    ).toBe(true);
    expect(countRequests(request, "/inventory/")).toBe(1);
    expect(countRequests(request, "/market/mylistings")).toBe(0);
  });

  it("separates the raw reference from the rule-adjusted buyer price and exact net proceeds", async () => {
    const { state, service, request } = harness();
    await service.inventory("a");
    state.settings = { ...state.settings, adjustment: -1, currencyId: 3 };
    let prices = await service.priceOverview("a", [variant]);
    expect(prices.rows[0]).toMatchObject({
      rawReferenceBuyerPrice: 115,
      estimate: { buyerPaysPerItem: 112, sellerReceivesPerItem: 99 },
      error: null,
    });
    expect(prices.rulesFingerprint).toBe(
      marketRulesFingerprint(state.settings),
    );
    state.settings = {
      ...state.settings,
      adjustment: 0,
      priceMode: "highestBuyOrder",
    };
    prices = await service.priceOverview("a", [variant]);
    expect(prices.rows[0]?.rawReferenceBuyerPrice).toBe(110);
    expect(prices.priceMode).toBe("highestBuyOrder");
    expect(countRequests(request, "/market/itemordershistogram?")).toBe(1);
    expect(countRequests(request, "/inventory/")).toBe(1);
    state.settings = { ...state.settings, minBuyerPrice: 200 };
    prices = await service.priceOverview("a", [variant]);
    expect(prices.rows[0]).toMatchObject({
      rawReferenceBuyerPrice: 110,
      estimate: null,
      error: "OUTSIDE_PRICE_LIMITS",
    });
  });

  it("retains an existing market reference when Steam's minimum fees leave no valid net amount", async () => {
    const { state, service } = harness();
    state.lowest = "1";
    await service.inventory("a");
    expect((await service.priceOverview("a", [variant])).rows[0]).toMatchObject(
      {
        rawReferenceBuyerPrice: 1,
        estimate: null,
        error: "BELOW_MINIMUM_FEES",
      },
    );
  });

  it("never lets the display cache replace fresh sale preview and confirmation reads", async () => {
    const { state, service, request } = harness();
    await service.inventory("a");
    expect(
      (await service.priceOverview("a", [variant])).rows[0]
        ?.rawReferenceBuyerPrice,
    ).toBe(115);
    state.lowest = "230";
    const preview = await service.previewSale("a", "browser", "101", 1);
    expect(preview.buyerPaysPerItem).toBe(230);
    state.lowest = "345";
    await expect(
      service.confirmSale("a", "browser", preview.token),
    ).rejects.toThrow(/prices changed/);
    expect(countRequests(request, "/market/itemordershistogram?")).toBe(3);
    expect(
      (await service.priceOverview("a", [variant])).rows[0]
        ?.rawReferenceBuyerPrice,
    ).toBe(115);
    expect(
      request.mock.calls.every(([, , init]) => init?.method !== "POST"),
    ).toBe(true);
  });

  it("invalidates the currency basis and rejects rules bound to another wallet", async () => {
    const { state, service } = harness();
    state.settings = { ...state.settings, currencyId: 3, adjustment: -1 };
    await service.inventory("a");
    const euro = await service.priceOverview("a", [variant]);
    state.now += 31_000;
    state.currency = 1;
    const dollar = await service.priceOverview("a", [variant]);
    expect(dollar.currency?.code).toBe("USD");
    expect(dollar.walletFingerprint).not.toBe(euro.walletFingerprint);
    expect(dollar.rows[0]).toMatchObject({
      rawReferenceBuyerPrice: 115,
      estimate: null,
      error: "CURRENCY_MISMATCH",
    });
  });

  it("keeps original price timestamps for a rate-limited stale read and never refetches the inventory per chunk", async () => {
    const { state, service, request } = harness();
    await service.inventory("a");
    const fresh = await service.priceOverview("a", [variant]);
    state.now += 61_000;
    state.histogramStatus = 429;
    const stale = await service.priceOverview("a", [variant]);
    expect(stale.rows[0]).toMatchObject({
      rawReferenceBuyerPrice: 115,
      stale: true,
      error: "RATE_LIMITED",
      observedAt: fresh.rows[0]?.observedAt,
      freshUntil: fresh.rows[0]?.freshUntil,
      displayUntil: fresh.rows[0]?.displayUntil,
    });
    expect(stale.rows[0]?.retryAt).toBeGreaterThan(state.now);
    const histogramCalls = countRequests(
      request,
      "/market/itemordershistogram?",
    );
    await service.priceOverview("a", [variant]);
    expect(countRequests(request, "/market/itemordershistogram?")).toBe(
      histogramCalls,
    );
    expect(countRequests(request, "/inventory/")).toBe(1);
  });

  it("does not replace a complete trusted context after a failed partial inventory refresh", async () => {
    const { state, service, request } = harness();
    const inventory = await service.inventory("a");
    state.incomplete = true;
    state.now += 100;
    await expect(service.inventory("a")).rejects.toThrow(
      /incomplete inventory/,
    );
    expect(
      (await service.priceOverview("a", [variant])).inventoryFetchedAt,
    ).toBe(inventory.fetchedAt);
    expect(countRequests(request, "/inventory/")).toBe(2);
  });

  it("expires a context without fetching inventory or price data automatically", async () => {
    const { state, service, request } = harness();
    await expect(service.priceOverview("a", [variant])).rejects.toMatchObject({
      statusCode: 409,
      code: "INVENTORY_PRICE_CONTEXT_EXPIRED",
    });
    expect(request).not.toHaveBeenCalled();
    await service.inventory("a");
    state.now += priceContextTtl;
    await expect(service.priceOverview("a", [variant])).rejects.toMatchObject({
      code: "INVENTORY_PRICE_CONTEXT_EXPIRED",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["pause", "shutdown"])(
    "invalidates late inventory and price responses on %s",
    async (interruption) => {
      const { state, service } = harness();
      let release!: () => void;
      state.inventoryGate = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      const inventory = service.inventory("a");
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      if (interruption === "pause") service.stopAccountBatches("a");
      else service.shutdownBatches();
      release();
      await inventory;
      await expect(service.priceOverview("a", [variant])).rejects.toMatchObject(
        { code: "INVENTORY_PRICE_CONTEXT_EXPIRED" },
      );
      state.inventoryGate = null;
      await service.inventory("a");
      state.histogramGate = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      release = undefined as unknown as () => void;
      const prices = service.priceOverview("a", [variant]);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      if (interruption === "pause") service.stopAccountBatches("a");
      else service.shutdownBatches();
      release();
      await expect(prices).rejects.toMatchObject({
        code: "INVENTORY_PRICE_CONTEXT_EXPIRED",
      });
    },
  );
});

describe("bounded trusted variant contexts", () => {
  const items = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      variantId: `753:6:${index + 1}:0`,
      marketHashName: null,
      marketable: false,
      publisherFee: null,
    }));
  function service() {
    const request = vi.fn(async () => {
      throw new Error("Unmarketable variants need no Steam price requests");
    });
    return {
      request,
      prices: new InventoryPriceOverviewService({
        request,
        settings: async () => DEFAULT_MARKET_PRICE_SETTINGS,
      }),
    };
  }
  it("keeps a 40,000-variant account complete and evicts whole other accounts", async () => {
    const { prices, request } = service();
    prices.seed("a", items(40_000), 1);
    prices.seed("b", items(20_000), 2);
    await expect(prices.read("a", [variant])).rejects.toMatchObject({
      code: "INVENTORY_PRICE_CONTEXT_EXPIRED",
    });
    expect((await prices.read("b", ["753:6:20000:0"])).rows[0]?.error).toBe(
      "NOT_MARKETABLE",
    );
    prices.seed("a", items(40_000), 3);
    expect((await prices.read("a", ["753:6:40000:0"])).rows[0]?.error).toBe(
      "NOT_MARKETABLE",
    );
    await expect(prices.read("b", [variant])).rejects.toMatchObject({
      code: "INVENTORY_PRICE_CONTEXT_EXPIRED",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("evicts least recently used complete accounts and has a terminal oversized response", async () => {
    const { prices, request } = service();
    for (let index = 0; index < 8; index++)
      prices.seed(String(index), items(1), index);
    await prices.read("0", ["753:6:1:0"]);
    prices.seed("8", items(1), 8);
    await expect(prices.read("1", ["753:6:1:0"])).rejects.toMatchObject({
      code: "INVENTORY_PRICE_CONTEXT_EXPIRED",
    });
    expect((await prices.read("0", ["753:6:1:0"])).rows).toHaveLength(1);
    prices.seed("large", items(maxPriceContextVariants + 1), 9);
    await expect(prices.read("large", [variant])).rejects.toMatchObject({
      code: "INVENTORY_PRICE_CONTEXT_TOO_LARGE",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("returns unknown variants separately without trusting browser names or issuing arbitrary lookups", async () => {
    const { prices, request } = service();
    prices.seed("a", items(1), 1);
    expect(
      (await prices.read("a", ["753:6:1:0", "753:6:99:0"])).rows.map(
        (row) => row.error,
      ),
    ).toEqual(["NOT_MARKETABLE", "UNKNOWN_VARIANT"]);
    await expect(
      prices.read("a", ["753:6:1:0", "753:6:1:0"]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(request).not.toHaveBeenCalled();
  });
});
