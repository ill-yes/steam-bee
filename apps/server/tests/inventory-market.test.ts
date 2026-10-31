import { describe, expect, it, vi } from "vitest";
import {
  InventoryMarketService,
  assignedJson,
} from "../src/inventory/service.js";
import {
  parseRate,
  parseWallet,
  quoteFromBuyerCap,
  toMinorUnits,
} from "../src/inventory/money.js";

const steamId = "76561198000000000";
function walletData(overrides: Record<string, unknown> = {}) {
  return {
    wallet_currency: 1,
    wallet_country: "US",
    wallet_fee: 1,
    wallet_fee_percent: "0.05",
    wallet_fee_minimum: 1,
    wallet_fee_base: 0,
    wallet_publisher_fee_percent_default: "0.10",
    ...overrides,
  };
}
function inventory(assets = [asset("100", "10", "2")]) {
  return {
    success: 1,
    total_inventory_count: assets.length,
    assets,
    descriptions: [
      {
        classid: "10",
        instanceid: "0",
        name: "Trading card",
        type: "Card",
        market_hash_name: "123-A card / name",
        marketable: 1,
        tradable: 1,
        market_fee: "0.10",
      },
    ],
  };
}
function asset(assetid: string, classid = "10", amount = "1") {
  return {
    assetid,
    classid,
    instanceid: "0",
    appid: 753,
    contextid: "6",
    amount,
  };
}
function listing(listingid = "900", assetId = "200") {
  return {
    listingid,
    price: 100,
    fee: 15,
    currencyid: 2001,
    asset: {
      id: assetId,
      appid: 753,
      contextid: "6",
      amount: "1",
      name: "Listed card",
    },
  };
}
function harness() {
  const state = {
    inventory: inventory(),
    wallet: walletData(),
    price: "115",
    listings: [] as Record<string, unknown>[],
    now: 1_000_000,
    pending: false,
    throwSale: false,
    rejectSale: false,
    cancellationStale: false,
    pendingListings: [] as Record<string, unknown>[],
    pages: [] as ReturnType<typeof inventory>[],
  };
  const posts: { path: string; form?: Record<string, string> }[] = [];
  const json = (value: unknown) => Response.json(value);
  const request = vi.fn(
    async (
      _accountId: string,
      path: string,
      init?: { method?: "GET" | "POST"; form?: Record<string, string> },
    ): Promise<Response> => {
      if (init?.method === "POST") {
        posts.push({ path, ...(init.form ? { form: init.form } : {}) });
        if (state.throwSale)
          throw new Error("network interrupted after submission");
        if (path.startsWith("/market/removelisting/")) {
          if (!state.cancellationStale) state.listings = [];
          return json({});
        }
        if (state.rejectSale)
          return json({ success: false, message: "Steam Guard required" });
        return json({
          success: true,
          listingid: "999",
          needs_mobile_confirmation: state.pending,
        });
      }
      if (path.startsWith("/inventory/"))
        return json(state.pages.length ? state.pages.shift() : state.inventory);
      if (path.startsWith("/market/?"))
        return new Response(
          `<script>var g_rgWalletInfo = ${JSON.stringify(state.wallet)};</script>`,
        );
      if (path.startsWith("/market/mylistings?"))
        return json({
          success: true,
          num_active_listings: state.listings.length,
          listings: state.listings,
          listings_to_confirm: state.pendingListings,
          assets: [],
        });
      if (path.startsWith("/market/listings/"))
        return new Response("<script>Market_LoadOrderSpread(12345);</script>");
      if (path.startsWith("/market/itemordershistogram?"))
        return json({ success: 1, lowest_sell_order: state.price });
      throw new Error(`Unexpected path: ${path}`);
    },
  );
  const service = new InventoryMarketService({
    request,
    steamId: () => steamId,
    now: () => state.now,
  });
  return { state, request, posts, service };
}

describe("Steam market integer money", () => {
  it("calculates fees using seller proceeds and never exceeds the quoted buyer price", () => {
    const wallet = parseWallet(walletData());
    expect(quoteFromBuyerCap(115, wallet, "0.10")).toEqual({
      base: 100,
      steamFee: 5,
      publisherFee: 10,
      buyerPays: 115,
    });
    for (let cap = 3; cap < 300; cap++) {
      const quote = quoteFromBuyerCap(cap, wallet, "0.10");
      expect(quote.base + quote.steamFee + quote.publisherFee).toBe(
        quote.buyerPays,
      );
      expect(quote.buyerPays).toBeLessThanOrEqual(cap);
      expect(quote.steamFee).toBeGreaterThanOrEqual(1);
      expect(quote.publisherFee).toBeGreaterThanOrEqual(1);
    }
    expect(() => quoteFromBuyerCap(2, wallet, "0.10")).toThrow(/minimum fees/);
  });
  it("normalizes Steam hundredths to true JPY and KWD minor units", () => {
    const yen = parseWallet(
      walletData({
        wallet_currency: 8,
        wallet_country: "JP",
        wallet_market_minimum: 100,
        wallet_currency_increment: 100,
      }),
    );
    expect(yen.currency).toEqual({
      id: 8,
      code: "JPY",
      minorUnit: 0,
      priceStep: 1,
    });
    const quote = quoteFromBuyerCap(11500, yen, "0.10");
    expect(toMinorUnits(quote.buyerPays, yen.currency)).toBe(115);
    expect(toMinorUnits(quote.base, yen.currency)).toBe(100);
    const dinar = parseWallet(
      walletData({ wallet_currency: 38, wallet_country: "KW" }),
    );
    expect(dinar.currency.minorUnit).toBe(3);
    // One Steam hundredth is ten fils, so undercutting moves by 10 minor units.
    expect(dinar.currency.priceStep).toBe(10);
    expect(toMinorUnits(115, dinar.currency)).toBe(1150);
    expect(() => toMinorUnits(115, yen.currency)).toThrow(/precision/);
    expect(() =>
      parseWallet(walletData({ wallet_currency: 8, wallet_country: "JP" })),
    ).toThrow(/precision/);
  });
  it("uses wallet fee rounding, minimums, and per-item publisher fees", () => {
    const wallet = parseWallet(
      walletData({ wallet_market_minimum: 5, wallet_currency_increment: 5 }),
    );
    const quote = quoteFromBuyerCap(115, wallet, "0");
    expect(quote).toEqual({
      base: 110,
      steamFee: 5,
      publisherFee: 0,
      buyerPays: 115,
    });
    expect(() => parseRate("0.05evil")).toThrow();
    expect(() => parseRate("1.5")).toThrow();
    expect(() => parseWallet(walletData({ wallet_currency: 999 }))).toThrow(
      /currency/,
    );
  });
});

describe("inventory and explicit market actions", () => {
  it("fully paginates and joins descriptions without exposing private transport data", async () => {
    const { service, state, request, posts } = harness();
    state.pages = [
      {
        ...inventory([asset("100")]),
        total_inventory_count: 2,
        more_items: 1,
        last_assetid: "100",
      } as ReturnType<typeof inventory>,
      {
        ...inventory([asset("101")]),
        total_inventory_count: 2,
        descriptions: [],
      },
    ];
    const result = await service.inventory("account");
    expect(result.totalQuantity).toBe(2);
    expect(result.duplicateQuantity).toBe(1);
    expect(result.items.map((item) => item.duplicateQuantity)).toEqual([0, 1]);
    expect(result.items[0]).not.toHaveProperty("publisherFee");
    expect(request.mock.calls[1]![1]).toContain("start_assetid=100");
    expect(posts).toHaveLength(0);
  });
  it("requires full inventory, refuses missing descriptions and repeated cursors", async () => {
    const { service, state } = harness();
    state.inventory = { ...inventory(), descriptions: [] };
    await expect(service.inventory("a")).rejects.toThrow(/description/);
    state.pages = [1, 2].map(
      () =>
        ({ ...inventory(), more_items: 1, last_assetid: "100" }) as ReturnType<
          typeof inventory
        >,
    );
    await expect(service.inventory("a")).rejects.toThrow(/pagination/);
  });
  it("previews fees and submits only after explicit confirmation", async () => {
    const { service, posts, state } = harness();
    const preview = await service.previewSale("a", "browser", "100", 1);
    expect(preview).toMatchObject({
      buyerPaysPerItem: 115,
      sellerReceivesPerItem: 100,
      steamFeePerItem: 5,
      publisherFeePerItem: 10,
      totalSellerReceives: 100,
    });
    expect(posts).toHaveLength(0);
    state.pending = true;
    const result = await service.confirmSale("a", "browser", preview.token);
    expect(result.pendingConfirmation).toBe(true);
    expect(posts).toEqual([
      {
        path: "/market/sellitem/",
        form: {
          appid: "753",
          contextid: "6",
          assetid: "100",
          amount: "1",
          price: "100",
        },
      },
    ]);
    await expect(
      service.confirmSale("a", "browser", preview.token),
    ).rejects.toThrow(/invalid/);
    expect(posts).toHaveLength(1);
  });
  it("rejects fresh price or fee changes before sending a sale", async () => {
    const { service, posts, state } = harness();
    const preview = await service.previewSale("a", "browser", "100", 1);
    state.price = "116";
    await expect(
      service.confirmSale("a", "browser", preview.token),
    ).rejects.toThrow(/prices changed/);
    expect(posts).toHaveLength(0);
    const second = await service.previewSale("a", "browser", "100", 1);
    state.wallet.wallet_fee_percent = "0.06";
    await expect(
      service.confirmSale("a", "browser", second.token),
    ).rejects.toThrow(/fees changed/);
    expect(posts).toHaveLength(0);
  });
  it("binds expiring one-use previews to account and browser session", async () => {
    const { service, posts, state } = harness();
    const preview = await service.previewSale("a", "browser", "100", 1);
    await expect(
      service.confirmSale("b", "browser", preview.token),
    ).rejects.toThrow(/invalid/);
    await expect(
      service.confirmSale("a", "other browser", preview.token),
    ).rejects.toThrow(/invalid/);
    state.now += 60_001;
    await expect(
      service.confirmSale("a", "browser", preview.token),
    ).rejects.toThrow(/expired/);
    expect(posts).toHaveLength(0);
  });
  it("revalidates ownership, quantity, and the copy to preserve", async () => {
    const { service, state, posts } = harness();
    await expect(service.previewSale("a", "b", "100", 2)).rejects.toThrow(
      /Keep one/,
    );
    await expect(service.previewSale("a", "b", "999", 1)).rejects.toThrow(
      /no longer available/,
    );
    await expect(service.previewSale("a", "b", "100", -1)).rejects.toThrow(
      /no longer available/,
    );
    const preview = await service.previewSale("a", "b", "100", 1);
    state.inventory = inventory([asset("100", "10", "1")]);
    await expect(service.confirmSale("a", "b", preview.token)).rejects.toThrow(
      /Keep one/,
    );
    expect(posts).toHaveLength(0);
  });
  it("serializes concurrent confirmations and reserves inventory while Steam is stale", async () => {
    const { service, state, posts } = harness();
    state.inventory = inventory([asset("100"), asset("101")]);
    const first = await service.previewSale("a", "b", "100", 1);
    const second = await service.previewSale("a", "b", "101", 1);
    const results = await Promise.allSettled([
      service.confirmSale("a", "b", first.token),
      service.confirmSale("a", "b", second.token),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(posts).toHaveLength(1);
    await expect(service.previewSale("a", "b", "100", 1)).rejects.toThrow(
      /already been submitted/,
    );
    await expect(service.previewSale("a", "b", "101", 1)).rejects.toThrow(
      /Keep one/,
    );
  });
  it("frees the rest of a partly sold stack once Steam shows the sold copies gone", async () => {
    const { service, state, posts } = harness();
    state.inventory = inventory([asset("100", "10", "5")]);
    const first = await service.previewSale("a", "b", "100", 2);
    await service.confirmSale("a", "b", first.token);
    // Steam has not deducted the listed copies yet: the stack stays blocked.
    await expect(service.previewSale("a", "b", "100", 1)).rejects.toThrow(
      /already been submitted/,
    );
    state.inventory = inventory([asset("100", "10", "3")]);
    await service.inventory("a");
    const second = await service.previewSale("a", "b", "100", 2);
    await expect(
      service.confirmSale("a", "b", second.token),
    ).resolves.toMatchObject({ ok: true });
    expect(posts).toHaveLength(2);
  });
  it("allows a retry after Steam definitely rejected the listing", async () => {
    const { service, state, posts } = harness();
    const preview = await service.previewSale("a", "b", "100", 1);
    state.rejectSale = true;
    await expect(service.confirmSale("a", "b", preview.token)).rejects.toThrow(
      /Steam rejected the listing/,
    );
    state.rejectSale = false;
    const retry = await service.previewSale("a", "b", "100", 1);
    await expect(
      service.confirmSale("a", "b", retry.token),
    ).resolves.toMatchObject({ ok: true });
    expect(posts).toHaveLength(2);
  });
  it("does not blindly retry a submission after an ambiguous network failure", async () => {
    const { service, state, posts } = harness();
    const preview = await service.previewSale("a", "b", "100", 1);
    state.throwSale = true;
    await expect(service.confirmSale("a", "b", preview.token)).rejects.toThrow(
      /did not confirm/,
    );
    await expect(service.previewSale("a", "b", "100", 1)).rejects.toThrow(
      /uncertain/,
    );
    expect(posts).toHaveLength(1);
  });
  it("lists wallet prices and only cancels owned listings after confirmation", async () => {
    const { service, state, posts } = harness();
    state.listings = [listing()];
    const result = await service.listings("a");
    expect(result.listings[0]).toMatchObject({
      buyerPays: 115,
      sellerReceives: 100,
      listingId: "900",
    });
    await expect(service.previewCancellation("a", "b", "901")).rejects.toThrow(
      /no longer belongs/,
    );
    const preview = await service.previewCancellation("a", "b", "900");
    expect(posts).toHaveLength(0);
    expect(
      (await service.confirmCancellation("a", "b", preview.token)).ok,
    ).toBe(true);
    expect(posts[0]?.path).toBe("/market/removelisting/900");
    await expect(
      service.confirmCancellation("a", "b", preview.token),
    ).rejects.toThrow(/invalid/);
  });
  it("rechecks listing ownership and prevents selling an already listed asset", async () => {
    const { service, state, posts } = harness();
    state.listings = [listing("900", "100")];
    await expect(service.previewSale("a", "b", "100", 1)).rejects.toThrow(
      /already has/,
    );
    const preview = await service.previewCancellation("a", "b", "900");
    state.listings = [];
    await expect(
      service.confirmCancellation("a", "b", preview.token),
    ).rejects.toThrow(/no longer belongs/);
    expect(posts).toHaveLength(0);
  });
  it("uses Steam-converted wallet prices and accepts empty asset maps for pending listings", async () => {
    const { service, state } = harness();
    state.wallet.wallet_currency = 3;
    state.wallet.wallet_country = "DE";
    state.listings = [
      {
        ...listing(),
        converted_currencyid: 2003,
        converted_price: 95,
        converted_fee: 14,
      },
    ];
    state.pendingListings = [
      {
        ...listing("901", "201"),
        converted_currencyid: 2003,
        converted_price: 95,
        converted_fee: 14,
      },
    ];
    const result = await service.listings("a");
    expect(result.listings[1]?.pendingConfirmation).toBe(true);
    expect(result.currency?.code).toBe("EUR");
    expect(result.listings[0]).toMatchObject({
      sellerReceives: 95,
      buyerPays: 109,
    });
  });
  it("does not report cancellation success until the listing is absent", async () => {
    const { service, state, posts } = harness();
    state.listings = [listing()];
    state.cancellationStale = true;
    const preview = await service.previewCancellation("a", "b", "900");
    await expect(
      service.confirmCancellation("a", "b", preview.token),
    ).rejects.toThrow(/not confirmed/);
    expect(posts).toHaveLength(1);
  });
  it("rejects a partial inventory even if Steam reports the last page", async () => {
    const { service, state } = harness();
    state.inventory = { ...inventory(), total_inventory_count: 2 };
    await expect(service.inventory("a")).rejects.toThrow(
      /incomplete inventory/,
    );
  });
  it("extracts only JSON wallet information without executing scripts", () => {
    expect(
      assignedJson(
        'var g_rgWalletInfo = {"wallet_currency":1,"nested":{"text":"}\\\""}}; malicious();',
        "g_rgWalletInfo",
      ),
    ).toMatchObject({ wallet_currency: 1 });
    expect(() =>
      assignedJson("var g_rgWalletInfo = dangerous()", "g_rgWalletInfo"),
    ).toThrow();
    expect(() =>
      assignedJson("var g_rgWalletInfo = null;", "g_rgWalletInfo"),
    ).toThrow();
  });
});
