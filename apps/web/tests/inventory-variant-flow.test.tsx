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

async function renderPanel(name = "The Bee") {
  render(<InventoryPanel accountId={accountId} />, { wrapper: I18nProvider });
  const card = await screen.findByRole("article", { name });
  await waitFor(() =>
    expect(
      within(card).getByRole("button", { name: `Preview sale: ${name}` }),
    ).toBeEnabled(),
  );
  return card;
}

function quantity(card: HTMLElement, name = "The Bee") {
  return within(card).getByRole("spinbutton", { name: `Quantity: ${name}` });
}

function setQuantity(card: HTMLElement, value: string, name = "The Bee") {
  fireEvent.change(quantity(card, name), { target: { value } });
}

function previewCard(card: HTMLElement, name = "The Bee") {
  return within(card).getByRole("button", { name: `Preview sale: ${name}` });
}

function metric(card: HTMLElement, label: string) {
  return within(card).getByText(label, { selector: "dt" }).nextElementSibling;
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

  it("shows three single-copy assets as one card and reviews exactly the two eligible assets as a batch", async () => {
    const harness = setupApi(threeAssets());
    const card = await renderPanel();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(metric(card, "In inventory")).toHaveTextContent(/^3$/);
    expect(metric(card, "Additional copies")).toHaveTextContent(/^2$/);
    expect(quantity(card)).toHaveAttribute("max", "2");
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `${base}/inventory/price-overview`,
        expect.objectContaining({
          body: JSON.stringify({ variantIds: [variantA] }),
        }),
      ),
    );
    await waitFor(() =>
      expect(within(card).getAllByText("$1.15")).toHaveLength(2),
    );
    expect(saleRequests()).toHaveLength(0);

    setQuantity(card, "2");
    expect(
      within(card).getByText("After the sale: 1 copy remains."),
    ).toBeVisible();
    fireEvent.click(previewCard(card));
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

  it("uses the latest one-copy quantity and real eligible asset for an individual preview", async () => {
    setupApi(threeAssets());
    const card = await renderPanel();
    setQuantity(card, "2");
    setQuantity(card, "1");
    fireEvent.click(previewCard(card));
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

  it.each(["", "3"])(
    "does not replay a previous valid quantity after changing the draft to %j",
    async (invalid) => {
      setupApi(threeAssets());
      const card = await renderPanel();
      setQuantity(card, "2");
      fireEvent.click(
        within(card).getByRole("checkbox", { name: "Select The Bee" }),
      );
      setQuantity(card, invalid);
      expect(quantity(card)).toHaveAttribute("aria-invalid", "true");
      expect(previewCard(card)).toBeDisabled();
      const bulk = screen.getByRole("button", {
        name: "Preview selected sales",
      });
      expect(bulk).toBeDisabled();
      fireEvent.click(previewCard(card));
      fireEvent.click(bulk);
      expect(saleRequests()).toHaveLength(0);
    },
  );

  it("revalidates a saved quantity after refresh reduces stock and only previews the remaining eligible asset after correction", async () => {
    const initial = threeAssets();
    const harness = setupApi(initial);
    const card = await renderPanel();
    setQuantity(card, "2");
    fireEvent.click(
      within(card).getByRole("checkbox", { name: "Select The Bee" }),
    );
    harness.replaceInventory(
      inventory(
        [asset("11", { duplicateQuantity: 0 }), asset("13")],
        initial.fetchedAt + 1,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    await waitFor(() =>
      expect(metric(card, "In inventory")).toHaveTextContent(/^2$/),
    );
    expect(quantity(card)).toHaveValue(2);
    expect(quantity(card)).toHaveAttribute("max", "1");
    expect(quantity(card)).toHaveAttribute("aria-invalid", "true");
    expect(previewCard(card)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Preview selected sales" }),
    ).toBeDisabled();
    expect(saleRequests()).toHaveLength(0);

    setQuantity(card, "1");
    expect(previewCard(card)).toBeEnabled();
    fireEvent.click(previewCard(card));
    await screen.findByRole("alertdialog", { name: "Review market sale" });
    expect(api).toHaveBeenCalledWith(
      `${base}/market/preview`,
      expect.objectContaining({
        body: JSON.stringify({ assetId: "13", quantity: 1 }),
      }),
    );
    expect(saleRequests()).toHaveLength(1);
  });

  it("counts two selected variants as three copies and three real market actions", async () => {
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
    const card = await renderPanel();
    setQuantity(card, "2");
    fireEvent.click(
      screen.getByRole("button", { name: "Select filtered duplicates" }),
    );
    expect(screen.getByText("Selected variants: 2")).toBeVisible();
    expect(screen.getByText("Selected copies: 3")).toBeVisible();
    expect(screen.getByText("3 of 50 market actions")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview selected sales" }),
    );
    await screen.findByRole("alertdialog", { name: "Review duplicate sales" });
    expect(api).toHaveBeenCalledWith(
      `${base}/market/batch-preview`,
      expect.objectContaining({
        body: JSON.stringify({
          kind: "sale",
          items: [
            { assetId: "12", quantity: 1 },
            { assetId: "13", quantity: 1 },
            { assetId: "22", quantity: 1 },
          ],
        }),
      }),
    );
    expect(saleRequests()).toHaveLength(1);
  });

  it("blocks a single variant requiring 51 actual allocations before either preview endpoint is called", async () => {
    setupApi(
      inventory([
        asset("1000", { duplicateQuantity: 0 }),
        ...Array.from({ length: 51 }, (_, index) =>
          asset(String(index + 1001)),
        ),
      ]),
    );
    const card = await renderPanel();
    fireEvent.click(
      within(card).getByRole("checkbox", { name: "Select The Bee" }),
    );
    setQuantity(card, "51");
    expect(quantity(card)).toHaveValue(51);
    expect(
      within(card).getByText(
        "This quantity would exceed 50 market actions. Reduce the quantity before reviewing the sale.",
      ),
    ).toBeVisible();
    expect(previewCard(card)).toBeDisabled();
    const bulk = screen.getByRole("button", { name: "Preview selected sales" });
    expect(bulk).toBeDisabled();
    fireEvent.click(previewCard(card));
    fireEvent.click(bulk);
    expect(saleRequests()).toHaveLength(0);
  });

  it("rejects a filtered selection needing 52 allocations rather than silently selecting a 50-action subset", async () => {
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
    const card = await renderPanel();
    const other = screen.getByRole("article", { name: "Beekeeper" });
    setQuantity(card, "26");
    setQuantity(other, "26", "Beekeeper");
    fireEvent.click(
      screen.getByRole("button", { name: "Select filtered duplicates" }),
    );
    expect(screen.getByText("Selected variants: 0")).toBeVisible();
    expect(
      screen.getByText(
        "This selection needs 52 market actions. A batch supports up to 50. Reduce the quantity or selection; nothing was added.",
      ),
    ).toBeVisible();
    expect(
      within(card).getByRole("checkbox", { name: "Select The Bee" }),
    ).not.toBeChecked();
    expect(
      within(other).getByRole("checkbox", { name: "Select Beekeeper" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Preview selected sales" }),
    ).not.toBeInTheDocument();
    expect(saleRequests()).toHaveLength(0);
  });
});
