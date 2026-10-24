import type {
  MarketBatchJob,
  MarketBatchJobItem,
  MarketBatchPreview,
  MarketBatchPreviewItem,
} from "@steam-bee/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BatchPreviewDialog,
  BatchProgressPanel,
} from "../src/features/inventory/BatchMarketPanel";
import { advancedInventoryCopy } from "../src/features/inventory/advanced-copy";
import { inventoryCopy } from "../src/features/inventory/copy";
import { I18nProvider } from "../src/i18n";

const currency = { id: 1, code: "USD", minorUnit: 2 };
const copy = advancedInventoryCopy("en");
type VariantPreviewItem = MarketBatchPreviewItem & { variantId?: string };
type VariantJobItem = MarketBatchJobItem & { variantId?: string };

function item(
  assetId: string | null,
  overrides: Partial<VariantPreviewItem> = {},
): VariantPreviewItem {
  return {
    variantId: "steam:753:6:730-Anarchist:normal",
    assetId,
    listingId: null,
    name: "Anarchist",
    quantity: 1,
    buyerPays: 115,
    sellerReceives: 100,
    steamFee: 5,
    publisherFee: 10,
    status: "ready",
    message: null,
    ...overrides,
  };
}

function preview(
  items: VariantPreviewItem[],
  overrides: Partial<MarketBatchPreview> = {},
): MarketBatchPreview {
  const ready = items.filter((row) => row.status === "ready");
  return {
    token: "reviewed-original-token",
    expiresAt: Date.now() + 60_000,
    kind: "sale",
    currency,
    items,
    totalBuyerPays: ready.reduce((sum, row) => sum + (row.buyerPays ?? 0), 0),
    totalSellerReceives: ready.reduce(
      (sum, row) => sum + (row.sellerReceives ?? 0),
      0,
    ),
    delaySeconds: 10,
    ...overrides,
  };
}

function jobItem(
  assetId: string | null,
  status: MarketBatchJobItem["status"],
  overrides: Partial<VariantJobItem> = {},
): VariantJobItem {
  return {
    variantId: "steam:753:6:730-Anarchist:normal",
    assetId,
    listingId: null,
    name: "Anarchist",
    quantity: 1,
    status,
    message: null,
    ...overrides,
  };
}

function job(
  items: VariantJobItem[],
  overrides: Partial<MarketBatchJob> = {},
): MarketBatchJob {
  return {
    id: "job-original",
    kind: "sale",
    status: "waiting",
    createdAt: 100,
    updatedAt: 200,
    nextActionAt: Date.now() + 10_000,
    items,
    completedCount: 0,
    totalCount: items.length,
    stopRequested: false,
    ...overrides,
  };
}

function renderPreview(value: MarketBatchPreview, onConfirm = vi.fn()) {
  render(
    <BatchPreviewDialog
      preview={value}
      busy={false}
      error=""
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
    { wrapper: I18nProvider },
  );
  return screen.getByRole("alertdialog");
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

function openEntries(group: HTMLElement) {
  const details = group.querySelector("details")!;
  fireEvent.click(details.querySelector("summary")!);
  expect(details).toHaveAttribute("open");
  return within(details);
}

describe("variant grouping in batch sale review and progress", () => {
  beforeEach(() => {
    const values = new Map([["steam-bee-locale", "en"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });
  afterEach(cleanup);

  it("reviews three assets as one variant and sums row totals once without altering the confirmed preview", () => {
    const value = freeze(
      preview([
        item("asset-a", {
          quantity: 2,
          buyerPays: 230,
          sellerReceives: 200,
          steamFee: 10,
          publisherFee: 20,
        }),
        item("asset-b"),
        item("asset-c", {
          quantity: 3,
          buyerPays: 345,
          sellerReceives: 300,
          steamFee: 15,
          publisherFee: 30,
        }),
      ]),
    );
    const original = structuredClone(value);
    const confirm = vi.fn();
    const dialog = renderPreview(value, confirm);
    const region = within(dialog).getByRole("region", {
      name: copy.batchItems,
    });
    const groups = within(region).getAllByRole("group", { name: "Anarchist" });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName("Anarchist");
    expect(
      within(dialog).getByText(
        "Variants: 1 · Copies: 6 · Inventory entries: 3 · 10 seconds between actions",
      ),
    ).toBeVisible();
    expect(
      within(groups[0]!).getByText("Ready offers: 3 · Copies: 6"),
    ).toBeVisible();
    expect(within(groups[0]!).getByText("$6.90")).toBeVisible();
    expect(within(groups[0]!).getByText("$0.90")).toBeVisible();
    expect(within(groups[0]!).getByText("$6.00")).toBeVisible();

    const entries = openEntries(groups[0]!);
    expect(entries.getAllByRole("listitem")).toHaveLength(3);
    expect(entries.getByText("Inventory ID: asset-a")).toBeVisible();
    expect(entries.getByText("Inventory ID: asset-b")).toBeVisible();
    expect(entries.getByText("Inventory ID: asset-c")).toBeVisible();
    expect(entries.getByText("Copies: 3")).toBeVisible();
    expect(entries.getAllByText("Ready")).toHaveLength(3);
    expect(
      within(dialog).getByText(inventoryCopy.en.saleWarning),
    ).toBeVisible();
    expect(
      within(dialog).getByText(inventoryCopy.en.confirmationHelp),
    ).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.confirmBatchSale }),
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(value).toEqual(original);
    expect(value.token).toBe("reviewed-original-token");
  });

  it("keeps unavailable copies and their exact outcome visible while quoting only ready rows", () => {
    const dialog = renderPreview(
      preview([
        item("asset-a", {
          quantity: 2,
          buyerPays: 230,
          sellerReceives: 200,
          steamFee: 10,
          publisherFee: 20,
        }),
        item("unavailable", {
          quantity: 3,
          status: "unavailable",
          buyerPays: 9999,
          sellerReceives: 9000,
          steamFee: 333,
          publisherFee: 666,
          message: "No market quote",
        }),
        item("asset-c"),
      ]),
    );
    const group = within(dialog).getByRole("group", { name: "Anarchist" });
    expect(
      within(group).getByText("Copies: 6 · Inventory entries: 3"),
    ).toBeVisible();
    expect(
      within(group).getByText("Ready offers: 2 · Copies: 3"),
    ).toBeVisible();
    expect(
      within(group).getByText("Unavailable entries: 1 · Copies: 3"),
    ).toBeVisible();
    expect(
      within(group).getByText("Inventory ID: unavailable · No market quote"),
    ).toBeVisible();
    expect(within(group).getByText("$3.45")).toBeVisible();
    expect(within(group).getByText("$0.45")).toBeVisible();
    expect(within(group).getByText("$3.00")).toBeVisible();
    expect(within(group).queryByText("$99.99")).not.toBeInTheDocument();
    const entries = openEntries(group);
    expect(entries.getAllByRole("listitem")).toHaveLength(3);
    expect(entries.getByText("Unavailable")).toBeVisible();
    expect(entries.getByText("No market quote")).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: copy.confirmBatchSale }),
    ).toBeEnabled();
  });

  it("keeps same-name variants, fallback assets and unknown identities separate", () => {
    const fallbackA = item("fallback-a");
    const fallbackB = item("fallback-b");
    const unknownA = item(null);
    const unknownB = item(null);
    for (const row of [fallbackA, fallbackB, unknownA, unknownB])
      delete row.variantId;
    const dialog = renderPreview(
      preview([
        item("normal"),
        item("foil", { variantId: "steam:753:6:730-Anarchist:foil" }),
        fallbackA,
        fallbackB,
        unknownA,
        unknownB,
      ]),
    );
    const region = within(dialog).getByRole("region", {
      name: copy.batchItems,
    });
    expect(
      within(region).getAllByRole("group", { name: "Anarchist" }),
    ).toHaveLength(6);
  });

  it("shows unknown ready amounts as unknown and blocks a fully unavailable batch", () => {
    const { unmount } = render(
      <BatchPreviewDialog
        preview={preview([item("missing-fees", { steamFee: null })])}
        busy={false}
        error=""
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
      { wrapper: I18nProvider },
    );
    const group = screen.getByRole("group", { name: "Anarchist" });
    expect(within(group.querySelector("dl")!).getByText("—")).toBeVisible();
    unmount();
    const dialog = renderPreview(
      preview([
        item("unavailable", {
          status: "unavailable",
          buyerPays: null,
          sellerReceives: null,
          steamFee: null,
          publisherFee: null,
          message: "Inventory entry disappeared",
        }),
      ]),
    );
    expect(
      within(dialog).getByText(
        "Inventory ID: unavailable · Inventory entry disappeared",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: copy.confirmBatchSale }),
    ).toBeDisabled();
  });

  it("keeps every observed job outcome and actual offer ID without inventing completion", () => {
    const value = freeze(
      job(
        [
          jobItem("listed", "listed", {
            listingId: "offer-listed",
            quantity: 2,
          }),
          jobItem("confirmation", "pending_confirmation", {
            listingId: "offer-pending",
          }),
          jobItem("failed", "failed", { message: "Steam rejected this entry" }),
          jobItem("queued", "queued"),
          jobItem("running", "running"),
        ],
        { completedCount: 3, totalCount: 5 },
      ),
    );
    const original = structuredClone(value);
    render(
      <BatchProgressPanel
        job={value}
        busy={false}
        pollError={true}
        onStop={vi.fn()}
        onDismiss={vi.fn()}
      />,
      { wrapper: I18nProvider },
    );
    expect(screen.getByText("3 of 5 processed")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "3");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "5");
    expect(screen.getByText("Listed market offers: 1")).toBeVisible();
    expect(screen.getByText(inventoryCopy.en.confirmationNotice)).toBeVisible();
    expect(screen.getByText(copy.reconnectProgress)).toBeVisible();
    const group = screen.getByRole("group", { name: "Anarchist" });
    expect(
      within(group).getByText("Copies: 6 · Inventory entries: 5"),
    ).toBeVisible();
    for (const status of [
      "Listed: 1",
      "Steam confirmation required: 1",
      "Failed: 1",
      "Queued: 1",
      "In progress: 1",
    ])
      expect(within(group).getByText(status)).toBeVisible();
    const entries = openEntries(group);
    expect(entries.getAllByRole("listitem")).toHaveLength(5);
    expect(entries.getByText("Market offer ID: offer-listed")).toBeVisible();
    expect(entries.getByText("Market offer ID: offer-pending")).toBeVisible();
    expect(entries.getByText("Steam rejected this entry")).toBeVisible();
    expect(entries.getByText("Inventory ID: queued")).toBeVisible();
    expect(value).toEqual(original);
  });

  it("leaves cancellation previews and job outcomes as individual market listings", () => {
    const cancelRows = [
      item(null, { listingId: "listing-a" }),
      item(null, { listingId: "listing-b" }),
    ];
    const { unmount } = render(
      <BatchPreviewDialog
        preview={preview(cancelRows, { kind: "cancel", currency: null })}
        busy={false}
        error=""
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
      { wrapper: I18nProvider },
    );
    expect(screen.getAllByText("Anarchist")).toHaveLength(2);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.queryByText(/variants/)).not.toBeInTheDocument();
    unmount();
    render(
      <BatchProgressPanel
        job={job(
          [
            jobItem(null, "cancelled", { listingId: "listing-a" }),
            jobItem(null, "failed", {
              listingId: "listing-b",
              message: "Offer already removed",
            }),
          ],
          { kind: "cancel", status: "completed", completedCount: 2 },
        )}
        busy={false}
        pollError={false}
        onStop={vi.fn()}
        onDismiss={vi.fn()}
      />,
      { wrapper: I18nProvider },
    );
    expect(screen.getAllByText("Anarchist")).toHaveLength(2);
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.getByText("Offer already removed")).toBeVisible();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
