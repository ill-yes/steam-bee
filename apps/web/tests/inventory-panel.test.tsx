import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api";
import { InventoryPanel } from "../src/features/inventory/InventoryPanel";
import { I18nProvider } from "../src/i18n";

vi.mock("../src/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api")>()),
  api: vi.fn(),
}));

const inventory = {
  appId: 753,
  contextId: "6",
  fetchedAt: Date.now(),
  totalQuantity: 8,
  duplicateQuantity: 5,
  items: [
    {
      assetId: "card",
      name: "Bee card",
      marketHashName: "Bee card",
      type: "Trading card",
      iconUrl: null,
      quantity: 3,
      duplicateQuantity: 2,
      marketable: true,
      tradable: true,
    },
    {
      assetId: "single",
      name: "One badge",
      marketHashName: "One badge",
      type: "Badge",
      iconUrl: null,
      quantity: 1,
      duplicateQuantity: 0,
      marketable: true,
      tradable: true,
    },
    {
      assetId: "locked",
      name: "Locked card",
      marketHashName: null,
      type: "Trading card",
      iconUrl: null,
      quantity: 4,
      duplicateQuantity: 3,
      marketable: false,
      tradable: false,
    },
  ],
};
const currency = { id: 1, code: "USD", minorUnit: 2 };
const market = {
  fetchedAt: Date.now(),
  currency,
  listings: [
    {
      listingId: "listing",
      assetId: "listed-card",
      name: "Listed card",
      quantity: 1,
      buyerPays: 115,
      sellerReceives: 100,
      pendingConfirmation: false,
    },
  ],
};

function salePreview(overrides: Record<string, unknown> = {}) {
  return {
    token: "sale-token",
    expiresAt: Date.now() + 60_000,
    assetId: "card",
    name: "Bee card",
    quantity: 2,
    buyerPaysPerItem: 115,
    sellerReceivesPerItem: 100,
    totalBuyerPays: 230,
    totalSellerReceives: 200,
    steamFeePerItem: 5,
    publisherFeePerItem: 10,
    currency,
    ...overrides,
  };
}

const showInventory = () =>
  fireEvent.click(screen.getByRole("tab", { name: /^Inventory(?:\s*\d+)?$/ }));
const showMarket = () =>
  fireEvent.click(
    screen.getByRole("tab", { name: /^Market listings(?:\s*\d+)?$/ }),
  );

function renderPanel(
  accountId = "first",
  view: "inventory" | "listings" = "inventory",
) {
  const result = render(<InventoryPanel accountId={accountId} />, {
    wrapper: I18nProvider,
  });
  if (view === "listings") showMarket();
  return result;
}

function setupApi(
  overrides: (path: string, init?: RequestInit) => unknown = () => undefined,
) {
  vi.mocked(api).mockImplementation(async (path, init) => {
    const result = overrides(path, init);
    if (result !== undefined) return await result;
    if (path.endsWith("/inventory")) return inventory;
    if (path.endsWith("/market/listings")) return market;
    if (path.endsWith("/market/batches/active")) return null;
    if (path.endsWith("/market/preview")) return salePreview();
    if (path.endsWith("/market/cancel-preview"))
      return {
        token: "cancel-token",
        expiresAt: Date.now() + 60_000,
        listingId: "listing",
        name: "Listed card",
      };
    if (
      path.endsWith("/market/confirm") ||
      path.endsWith("/market/cancel-confirm")
    )
      return {
        ok: true,
        listingId: "listing",
        pendingConfirmation: false,
        message: "Done",
      };
    throw new Error(`Unexpected path ${path}`);
  });
}

describe("inventory and explicit market confirmation", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
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
    vi.mocked(api).mockReset();
    setupApi();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("only fetches on open and filters duplicates, names and marketable items", async () => {
    renderPanel();
    await screen.findByText("Bee card");
    expect(vi.mocked(api).mock.calls.every(([, init]) => !init?.method)).toBe(
      true,
    );
    expect(
      screen.getAllByRole("button", { name: /^Preview sale:/ }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /Preview sale: One badge/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Duplicates only" }));
    expect(screen.queryByText("One badge")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Marketable only" }));
    expect(screen.queryByText("Locked card")).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search inventory" }),
      { target: { value: "missing" } },
    );
    expect(screen.getByText("No items match these filters.")).toBeVisible();
  });

  it("keeps protected and unmarketable items out of individual actions and game selection", async () => {
    renderPanel();
    await screen.findByRole("heading", { name: "Bee card" });
    const lastCopy = within(screen.getByRole("article", { name: "One badge" }));
    const unmarketable = within(
      screen.getByRole("article", { name: "Locked card" }),
    );
    expect(
      lastCopy.getByText("Only copy — stays in your inventory."),
    ).toBeVisible();
    expect(
      unmarketable.getByText(
        "Steam does not allow these copies to be sold on the Community Market.",
      ),
    ).toBeVisible();

    for (const [item, name] of [
      [lastCopy, "One badge"],
      [unmarketable, "Locked card"],
    ] as const) {
      expect(
        item.getByRole("checkbox", { name: `Select ${name}` }),
      ).toBeDisabled();
      expect(item.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(
        item.queryByRole("button", { name: `Preview sale: ${name}` }),
      ).not.toBeInTheDocument();
    }

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select eligible items: Other Community items",
      }),
    );

    expect(screen.getByText("Selected variants: 1")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Select Bee card" }),
    ).toBeChecked();
    expect(
      lastCopy.getByRole("checkbox", { name: "Select One badge" }),
    ).not.toBeChecked();
    expect(
      unmarketable.getByRole("checkbox", { name: "Select Locked card" }),
    ).not.toBeChecked();
    expect(vi.mocked(api).mock.calls.every(([, init]) => !init?.method)).toBe(
      true,
    );
  });

  it("bounds sales to duplicate quantity and requires a reviewed quote before selling", async () => {
    setupApi((path) =>
      path.endsWith("/market/confirm")
        ? {
            ok: true,
            listingId: "listing",
            pendingConfirmation: true,
            message: "Pending",
          }
        : undefined,
    );
    renderPanel();
    const quantity = await screen.findByRole("spinbutton", {
      name: "Quantity: Bee card",
    });
    fireEvent.change(quantity, { target: { value: "99" } });
    expect(quantity).toHaveValue(99);
    expect(screen.getByText("Enter a whole number from 1 to 2.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview sale: Bee card" }),
    ).toBeDisabled();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/market/preview")),
    ).toBe(false);
    fireEvent.change(quantity, { target: { value: "" } });
    expect(quantity).toHaveValue(null);
    expect(
      screen.getByRole("button", { name: "Preview sale: Bee card" }),
    ).toBeDisabled();
    fireEvent.change(quantity, { target: { value: "2" } });
    expect(quantity).toHaveValue(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Preview sale: Bee card" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Review market sale",
    });
    expect(api).toHaveBeenCalledWith(
      "/api/accounts/first/market/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ assetId: "card", quantity: 2 }),
      }),
    );
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/market/confirm")),
    ).toBe(false);
    expect(within(dialog).getByText("$2.30")).toBeVisible();
    expect(within(dialog).getByText("$2.00")).toBeVisible();
    expect(within(dialog).getByText("$0.10")).toBeVisible();
    expect(within(dialog).getByText("$0.20")).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm sale" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/accounts/first/market/confirm",
        expect.objectContaining({
          body: JSON.stringify({ token: "sale-token" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Complete the confirmation in Steam Mobile/),
    ).toBeVisible();
  });

  it.each([
    [{ id: 8, code: "JPY", minorUnit: 0 }, 230, "¥230"],
    [{ id: 38, code: "KWD", minorUnit: 3 }, 230, "KWD 0.230"],
  ])(
    "uses the wallet currency precision %j",
    async (wallet, total, expected) => {
      setupApi((path) =>
        path.endsWith("/market/preview")
          ? salePreview({ currency: wallet, totalBuyerPays: total })
          : undefined,
      );
      renderPanel();
      fireEvent.click(
        await screen.findByRole("button", { name: "Preview sale: Bee card" }),
      );
      const dialog = await screen.findByRole("alertdialog");
      expect(
        within(dialog).getByText(expected.replace(/\s/g, " "), {
          exact: false,
        }),
      ).toBeVisible();
    },
  );

  it("requires a separate preview and confirmation to cancel an existing listing", async () => {
    renderPanel("first", "listings");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel listing: Listed card",
      }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Cancel market listing?",
    });
    expect(api).toHaveBeenCalledWith(
      "/api/accounts/first/market/cancel-preview",
      expect.objectContaining({
        body: JSON.stringify({ listingId: "listing" }),
      }),
    );
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/cancel-confirm")),
    ).toBe(false);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm cancellation" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/accounts/first/market/cancel-confirm",
        expect.objectContaining({
          body: JSON.stringify({ token: "cancel-token" }),
        }),
      ),
    );
  });

  it("blocks an expired quote", async () => {
    setupApi((path) =>
      path.endsWith("/market/preview")
        ? salePreview({ expiresAt: Date.now() - 1000 })
        : undefined,
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview sale: Bee card" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Confirm sale" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /preview has expired/,
    );
  });

  it("discards an old account's in-flight preview and aborts its requests", async () => {
    let resolvePreview!: (value: ReturnType<typeof salePreview>) => void;
    const pending = new Promise<ReturnType<typeof salePreview>>((resolve) => {
      resolvePreview = resolve;
    });
    setupApi((path) =>
      path === "/api/accounts/first/market/preview" ? pending : undefined,
    );
    const { rerender } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview sale: Bee card" }),
    );
    const firstSignal = vi
      .mocked(api)
      .mock.calls.find(([path]) =>
        path.endsWith("/market/preview"),
      )?.[1]?.signal;
    rerender(<InventoryPanel accountId="second" />);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/accounts/second/inventory",
        expect.anything(),
      ),
    );
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      resolvePreview(salePreview());
      await pending;
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/market/confirm")),
    ).toBe(false);
  });

  it("keeps inventory usable if Steam market listings cannot be loaded", async () => {
    setupApi((path) =>
      path.endsWith("/market/listings")
        ? Promise.reject(new Error("Steam market is unavailable"))
        : undefined,
    );
    renderPanel();
    expect(await screen.findByText("Bee card")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    showMarket();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Steam market is unavailable",
    );
  });

  it("uses German confirmation copy when German is selected", async () => {
    window.localStorage.setItem("steam-bee-locale", "de");
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Verkauf prüfen: Bee card" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Marktverkauf prüfen",
    });
    expect(
      within(dialog).getByRole("button", { name: "Verkauf bestätigen" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByText(/Steam kann eine Bestätigung in Steam Mobile/),
    ).toBeVisible();
  });

  it("renders at most 25 inventory cards and searches across all pages", async () => {
    const manyItems = Array.from({ length: 60 }, (_, index) => ({
      ...inventory.items[0]!,
      assetId: `card-${index}`,
      name: `Card ${index + 1}`,
    }));
    setupApi((path) =>
      path.endsWith("/inventory")
        ? {
            ...inventory,
            items: manyItems,
            totalQuantity: 180,
            duplicateQuantity: 120,
          }
        : undefined,
    );
    renderPanel();
    await screen.findByText("Card 1");
    expect(
      screen.getAllByRole("button", { name: /^Preview sale:/ }),
    ).toHaveLength(25);
    expect(screen.getByText("Variants 1–25 of 60")).toBeVisible();
    const scrollRegion = screen.getByRole("region", {
      name: "Inventory items",
    });
    expect(scrollRegion).toHaveAttribute("tabindex", "-1");
    scrollRegion.focus();
    expect(scrollRegion).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Variants 26–50 of 60")).toBeVisible();
    expect(screen.queryByText("Card 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getAllByRole("button", { name: /^Preview sale:/ }),
    ).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    const search = screen.getByRole("searchbox", { name: "Search inventory" });
    fireEvent.change(search, { target: { value: "Card 2" } });
    expect(screen.getByText("Card 2")).toBeVisible();
    expect(screen.getByText("Variants 1–11 of 11")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.change(search, { target: { value: "Card 60" } });
    expect(screen.getByText("Card 60")).toBeVisible();
    expect(screen.getByText("Variants 1–1 of 1")).toBeVisible();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Duplicates only" }));
    expect(screen.getByText("Variants 1–25 of 60")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("clamps a later inventory page when a refresh removes items", async () => {
    let count = 60;
    setupApi((path) =>
      path.endsWith("/inventory")
        ? {
            ...inventory,
            items: Array.from({ length: count }, (_, index) => ({
              ...inventory.items[0]!,
              assetId: `card-${index}`,
              name: `Card ${index + 1}`,
            })),
          }
        : undefined,
    );
    renderPanel();
    await screen.findByText("Card 1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Variants 51–60 of 60")).toBeVisible();
    count = 10;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    await screen.findByText("Variants 1–10 of 10");
    expect(screen.getByText("Card 1")).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /^Preview sale:/ }),
    ).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("shows actionable Steam conflict details instead of a generic conflict message", async () => {
    setupApi((path) =>
      path.endsWith("/market/preview")
        ? Promise.reject(
            new ApiError(
              "Refresh the account's Steam login before selling items.",
              "CONFLICT",
              409,
            ),
          )
        : undefined,
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview sale: Bee card" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refresh the account's Steam login before selling items.",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("discards a rejected confirmation and requires a fresh preview before another sale", async () => {
    let previewCount = 0;
    let confirmCount = 0;
    setupApi((path) => {
      if (path.endsWith("/market/preview"))
        return salePreview({ token: `sale-${++previewCount}` });
      if (path.endsWith("/market/confirm") && ++confirmCount === 1)
        return Promise.reject(
          new ApiError(
            "Steam could not verify this sale. Refresh the inventory and request a new quote.",
            "CONFLICT",
            409,
          ),
        );
      return undefined;
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview sale: Bee card" }),
    );
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm sale" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Steam could not verify this sale.",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm sale" }),
    ).not.toBeInTheDocument();
    expect(confirmCount).toBe(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Preview sale: Bee card" }),
    );
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm sale" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/accounts/first/market/confirm",
        expect.objectContaining({ body: JSON.stringify({ token: "sale-2" }) }),
      ),
    );
    expect(previewCount).toBe(2);
    expect(confirmCount).toBe(2);
  });

  it("also discards an uncertain cancellation preview on request failure", async () => {
    setupApi((path) =>
      path.endsWith("/market/cancel-confirm")
        ? Promise.reject(
            new Error(
              "Steam did not respond. Refresh current listings before trying again.",
            ),
          )
        : undefined,
    );
    renderPanel("first", "listings");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel listing: Listed card",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm cancellation" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refresh current listings before trying again.",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm cancellation" }),
    ).not.toBeInTheDocument();
  });

  it("renders inventory without waiting for a slower market request", async () => {
    let finishMarket!: (value: typeof market) => void;
    setupApi((path) =>
      path.endsWith("/market/listings")
        ? new Promise<typeof market>((resolve) => {
            finishMarket = resolve;
          })
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    expect(screen.getByText("Loading market listings…")).not.toBeVisible();
    expect(screen.queryByText("Loading inventory…")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No active market listings."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview sale: Bee card" }),
    ).toBeEnabled();
    await act(async () => {
      finishMarket(market);
    });
    showMarket();
    expect(screen.getByText("Listed card")).toBeVisible();
  });

  it("renders market listings without waiting for a slower inventory request", async () => {
    let finishInventory!: (value: typeof inventory) => void;
    setupApi((path) =>
      path.endsWith("/inventory")
        ? new Promise<typeof inventory>((resolve) => {
            finishInventory = resolve;
          })
        : undefined,
    );
    renderPanel("first", "listings");
    await screen.findByText("Listed card");
    expect(screen.getByText("Loading inventory…")).not.toBeVisible();
    expect(
      screen.queryByText("Your Steam inventory is empty."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel listing: Listed card" }),
    ).toBeEnabled();
    showInventory();
    expect(screen.getByText("Loading inventory…")).toBeVisible();
    await act(async () => {
      finishInventory(inventory);
    });
  });

  it("keeps a failed inventory refresh visible and blocks stale sales until recovery", async () => {
    let fail = false;
    setupApi((path) =>
      path.endsWith("/inventory") && fail
        ? Promise.reject(new Error("Inventory refresh failed"))
        : undefined,
    );
    renderPanel();
    await screen.findByText("Bee card");
    fail = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    expect(await screen.findByText("Inventory refresh failed")).toBeVisible();
    expect(screen.getByText("Bee card")).toBeVisible();
    expect(
      screen.getByText(/Showing the previous inventory snapshot/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview sale: Bee card" }),
    ).toBeDisabled();
    showMarket();
    expect(
      screen.getByRole("button", { name: "Cancel listing: Listed card" }),
    ).toBeEnabled();
    showInventory();
    fail = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Preview sale: Bee card" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByText(/Showing the previous inventory snapshot/),
    ).not.toBeInTheDocument();
  });

  it("keeps a failed market refresh visible and blocks stale cancellations until recovery", async () => {
    let fail = false;
    setupApi((path) =>
      path.endsWith("/market/listings") && fail
        ? Promise.reject(new Error("Market refresh failed"))
        : undefined,
    );
    renderPanel("first", "listings");
    await screen.findByText("Listed card");
    fail = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh inventory & listings" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Market refresh failed",
    );
    expect(screen.getByText("Listed card")).toBeVisible();
    expect(
      screen.getByText(/Showing the previous market snapshot/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Cancel listing: Listed card" }),
    ).toBeDisabled();
    showInventory();
    expect(
      screen.getByRole("button", { name: "Preview sale: Bee card" }),
    ).toBeEnabled();
  });

  it("announces slow sale previews and ignores their result after closing the tool", async () => {
    let finish!: (value: ReturnType<typeof salePreview>) => void;
    setupApi((path) =>
      path.endsWith("/market/preview")
        ? new Promise<ReturnType<typeof salePreview>>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    const view = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview sale: Bee card" }),
    );
    expect(
      screen.getByText("Preparing sale preview for Bee card…"),
    ).toBeVisible();
    const signal = vi
      .mocked(api)
      .mock.calls.find(([path]) =>
        path.endsWith("/market/preview"),
      )?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish(salePreview());
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("explains immediate sale consequences and keeps the busy confirmation from being submitted twice or closed", async () => {
    let finish!: (value: {
      ok: true;
      listingId: string;
      pendingConfirmation: false;
      message: string;
    }) => void;
    setupApi((path) =>
      path.endsWith("/market/confirm")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview sale: Bee card" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        /matching buy order may purchase it immediately/,
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/Completed sales cannot be undone/),
    ).toBeVisible();
    expect(within(dialog).getByText("Steam fees (total)")).toBeVisible();
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm sale",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Submitting listing to Steam…",
    );
    expect(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    ).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path.endsWith("/market/confirm")),
    ).toHaveLength(1);
    await act(async () => {
      finish({
        ok: true,
        listingId: "listing",
        pendingConfirmation: false,
        message: "Submitted",
      });
    });
    expect(
      await screen.findByText(/Listing submitted. Open Market listings/),
    ).toBeVisible();
    expect(
      screen.queryByText("Market action completed."),
    ).not.toBeInTheDocument();
  });

  it("returns focus to the sale trigger after reviewing and going back", async () => {
    renderPanel();
    const trigger = await screen.findByRole("button", {
      name: "Preview sale: Bee card",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not promise mobile confirmation for cancellation and reports the actual completed action", async () => {
    renderPanel("first", "listings");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel listing: Listed card",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByText(/Steam Mobile/)).not.toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm cancellation" }),
    );
    expect(
      await screen.findByText(
        "Listing cancelled. Steam will return the item to your inventory.",
      ),
    ).toBeVisible();
  });

  it("expires a quote while the dialog remains open", async () => {
    vi.useFakeTimers();
    await act(async () => {
      renderPanel();
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Preview sale: Bee card" }),
      );
    });
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Expires in 60 s/)).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Confirm sale" }),
    ).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(
      within(dialog).getByRole("button", { name: "Confirm sale" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /preview has expired/,
    );
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.endsWith("/market/confirm")),
    ).toBe(false);
  });
});
