import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  InventorySnapshot,
  MarketBatchJob,
  MarketBatchPreview,
  MarketPriceSettings,
} from "@steam-bee/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { InventoryPanel } from "../src/features/inventory/InventoryPanel";
import { InventorySetBrowser } from "../src/features/inventory/InventorySetBrowser";
import { buildInventoryVariants } from "../src/features/inventory/inventory-model";
import { I18nProvider } from "../src/i18n";

vi.mock("../src/api", async (original) => ({
  ...(await original<typeof import("../src/api")>()),
  api: vi.fn(),
}));
const currency = { id: 1, code: "USD", minorUnit: 2 };
const rules: MarketPriceSettings = {
  priceMode: "lowestSellOrder",
  adjustment: 0,
  minBuyerPrice: null,
  maxBuyerPrice: null,
  delaySeconds: 10,
  currencyId: null,
};
const inventory: InventorySnapshot = {
  appId: 753,
  contextId: "6",
  fetchedAt: Date.now(),
  totalQuantity: 7,
  duplicateQuantity: 4,
  items: [
    {
      assetId: "card",
      name: "Bee card",
      marketHashName: "Bee card",
      type: "Trading Card",
      iconUrl:
        "https://community.akamai.steamstatic.com/economy/image/bee/96fx96f",
      quantity: 3,
      duplicateQuantity: 2,
      marketable: true,
      tradable: true,
      gameAppId: 10,
      gameName: "Bee Quest",
      category: "card",
      cardKind: "normal",
    },
    {
      assetId: "foil",
      name: "Shiny Bee",
      marketHashName: "Shiny Bee",
      type: "Foil Trading Card",
      iconUrl: null,
      quantity: 2,
      duplicateQuantity: 1,
      marketable: true,
      tradable: true,
      gameAppId: 10,
      gameName: "Bee Quest",
      category: "card",
      cardKind: "foil",
    },
    {
      assetId: "background",
      name: "Hive profile",
      marketHashName: "Hive profile",
      type: "Profile Background",
      iconUrl: null,
      quantity: 2,
      duplicateQuantity: 1,
      marketable: true,
      tradable: false,
      gameAppId: 20,
      gameName: "Hive World",
      category: "background",
      cardKind: null,
    },
  ],
};
const market = {
  fetchedAt: Date.now(),
  currency,
  listings: [
    {
      listingId: "listing1",
      assetId: "listed",
      name: "Listed card",
      quantity: 1,
      buyerPays: 115,
      sellerReceives: 100,
      pendingConfirmation: false,
    },
  ],
};
const cardSet = {
  appId: 10,
  badgeLevel: 2,
  remainingDrops: 1,
  fetchedAt: Date.now(),
  cards: [
    { name: "Bee card", imageUrl: null, owned: 3 },
    {
      name: "Wasp card",
      imageUrl:
        "https://community.akamai.steamstatic.com/economy/image/wasp/96fx96f",
      owned: 0,
    },
  ],
};
const tileName = (name: string) => new RegExp(`^${name}, \\d+ in inventory`);
const tile = (name = "Bee card") =>
  screen.getByRole("button", { name: tileName(name) });
const reviewButton = () => screen.getByRole("button", { name: "Review sale" });
const game = (name: string) => within(screen.getByRole("article", { name }));
function preview(kind: "sale" | "cancel" = "sale"): MarketBatchPreview {
  return {
    token: "batch-token",
    kind,
    expiresAt: Date.now() + 60_000,
    currency: kind === "sale" ? currency : null,
    delaySeconds: 7,
    totalBuyerPays: 230,
    totalSellerReceives: 200,
    items: [
      {
        assetId: kind === "sale" ? "card" : null,
        listingId: kind === "cancel" ? "listing1" : null,
        name: kind === "sale" ? "Bee card" : "Listed card",
        quantity: 2,
        buyerPays: 230,
        sellerReceives: 200,
        steamFee: 10,
        publisherFee: 20,
        status: "ready",
        message: null,
      },
    ],
  };
}
function job(status: MarketBatchJob["status"] = "waiting"): MarketBatchJob {
  return {
    id: "job1",
    kind: "sale",
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nextActionAt: Date.now() + 7000,
    completedCount: status === "completed" ? 1 : 0,
    totalCount: 1,
    stopRequested: status === "stopped",
    items: [
      {
        assetId: "card",
        listingId: null,
        name: "Bee card",
        quantity: 2,
        status:
          status === "completed"
            ? "pending_confirmation"
            : status === "stopped"
              ? "skipped"
              : "queued",
        message: null,
      },
    ],
  };
}
function setup(
  overrides: (path: string, init?: RequestInit) => unknown = () => undefined,
) {
  vi.mocked(api).mockImplementation(async (path, init) => {
    const result = overrides(path, init);
    if (result !== undefined) return await result;
    if (path.endsWith("/inventory")) return inventory;
    if (path.endsWith("/market/listings")) return market;
    if (path.endsWith("/market/settings"))
      return init?.body ? JSON.parse(String(init.body)) : rules;
    if (path.endsWith("/market/batches/active")) return null;
    if (path.endsWith("/inventory/card-sets/10")) return cardSet;
    if (path.endsWith("/market/batch-preview"))
      return preview(JSON.parse(String(init?.body)).kind);
    if (path.endsWith("/market/batch-confirm")) return job();
    if (path.endsWith("/market/batches/job1/stop")) return job("stopped");
    if (path.endsWith("/market/batches/job1")) return job("completed");
    throw new Error(`Unexpected request: ${path}`);
  });
}
const showInventory = () =>
  fireEvent.click(screen.getByRole("tab", { name: /^Inventory(?:\s*\d+)?$/ }));
const showMarket = () =>
  fireEvent.click(
    screen.getByRole("tab", { name: /^Market listings(?:\s*\d+)?$/ }),
  );
const renderPanel = (
  accountId = "first",
  view: "inventory" | "listings" = "inventory",
) => {
  const result = render(<InventoryPanel accountId={accountId} />, {
    wrapper: I18nProvider,
  });
  if (view === "listings") showMarket();
  return result;
};

describe("grouped inventory and batch market tools", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    vi.mocked(api).mockReset();
    setup();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports only intersecting tiles to the price reader and clears them on unmount", async () => {
    let notify!: IntersectionObserverCallback;
    let options: IntersectionObserverInit | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: IntersectionObserverCallback,
          init: IntersectionObserverInit,
        ) {
          notify = callback;
          options = init;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    try {
      const onVisible = vi.fn();
      const view = render(
        <InventorySetBrowser
          accountId="first"
          variants={buildInventoryVariants(inventory.items)}
          basket={{}}
          prices={{}}
          disabled={false}
          now={Date.now()}
          onToggle={vi.fn()}
          onAddGame={vi.fn()}
          onRemoveGame={vi.fn()}
          onVisibleVariantsChange={onVisible}
        />,
        { wrapper: I18nProvider },
      );
      const card = await screen.findByRole("button", {
        name: tileName("Bee card"),
      });
      const entry = (isIntersecting: boolean): IntersectionObserverEntry => ({
        target: card,
        isIntersecting,
        boundingClientRect: card.getBoundingClientRect(),
        intersectionRect: card.getBoundingClientRect(),
        intersectionRatio: isIntersecting ? 1 : 0,
        rootBounds: null,
        time: performance.now(),
      });
      expect(observe).toHaveBeenCalledTimes(3);
      expect(options?.root).toBeNull();
      expect(onVisible).not.toHaveBeenCalled();
      act(() => notify([entry(true)], {} as IntersectionObserver));
      expect(onVisible).toHaveBeenLastCalledWith(["asset:card"]);
      act(() => notify([entry(false)], {} as IntersectionObserver));
      expect(onVisible).toHaveBeenLastCalledWith([]);
      view.unmount();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(onVisible).toHaveBeenLastCalledWith([]);
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("starts with cards and reveals market listings and rules through the named tool tabs", async () => {
    renderPanel();
    expect(await screen.findByText("Bee card")).toBeVisible();
    expect(screen.getByText("Listed card")).not.toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Minimum buyer price" }),
    ).not.toBeInTheDocument();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/market/settings")),
    ).toBe(false);
    showMarket();
    expect(screen.getByText("Listed card")).toBeVisible();
    expect(screen.getByText("Bee card")).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    expect(
      await screen.findByRole("textbox", { name: "Minimum buyer price" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Pricing rules" }),
    ).not.toBeInTheDocument();
    expect(
      vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });

  it("explains the basket and enables a reviewed sale only once something is in it", async () => {
    renderPanel();
    await screen.findByText("Bee card");
    const basket = within(
      screen.getByRole("complementary", { name: "Sell basket" }),
    );
    expect(
      basket.getByText(/One copy of each item always stays\./),
    ).toBeVisible();
    expect(
      basket.getByText(/You review prices and fees before anything is listed/),
    ).toBeVisible();
    expect(reviewButton()).toBeDisabled();
    expect(
      basket.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
    fireEvent.click(tile());
    expect(reviewButton()).toBeEnabled();
    fireEvent.click(basket.getByRole("button", { name: "Clear" }));
    expect(reviewButton()).toBeDisabled();
    expect(tile()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(basket.getByRole("button", { name: "Edit pricing rules" }));
    expect(
      await screen.findByRole("textbox", { name: "Minimum buyer price" }),
    ).toBeVisible();
  });

  it("reveals cancellation batch actions after selection and restores the compact toolbar when cleared", async () => {
    renderPanel("first", "listings");
    const checkbox = await screen.findByRole("checkbox", {
      name: "Select Listed card",
    });
    expect(
      screen.queryByRole("button", { name: "Clear selection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview selected cancellations" }),
    ).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(
      screen.getByRole("button", { name: "Preview selected cancellations" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(
      screen.queryByRole("button", { name: "Preview selected cancellations" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select Listed card" }),
    ).not.toBeChecked();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select filtered listings" }),
      ).toHaveFocus(),
    );
  });

  it("keeps an unsaved draft across internal views even when browser storage is unavailable", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Minimum buyer price" }),
      { target: { value: "0.35" } },
    );
    showMarket();
    expect(
      screen.getByRole("button", { name: "Cancel listing: Listed card" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Review pricing rules" }),
    ).toBeVisible();
    showInventory();
    fireEvent.click(tile());
    expect(reviewButton()).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Review pricing rules" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Minimum buyer price" }),
    ).toHaveValue("0.35");
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path.endsWith("/market/settings")),
    ).toHaveLength(1);
  });

  it("keeps server batch progress and stop controls visible across every internal view", async () => {
    setup((path) => (path.endsWith("/batches/active") ? job() : undefined));
    renderPanel();
    await screen.findByRole("button", { name: "Stop remaining actions" });
    for (const label of [/^Market listings/, /^Pricing rules/, /^Inventory/]) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      expect(
        screen.getByRole("region", { name: "Batch progress" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Stop remaining actions" }),
      ).toBeEnabled();
    }
    expect(
      vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });

  it("filters item types with chips and restores everything with All", async () => {
    renderPanel();
    await screen.findByText("Bee card");
    const types = within(screen.getByRole("group", { name: "Item type" }));
    fireEvent.click(types.getByRole("button", { name: "Foil cards" }));
    expect(types.getByRole("button", { name: "Foil cards" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(tile("Shiny Bee")).toBeVisible();
    expect(screen.queryByText("Bee card")).not.toBeInTheDocument();
    expect(screen.queryByText("Hive World")).not.toBeInTheDocument();
    fireEvent.click(types.getByRole("button", { name: "Backgrounds" }));
    expect(tile("Hive profile")).toBeVisible();
    expect(screen.queryByText("Shiny Bee")).not.toBeInTheDocument();
    fireEvent.click(types.getByRole("button", { name: "All" }));
    expect(tile("Bee card")).toBeVisible();
    expect(tile("Hive profile")).toBeVisible();
  });

  it("shows each game as a card set with badge progress, missing cards and separate rows", async () => {
    const { container } = renderPanel();
    await screen.findByText("Bee card");
    expect(
      screen
        .getAllByRole("article")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Bee Quest", "Hive World"]);
    const bee = game("Bee Quest");
    expect(await bee.findByText("1 of 2 cards")).toBeVisible();
    expect(bee.getByText("Badge level 2")).toBeVisible();
    expect(bee.getByText("1 drops left")).toBeVisible();
    expect(
      bee.getByRole("progressbar", { name: "1 of 2 cards" }),
    ).toHaveAttribute("value", "1");
    const set = bee.getByRole("list", {
      name: "Bee Quest: Card set",
    });
    expect(
      within(set)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Bee card"),
      expect.stringContaining("Wasp card"),
    ]);
    expect(
      bee.getByRole("listitem", { name: "Wasp card, missing from the set" }),
    ).toHaveTextContent("Missing");
    expect(
      bee.getByRole("list", {
        name: "Bee Quest: Foil cards",
      }),
    ).toHaveTextContent("Shiny Bee");
    expect(
      game("Hive World").getByRole("list", {
        name: "Hive World: Other items",
      }),
    ).toHaveTextContent("Hive profile");
    expect(
      vi.mocked(api).mock.calls.filter(([path]) => path.includes("card-sets")),
    ).toEqual([
      ["/api/accounts/first/inventory/card-sets/10", expect.anything()],
    ]);

    const art = container.querySelector<HTMLImageElement>(
      'img[src*="economy/image/bee"]',
    )!;
    expect(art).toHaveClass("object-contain");
    const artFrame = art.parentElement!;
    fireEvent.error(art);
    expect(artFrame.querySelector("img")).toBeNull();
    expect(artFrame.querySelector("svg")).not.toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Only extras" }));
    expect(screen.queryByText("Wasp card")).not.toBeInTheDocument();
  });

  it("adds a game’s extras to the basket and reviews totals before any explicit batch submission", async () => {
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(
      game("Bee Quest").getByRole("button", { name: "Add extras to basket" }),
    );
    expect(screen.getByText("2 items · 3 copies")).toBeVisible();
    fireEvent.click(reviewButton());
    const dialog = await screen.findByRole("alertdialog", {
      name: "Review duplicate sales",
    });
    expect(api).toHaveBeenCalledWith(
      "/api/accounts/first/market/batch-preview",
      expect.objectContaining({
        body: JSON.stringify({
          kind: "sale",
          items: [
            { assetId: "card", quantity: 2 },
            { assetId: "foil", quantity: 1 },
          ],
        }),
      }),
    );
    expect(within(dialog).getAllByText("$2.30")[0]).toBeVisible();
    expect(within(dialog).getAllByText("$2.00")[0]).toBeVisible();
    expect(
      within(dialog).getAllByText("Total fees").at(-1)!.nextElementSibling,
    ).toHaveTextContent("$0.30");
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/batch-confirm")),
    ).toBe(false);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm selected sales" }),
    );
    expect(
      await screen.findByRole("region", { name: "Batch progress" }),
    ).toBeVisible();
    expect(api).toHaveBeenCalledWith(
      "/api/accounts/first/market/batch-confirm",
      expect.objectContaining({
        body: JSON.stringify({ token: "batch-token" }),
      }),
    );
    expect(tile()).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Stop remaining actions" }),
    );
    await screen.findByText("Stopped");
    expect(screen.getByText("Skipped: 1")).toBeVisible();
    expect(api).toHaveBeenCalledWith(
      "/api/accounts/first/market/batches/job1/stop",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("marks unavailable preview rows and prevents submitting an entirely unquotable selection", async () => {
    setup((path) =>
      path.endsWith("/batch-preview")
        ? {
            ...preview(),
            items: [
              {
                ...preview().items[0]!,
                status: "unavailable",
                message: "No market quote is available.",
              },
            ],
          }
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(
      game("Bee Quest").getByRole("button", { name: "Add extras to basket" }),
    );
    fireEvent.click(reviewButton());
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        /Inventory ID: card · No market quote is available\./,
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Confirm selected sales" }),
    ).toBeDisabled();
  });

  it("previews selected listing cancellations independently from sales", async () => {
    renderPanel("first", "listings");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select Listed card" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview selected cancellations" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Review listing cancellations",
    });
    expect(api).toHaveBeenCalledWith(
      "/api/accounts/first/market/batch-preview",
      expect.objectContaining({
        body: JSON.stringify({ kind: "cancel", listingIds: ["listing1"] }),
      }),
    );
    expect(
      within(dialog).queryByText(/matching buy order/),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: "Confirm selected cancellations",
      }),
    ).toBeEnabled();
  });

  it("restores a server job on reopening and polls pending confirmation without resubmitting", async () => {
    vi.useFakeTimers();
    setup((path) => (path.endsWith("/batches/active") ? job() : undefined));
    await act(async () => {
      renderPanel();
    });
    expect(
      screen.getByRole("button", { name: "Stop remaining actions" }),
    ).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Steam confirmation required: 1")).toBeVisible();
    expect(
      screen.getByText(
        "Confirm this in the Steam Mobile app or by email. SteamBee notices the confirmation automatically.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Dismiss completed batch" }),
    ).toBeVisible();
    expect(
      vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });

  it("recovers an accepted job after a lost confirmation response and never retries the mutation", async () => {
    let accepted = false;
    setup((path) => {
      if (path.endsWith("/batches/active")) return accepted ? job() : null;
      if (path.endsWith("/batch-confirm")) {
        accepted = true;
        return Promise.reject(new Error("Response lost"));
      }
      return undefined;
    });
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(
      game("Bee Quest").getByRole("button", { name: "Add extras to basket" }),
    );
    fireEvent.click(reviewButton());
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm selected sales" }),
    );
    await screen.findByRole("button", { name: "Stop remaining actions" });
    expect(screen.getByText("Response lost")).toBeVisible();
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path.endsWith("/batch-confirm")),
    ).toHaveLength(1);
  });

  it("explains and closes an individual preview superseded by a late running-batch restore", async () => {
    let restore!: (value: MarketBatchJob) => void;
    setup((path) => {
      if (path.endsWith("/batches/active"))
        return new Promise<MarketBatchJob>((resolve) => {
          restore = resolve;
        });
      if (path.endsWith("/cancel-preview"))
        return {
          token: "cancel-token",
          expiresAt: Date.now() + 60_000,
          listingId: "listing1",
          name: "Listed card",
        };
      return undefined;
    });
    renderPanel("first", "listings");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel listing: Listed card",
      }),
    );
    await screen.findByRole("alertdialog");
    await act(async () => restore(job()));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "A running batch was found. Finish or stop it before requesting a new preview.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Stop remaining actions" }),
    ).toBeEnabled();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/cancel-confirm")),
    ).toBe(false);
  });

  it("saves exact signed decimal rules in wallet minor units without creating listings", async () => {
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    expect(
      await screen.findByRole("radiogroup", { name: "Price source" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: /^Highest buy order/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: /Buyer-price adjustment/ }),
      { target: { value: "-0,01" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Minimum buyer price" }),
      { target: { value: "0.10" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Maximum buyer price" }),
      { target: { value: "0.35" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Delay between batch actions/ }),
      { target: { value: "7" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save pricing rules" }));
    await screen.findByText(/Pricing rules saved/);
    expect(api).toHaveBeenCalledWith(
      "/api/accounts/first/market/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          priceMode: "highestBuyOrder",
          adjustment: -1,
          minBuyerPrice: 10,
          maxBuyerPrice: 35,
          delaySeconds: 7,
          currencyId: 1,
        }),
      }),
    );
    expect(
      vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });

  it("rejects wallet precision mistakes instead of silently rounding a JPY rule", async () => {
    setup((path) =>
      path.endsWith("/market/listings")
        ? { ...market, currency: { id: 8, code: "JPY", minorUnit: 0 } }
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: /Buyer-price adjustment/ }),
      { target: { value: "0.1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save pricing rules" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at most 0 decimal places",
    );
    expect(
      vi.mocked(api).mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("fills the basket up to 50 Steam actions, keeps it across searches and clears it", async () => {
    setup((path) =>
      path.endsWith("/inventory")
        ? {
            ...inventory,
            items: Array.from({ length: 61 }, (_, index) => ({
              ...inventory.items[0]!,
              assetId: `asset-${index}`,
              name: `Card ${index + 1}`,
              gameAppId: null,
              gameName: null,
            })),
          }
        : undefined,
    );
    renderPanel();
    await screen.findByText("Card 1");
    fireEvent.click(
      game("Other Community items").getByRole("button", {
        name: "Add extras to basket",
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "At most 50 Steam actions fit in one batch.",
    );
    expect(screen.getByText("50 items · 100 copies")).toBeVisible();
    expect(screen.getByText("50 Steam actions · 10 s apart")).toBeVisible();
    expect(vi.mocked(api).mock.calls.every(([, init]) => !init?.method)).toBe(
      true,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search inventory" }),
      { target: { value: "Card 61" } },
    );
    fireEvent.click(tile("Card 61"));
    expect(tile("Card 61")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("50 items · 100 copies")).toBeVisible();
    fireEvent.click(reviewButton());
    await screen.findByRole("alertdialog");
    const request = vi
      .mocked(api)
      .mock.calls.find(([path]) => path.endsWith("/batch-preview"));
    expect(JSON.parse(String(request?.[1]?.body)).items).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("0 items · 0 copies")).toBeVisible();
  });

  it("removes only one game's extras from the basket", async () => {
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(
      game("Bee Quest").getByRole("button", { name: "Add extras to basket" }),
    );
    fireEvent.click(
      game("Hive World").getByRole("button", { name: "Add extras to basket" }),
    );
    expect(screen.getByText("3 items · 4 copies")).toBeVisible();
    fireEvent.click(
      game("Bee Quest").getByRole("button", { name: "Remove from basket" }),
    );
    expect(screen.getByText("1 items · 1 copies")).toBeVisible();
    expect(tile("Hive profile")).toHaveAttribute("aria-pressed", "true");
    expect(tile("Bee card")).toHaveAttribute("aria-pressed", "false");
    expect(vi.mocked(api).mock.calls.every(([, init]) => !init?.method)).toBe(
      true,
    );
  });

  it("sorts games by most extras", async () => {
    setup((path) =>
      path.endsWith("/inventory")
        ? {
            ...inventory,
            items: [
              inventory.items[0]!,
              { ...inventory.items[2]!, quantity: 20, duplicateQuantity: 19 },
            ],
          }
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    const order = () =>
      screen
        .getAllByRole("article")
        .map((item) => item.getAttribute("aria-label"));
    expect(order()).toEqual(["Bee Quest", "Hive World"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort games" }), {
      target: { value: "extras" },
    });
    expect(order()).toEqual(["Hive World", "Bee Quest"]);
  });

  it("selects a market listing through its associated label", async () => {
    renderPanel("first", "listings");
    const region = await screen.findByRole("region", {
      name: "Market listings",
    });
    const checkbox = await screen.findByRole("checkbox", {
      name: "Select Listed card",
    });
    const label = checkbox.closest("label");
    expect(label).not.toBeNull();
    fireEvent.click(label!);
    expect(checkbox).toBeChecked();
    expect(within(region).getByText("1 selected")).toBeVisible();
    fireEvent.click(label!);
    expect(checkbox).not.toBeChecked();
    expect(within(region).getByText("0 selected")).toBeVisible();
  });

  it("moves focus to the new listing page only after an explicit page change", async () => {
    let listings = Array.from({ length: 60 }, (_, index) => ({
      ...market.listings[0]!,
      listingId: `listing-${index}`,
      name: `Listed card ${index + 1}`,
    }));
    setup((path) =>
      path.endsWith("/market/listings") ? { ...market, listings } : undefined,
    );
    renderPanel("first", "listings");
    const list = await screen.findByRole("group", { name: "Market listings" });
    const scrollIntoView = vi.fn();
    list.scrollIntoView = scrollIntoView;
    expect(list).not.toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Listed card 26" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Listed card 1" })).toBeNull();
    expect(list).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(
      screen.getByRole("heading", { name: "Listed card 1" }),
    ).toBeVisible();
    expect(list).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const search = screen.getByRole("searchbox", {
      name: "Search market listings",
    });
    search.focus();
    fireEvent.change(search, { target: { value: "Listed card 60" } });
    expect(
      screen.getByRole("heading", { name: "Listed card 60" }),
    ).toBeVisible();
    expect(search).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(3);

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const refresh = screen.getByRole("button", {
      name: "Refresh inventory & listings",
    });
    refresh.focus();
    listings = listings.slice(0, 1);
    fireEvent.click(refresh);
    await screen.findByRole("heading", { name: "Listed card 1" });
    expect(refresh).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(4);
  });

  it("clears a capped filtered listing selection and warns when filters hide selected listings", async () => {
    setup((path) =>
      path.endsWith("/market/listings")
        ? {
            ...market,
            listings: Array.from({ length: 60 }, (_, index) => ({
              ...market.listings[0]!,
              listingId: `listing-${index}`,
              name: `Listed card ${index + 1}`,
            })),
          }
        : undefined,
    );
    renderPanel("first", "listings");
    const region = await screen.findByRole("region", {
      name: "Market listings",
    });
    fireEvent.click(
      await within(region).findByRole("button", {
        name: "Select filtered listings",
      }),
    );
    expect(within(region).getByText("50 selected")).toBeVisible();
    fireEvent.change(
      within(region).getByRole("searchbox", { name: "Search market listings" }),
      {
        target: { value: "Listed card 60" },
      },
    );
    expect(
      within(region).getByText(
        "50 selected items are hidden by the current filters. The preview includes them.",
      ),
    ).toBeVisible();
    fireEvent.change(
      within(region).getByRole("searchbox", { name: "Search market listings" }),
      {
        target: { value: "" },
      },
    );
    fireEvent.click(
      within(region).getByRole("button", { name: "Clear filtered listings" }),
    );
    expect(within(region).getByText("0 selected")).toBeVisible();
    expect(
      within(region).queryByRole("button", {
        name: "Preview selected cancellations",
      }),
    ).not.toBeInTheDocument();
  });

  it("does not restore a removed listing's selection when it appears in a later snapshot", async () => {
    let listings = market.listings;
    setup((path) =>
      path.endsWith("/market/listings") ? { ...market, listings } : undefined,
    );
    renderPanel("first", "listings");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select Listed card" }),
    );
    listings = [];
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    await screen.findByText("No active market listings.");
    listings = market.listings;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    expect(
      await screen.findByRole("checkbox", { name: "Select Listed card" }),
    ).not.toBeChecked();
  });

  it("aborts an old account’s batch preview and ignores its late response", async () => {
    let finish!: (value: MarketBatchPreview) => void;
    setup((path) =>
      path === "/api/accounts/first/market/batch-preview"
        ? new Promise<MarketBatchPreview>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    const view = renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(
      game("Bee Quest").getByRole("button", { name: "Add extras to basket" }),
    );
    fireEvent.click(reviewButton());
    const request = vi
      .mocked(api)
      .mock.calls.find(([path]) => path.endsWith("/batch-preview"));
    view.rerender(<InventoryPanel accountId="second" />);
    await screen.findByText("Bee card");
    expect(request?.[1]?.signal?.aborted).toBe(true);
    await act(async () => {
      finish(preview());
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("0 items · 0 copies")).toBeVisible();
  });

  it("lets a failed settings read retry without closing the panel", async () => {
    let attempts = 0;
    setup((path) =>
      path.endsWith("/market/settings") && ++attempts === 1
        ? Promise.reject(new Error("Rules temporarily unavailable"))
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry loading rules" }),
    );
    expect(
      await screen.findByRole("radiogroup", { name: "Price source" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Rules temporarily unavailable"),
    ).not.toBeInTheDocument();
  });

  it("never reinterprets monetary rules from another wallet currency", async () => {
    setup((path) =>
      path.endsWith("/market/settings")
        ? { ...rules, adjustment: 20, minBuyerPrice: 50, currencyId: 8 }
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    const adjustment = await screen.findByRole("textbox", {
      name: /Buyer-price adjustment/,
    });
    expect(adjustment).toHaveValue("0");
    expect(
      screen.getByRole("textbox", { name: "Minimum buyer price" }),
    ).toHaveValue("");
    expect(
      screen.getByText(/Saved price amounts use a different wallet currency/),
    ).toBeVisible();
    expect(
      vi.mocked(api).mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("blocks new sale quotes while rules are dirty, keeps cancellation usable and discards explicitly", async () => {
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(tile());
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Minimum buyer price" }),
      { target: { value: "200" } },
    );
    expect(screen.getByText("Unsaved rules")).toBeVisible();
    showInventory();
    expect(
      screen.getByText(
        /Save or discard these rules before creating a sale preview/,
      ),
    ).toBeVisible();
    expect(reviewButton()).toBeDisabled();
    expect(
      within(
        screen.getByRole("complementary", { name: "Sell basket" }),
      ).getByText("Save or discard your pricing rules first."),
    ).toBeVisible();
    showMarket();
    expect(
      screen.getByRole("button", { name: "Cancel listing: Listed card" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Discard rule changes" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Minimum buyer price" }),
    ).toHaveValue("");
    showInventory();
    expect(reviewButton()).toBeEnabled();
    expect(
      vi.mocked(api).mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("holds the quote gate until the pricing PUT finishes successfully", async () => {
    let finish!: (value: MarketPriceSettings) => void;
    setup((path, init) =>
      path.endsWith("/market/settings") && init?.method === "PUT"
        ? new Promise<MarketPriceSettings>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(tile());
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Minimum buyer price" }),
      { target: { value: "0.20" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save pricing rules" }));
    expect(
      screen.getByRole("button", { name: "Discard rule changes" }),
    ).toBeDisabled();
    showInventory();
    expect(reviewButton()).toBeDisabled();
    await act(async () => {
      finish({ ...rules, minBuyerPrice: 20, currencyId: 1 });
    });
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    expect(await screen.findByText(/Pricing rules saved/)).toBeVisible();
    showInventory();
    expect(reviewButton()).toBeEnabled();
    expect(screen.queryByText("Unsaved rules")).not.toBeInTheDocument();
  });

  it("restores an account’s unsaved monetary draft before allowing quotes after a tool remount", async () => {
    const first = renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Minimum buyer price" }),
      { target: { value: "200" } },
    );
    first.unmount();
    const second = renderPanel("second");
    await screen.findByText("Bee card");
    fireEvent.click(tile());
    expect(reviewButton()).toBeEnabled();
    second.unmount();
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(tile());
    expect(reviewButton()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Review pricing rules" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    expect(
      await screen.findByRole("textbox", { name: "Minimum buyer price" }),
    ).toHaveValue("200");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save pricing rules" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("textbox", { name: "Minimum buyer price" }),
    ).toHaveValue("200");
  });

  it("ignores a cancelled settings read failing after a newer successful load", async () => {
    let rejectOld!: (error: Error) => void;
    let reads = 0;
    setup((path) =>
      path.endsWith("/market/settings") && ++reads === 1
        ? new Promise<MarketPriceSettings>((_, reject) => {
            rejectOld = reject;
          })
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    await screen.findByText("Loading pricing rules…");
    showInventory();
    fireEvent.click(screen.getByRole("tab", { name: "Pricing rules" }));
    await screen.findByRole("radiogroup", { name: "Price source" });
    await act(async () => {
      rejectOld(new Error("Obsolete rules error"));
    });
    expect(screen.queryByText("Obsolete rules error")).not.toBeInTheDocument();
  });

  it("shows an initial recovery error and explicitly retries the active server batch", async () => {
    let reads = 0;
    setup((path) =>
      path.endsWith("/batches/active")
        ? ++reads === 1
          ? Promise.reject(new Error("Status temporarily unavailable"))
          : job()
        : undefined,
    );
    renderPanel();
    const retry = await screen.findByRole("button", {
      name: "Retry batch status",
    });
    expect(screen.getByText("Status temporarily unavailable")).toBeVisible();
    expect(tile()).toBeEnabled();
    fireEvent.click(retry);
    expect(
      await screen.findByRole("button", { name: "Stop remaining actions" }),
    ).toBeVisible();
    expect(tile()).toBeDisabled();
  });
});
