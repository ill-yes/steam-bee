import {
  DEFAULT_MARKET_PRICE_SETTINGS,
  marketRulesFingerprint,
  type InventoryItem,
  type InventoryPriceOverview,
  type InventorySnapshot,
  type MarketBatchPreview,
  type MarketBatchPreviewItem,
  type MarketSalePreview,
} from "@steam-bee/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { InventoryPanel } from "../src/features/inventory/InventoryPanel";
import { I18nProvider } from "../src/i18n";

vi.mock("../src/api", async (original) => ({
  ...(await original<typeof import("../src/api")>()),
  api: vi.fn(),
}));

const accountId = "variant-flow";
const base = `/api/accounts/${accountId}`;
const variantA = "753:6:111:0";
const variantB = "753:6:222:0";
const currency = { id: 1, code: "USD", minorUnit: 2 };
const rules = { ...DEFAULT_MARKET_PRICE_SETTINGS };

function asset(
  assetId: string,
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    assetId,
    variantId: variantA,
    name: "The Bee",
    marketHashName: "42-The Bee",
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

function inventory(
  items: InventoryItem[],
  fetchedAt = Date.now(),
): InventorySnapshot {
  return {
    appId: 753,
    contextId: "6",
    fetchedAt,
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    duplicateQuantity: items.reduce(
      (sum, item) => sum + item.duplicateQuantity,
      0,
    ),
  };
}

function threeAssets() {
  // Deliberately shuffled; the protected copy must never enter a sale request.
  return inventory([
    asset("13"),
    asset("11", { duplicateQuantity: 0 }),
    asset("12"),
  ]);
}

function priceOverview(
  snapshot: InventorySnapshot,
  variantIds: string[],
): InventoryPriceOverview {
  const observedAt = Date.now();
  return {
    accountId,
    inventoryFetchedAt: snapshot.fetchedAt,
    currency,
    priceMode: rules.priceMode,
    rulesFingerprint: marketRulesFingerprint(rules),
    walletFingerprint: "wallet:1:USD:2",
    rows: variantIds.map((variantId) => ({
      variantId,
      rawReferenceBuyerPrice: 115,
      estimate: { buyerPaysPerItem: 115, sellerReceivesPerItem: 100 },
      observedAt,
      freshUntil: observedAt + 60_000,
      displayUntil: observedAt + 300_000,
      stale: false,
      error: null,
      retryAt: null,
    })),
  };
}

type SaleAllocation = { assetId: string; quantity: number };

function setupApi(initial: InventorySnapshot) {
  let current = initial;
  const unknown: string[] = [];
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === `${base}/inventory`) return structuredClone(current);
    if (path === `${base}/market/listings`)
      return { fetchedAt: current.fetchedAt, currency, listings: [] };
    if (path === `${base}/market/settings`) return structuredClone(rules);
    if (path === `${base}/market/batches/active`) return null;
    if (path === `${base}/inventory/card-sets/42`)
      return {
        appId: 42,
        badgeLevel: 0,
        remainingDrops: 0,
        fetchedAt: Date.now(),
        cards: [
          { name: "The Bee", imageUrl: null, owned: 3 },
          { name: "Beekeeper", imageUrl: null, owned: 0 },
          { name: "Queen Bee", imageUrl: null, owned: 0 },
        ],
      };
    if (path === `${base}/inventory/price-overview`) {
      const request = JSON.parse(String(init?.body)) as {
        variantIds: string[];
      };
      return priceOverview(current, request.variantIds);
    }
    if (path === `${base}/market/preview`) {
      const request = JSON.parse(String(init?.body)) as SaleAllocation;
      const row = current.items.find(
        (item) => item.assetId === request.assetId,
      );
      if (!row || request.quantity > row.duplicateQuantity)
        throw new Error(
          "The sale request includes unavailable or protected stock.",
        );
      return {
        token: "single-reviewed-token",
        expiresAt: Date.now() + 60_000,
        assetId: row.assetId,
        name: row.name,
        quantity: request.quantity,
        buyerPaysPerItem: 115,
        sellerReceivesPerItem: 100,
        steamFeePerItem: 5,
        publisherFeePerItem: 10,
        totalBuyerPays: 115 * request.quantity,
        totalSellerReceives: 100 * request.quantity,
        currency,
      } satisfies MarketSalePreview;
    }
    if (path === `${base}/market/batch-preview`) {
      const request = JSON.parse(String(init?.body)) as {
        kind: "sale";
        items: SaleAllocation[];
      };
      const rows = request.items.map((allocation): MarketBatchPreviewItem => {
        const row = current.items.find(
          (item) => item.assetId === allocation.assetId,
        );
        if (!row || allocation.quantity > row.duplicateQuantity)
          throw new Error("The batch includes unavailable or protected stock.");
        return {
          assetId: row.assetId,
          ...(row.variantId ? { variantId: row.variantId } : {}),
          listingId: null,
          name: row.name,
          quantity: allocation.quantity,
          buyerPays: 115 * allocation.quantity,
          sellerReceives: 100 * allocation.quantity,
          steamFee: 5 * allocation.quantity,
          publisherFee: 10 * allocation.quantity,
          status: "ready",
          message: null,
        };
      });
      return {
        token: "batch-reviewed-token",
        expiresAt: Date.now() + 60_000,
        kind: "sale",
        currency,
        items: rows,
        totalBuyerPays: rows.reduce((sum, row) => sum + row.buyerPays!, 0),
        totalSellerReceives: rows.reduce(
          (sum, row) => sum + row.sellerReceives!,
          0,
        ),
        delaySeconds: rules.delaySeconds,
      } satisfies MarketBatchPreview;
    }
    unknown.push(path);
    throw new Error(`Unexpected endpoint: ${path}`);
  });
  return {
    unknown,
    replaceInventory: (snapshot: InventorySnapshot) => {
      current = snapshot;
    },
  };
}

function saleRequests() {
  return vi
    .mocked(api)
    .mock.calls.filter(([path]) =>
      /\/market\/(?:preview|batch-preview|confirm|batch-confirm)$/.test(path),
    );
}

const tileName = (name: string) => new RegExp(`^${name}, \\d+ in inventory`);
const tile = (name = "The Bee") =>
  screen.getByRole("button", { name: tileName(name) });
const basket = () =>
  within(screen.getByRole("complementary", { name: "Sell basket" }));
const basketQuantity = (name = "The Bee") =>
  basket().getByRole("status", { name: `Quantity for ${name}` });

async function renderPanel(name = "The Bee") {
  render(<InventoryPanel accountId={accountId} />, { wrapper: I18nProvider });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: tileName(name) })).toBeEnabled(),
  );
}

describe("inventory variant sale flows with real asset allocations", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    const values = new Map([["steam-bee-locale", "en"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      } satisfies Storage,
    });
  });
  afterEach(cleanup);

  it("shows three single-copy assets as one tile and reviews exactly the two eligible assets as a batch", async () => {
    const harness = setupApi(threeAssets());
    await renderPanel();
    expect(
      screen.getAllByRole("button", { name: tileName("The Bee") }),
    ).toHaveLength(1);
    expect(tile()).toHaveTextContent("×3");
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `${base}/inventory/price-overview`,
        expect.objectContaining({
          body: JSON.stringify({ variantIds: [variantA] }),
        }),
      ),
    );
    await waitFor(() => expect(tile()).toHaveTextContent("+$1.00"));
    expect(
      screen.getByRole("listitem", { name: "Queen Bee, missing from the set" }),
    ).toBeVisible();
    expect(saleRequests()).toHaveLength(0);

    fireEvent.click(tile());
    expect(basketQuantity()).toHaveTextContent("2");
    expect(basket().getByText("1 stays")).toBeVisible();
    expect(basket().getByText("$2.30")).toBeVisible();
    expect(basket().getByText("$0.30")).toBeVisible();
    expect(basket().getAllByText("$2.00")).toHaveLength(2);
    expect(
      await basket().findByText("2 Steam actions · 10 s apart"),
    ).toBeVisible();
    fireEvent.click(basket().getByRole("button", { name: "Review sale" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Review duplicate sales",
    });
    expect(api).toHaveBeenCalledWith(
      `${base}/market/batch-preview`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          kind: "sale",
          items: [
            { assetId: "12", quantity: 1 },
            { assetId: "13", quantity: 1 },
          ],
        }),
      }),
    );
    expect(
      within(dialog).getAllByRole("group", { name: "The Bee" }),
    ).toHaveLength(1);
    expect(saleRequests().map(([path]) => path)).toEqual([
      `${base}/market/batch-preview`,
    ]);
    expect(harness.unknown).toEqual([]);
  });

  it("uses the latest basket quantity and real eligible asset for an individual preview", async () => {
    setupApi(threeAssets());
    await renderPanel();
    fireEvent.click(tile());
    fireEvent.click(
      basket().getByRole("button", { name: "Sell one fewer The Bee" }),
    );
    expect(basketQuantity()).toHaveTextContent("1");
    fireEvent.click(basket().getByRole("button", { name: "Review sale" }));
    await screen.findByRole("alertdialog", { name: "Review market sale" });
    expect(api).toHaveBeenCalledWith(
      `${base}/market/preview`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ assetId: "12", quantity: 1 }),
      }),
    );
    expect(saleRequests().map(([path]) => path)).toEqual([
      `${base}/market/preview`,
    ]);
  });

  it("clamps the basket after a refresh reduces stock and only previews the remaining eligible asset", async () => {
    const initial = threeAssets();
    const harness = setupApi(initial);
    await renderPanel();
    fireEvent.click(tile());
    expect(basketQuantity()).toHaveTextContent("2");
    harness.replaceInventory(
      inventory(
        [asset("11", { duplicateQuantity: 0 }), asset("13")],
        initial.fetchedAt + 1,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    await waitFor(() => expect(tile()).toHaveTextContent("×2"));
    await waitFor(() => expect(basketQuantity()).toHaveTextContent("1"));
    expect(
      basket().getByRole("button", { name: "Sell one more The Bee" }),
    ).toBeDisabled();
    expect(saleRequests()).toHaveLength(0);
    fireEvent.click(basket().getByRole("button", { name: "Review sale" }));
    await screen.findByRole("alertdialog", { name: "Review market sale" });
    expect(api).toHaveBeenCalledWith(
      `${base}/market/preview`,
      expect.objectContaining({
        body: JSON.stringify({ assetId: "13", quantity: 1 }),
      }),
    );
    expect(saleRequests()).toHaveLength(1);
  });

  it("adds a game's extras as three copies and three real market actions", async () => {
    setupApi(
      inventory([
        ...threeAssets().items,
        asset("21", {
          variantId: variantB,
          name: "Beekeeper",
          duplicateQuantity: 0,
        }),
        asset("22", { variantId: variantB, name: "Beekeeper" }),
      ]),
    );
    await renderPanel();
    expect(
      screen.queryByRole("listitem", { name: /^Beekeeper, missing/ }),
    ).toBeNull();
    fireEvent.click(
      within(screen.getByRole("article", { name: "Bee Game" })).getByRole(
        "button",
        { name: "Add extras to basket" },
      ),
    );
    expect(basket().getByText("2 items · 3 copies")).toBeVisible();
    expect(
      await basket().findByText("3 Steam actions · 10 s apart"),
    ).toBeVisible();
    fireEvent.click(basket().getByRole("button", { name: "Review sale" }));
    await screen.findByRole("alertdialog", { name: "Review duplicate sales" });
    expect(api).toHaveBeenCalledWith(
      `${base}/market/batch-preview`,
      expect.objectContaining({
        body: JSON.stringify({
          kind: "sale",
          items: [
            { assetId: "22", quantity: 1 },
            { assetId: "12", quantity: 1 },
            { assetId: "13", quantity: 1 },
          ],
        }),
      }),
    );
    expect(saleRequests()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(
      within(screen.getByRole("article", { name: "Bee Game" })).getByRole(
        "button",
        { name: "Remove from basket" },
      ),
    );
    expect(basket().getByText("0 items · 0 copies")).toBeVisible();
  });

  it("caps a single variant needing 51 allocations at 50 actions and says so", async () => {
    setupApi(
      inventory([
        asset("1000", { duplicateQuantity: 0 }),
        ...Array.from({ length: 51 }, (_, index) =>
          asset(String(index + 1001)),
        ),
      ]),
    );
    await renderPanel();
    fireEvent.click(tile());
    expect(basketQuantity()).toHaveTextContent("50");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "At most 50 Steam actions fit in one batch.",
    );
    expect(
      basket().getByRole("button", { name: "Sell one more The Bee" }),
    ).toBeDisabled();
    expect(
      await basket().findByText("50 Steam actions · 10 s apart"),
    ).toBeVisible();
    expect(saleRequests()).toHaveLength(0);
    fireEvent.click(basket().getByRole("button", { name: "Review sale" }));
    await screen.findByRole("alertdialog", { name: "Review duplicate sales" });
    const request = saleRequests()[0]!;
    expect(JSON.parse(String(request[1]?.body)).items).toHaveLength(50);
  });

  it("fills a game needing 52 allocations only up to the 50-action limit", async () => {
    const rows = [
      asset("1000", { duplicateQuantity: 0 }),
      ...Array.from({ length: 26 }, (_, index) => asset(String(index + 1001))),
      asset("2000", {
        variantId: variantB,
        name: "Beekeeper",
        duplicateQuantity: 0,
      }),
      ...Array.from({ length: 26 }, (_, index) =>
        asset(String(index + 2001), {
          variantId: variantB,
          name: "Beekeeper",
        }),
      ),
    ];
    setupApi(inventory(rows));
    await renderPanel();
    fireEvent.click(
      within(screen.getByRole("article", { name: "Bee Game" })).getByRole(
        "button",
        { name: "Add extras to basket" },
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "At most 50 Steam actions fit in one batch.",
    );
    expect(basketQuantity("Beekeeper")).toHaveTextContent("26");
    expect(basketQuantity("The Bee")).toHaveTextContent("24");
    expect(
      await basket().findByText("50 Steam actions · 10 s apart"),
    ).toBeVisible();
    expect(saleRequests()).toHaveLength(0);
  });
});
