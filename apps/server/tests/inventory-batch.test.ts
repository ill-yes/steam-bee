import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MARKET_PRICE_SETTINGS,
  type MarketBatchJob,
  type MarketPriceSettings,
} from "@steam-bee/contracts";
import { InventoryMarketService } from "../src/inventory/service.js";
import { stoppedBeforeSubmission } from "../src/inventory/batch.js";
import { inventoryMetadata } from "../src/inventory/metadata.js";

const asset = (assetid: string, amount = "1") => ({
  appid: 753,
  contextid: "6",
  assetid,
  amount,
  classid: "10",
  instanceid: "0",
});
function harness(
  options: {
    controlledWait?: boolean;
    mutate?: <T>(id: string, action: () => Promise<T>) => Promise<T>;
  } = {},
) {
  const state = {
    assets: [asset("100"), asset("101"), asset("102")],
    price: "115",
    highest: "110",
    now: 1_000_000,
    settings: structuredClone(DEFAULT_MARKET_PRICE_SETTINGS),
    currency: 1,
    pending: false,
    uncertain: false,
    rejected: false,
    keepListing: false,
    cancelStatus: 200,
    listed: [] as Record<string, unknown>[],
    afterSale: null as (() => void) | null,
    postGate: null as (() => Promise<void>) | null,
    postResponseGate: null as (() => Promise<void>) | null,
    inventoryGate: null as (() => Promise<void>) | null,
    listingsGate: null as (() => Promise<void>) | null,
    histogramGate: null as (() => Promise<void>) | null,
  };
  const posts: { path: string; form?: Record<string, string> }[] = [];
  const waits: { milliseconds: number; release: () => void }[] = [];
  const request = vi.fn(
    async (
      _accountId: string,
      path: string,
      init?: {
        method?: "GET" | "POST";
        form?: Record<string, string>;
        shouldContinue?: () => boolean;
      },
    ) => {
      if (init?.method === "POST") {
        if (state.postGate) await state.postGate();
        if (init.shouldContinue && !init.shouldContinue())
          throw stoppedBeforeSubmission();
        posts.push({ path, ...(init.form ? { form: init.form } : {}) });
        if (state.postResponseGate) await state.postResponseGate();
        if (state.uncertain) throw new Error("socket closed after request");
        if (path.startsWith("/market/removelisting/")) {
          if (!state.keepListing)
            state.listed = state.listed.filter(
              (entry) => entry.listingid !== path.split("/").at(-1),
            );
          return Response.json([], { status: state.cancelStatus });
        }
        state.afterSale?.();
        return Response.json({
          success: !state.rejected,
          listingid: String(900 + posts.length),
          needs_mobile_confirmation: state.pending,
        });
      }
      if (path.startsWith("/inventory/")) {
        if (state.inventoryGate) await state.inventoryGate();
        return Response.json({
          success: 1,
          total_inventory_count: state.assets.length,
          assets: state.assets,
          descriptions: [
            {
              classid: "10",
              instanceid: "0",
              market_hash_name: "123-card",
              name: "Card",
              market_fee: "0.10",
              marketable: 1,
              tradable: 1,
              market_fee_app: 123,
              tags: [
                {
                  category: "Game",
                  internal_name: "app_123",
                  localized_tag_name: "Example game",
                },
                { category: "item_class", internal_name: "item_class_2" },
                { category: "cardborder", internal_name: "cardborder_1" },
              ],
            },
          ],
        });
      }
      if (path.startsWith("/market/?"))
        return new Response(
          `var g_rgWalletInfo = ${JSON.stringify({ wallet_currency: state.currency, wallet_country: "US", wallet_fee: 1, wallet_fee_percent: "0.05", wallet_fee_minimum: 1, wallet_fee_base: 0, wallet_publisher_fee_percent_default: "0.10" })};`,
        );
      if (path.startsWith("/market/mylistings?")) {
        if (state.listingsGate) await state.listingsGate();
        return Response.json({
          success: true,
          num_active_listings: state.listed.length,
          listings: state.listed,
          assets: [],
        });
      }
      if (path.startsWith("/market/listings/"))
        return new Response("Market_LoadOrderSpread(1234);");
      if (path.startsWith("/market/itemordershistogram?")) {
        if (state.histogramGate) await state.histogramGate();
        return Response.json({
          success: 1,
          lowest_sell_order: state.price,
          highest_buy_order: state.highest,
        });
      }
      throw new Error(`Unexpected path ${path}`);
    },
  );
  const wait = vi.fn((milliseconds: number, signal: AbortSignal) =>
    options.controlledWait
      ? new Promise<void>((resolve, reject) => {
          const abort = () => reject(stoppedBeforeSubmission());
          if (signal.aborted) return abort();
          signal.addEventListener("abort", abort, { once: true });
          waits.push({
            milliseconds,
            release: () => {
              signal.removeEventListener("abort", abort);
              resolve();
            },
          });
        })
      : Promise.resolve(),
  );
  const service = new InventoryMarketService({
    request,
    steamId: () => "76561198000000000",
    settings: async () => structuredClone(state.settings),
    now: () => state.now,
    wait,
    ...(options.mutate ? { mutate: options.mutate } : {}),
  });
  return { state, posts, request, waits, wait, service };
}
const selection = {
  kind: "sale" as const,
  items: [
    { assetId: "101", quantity: 1 },
    { assetId: "102", quantity: 1 },
  ],
};
async function finished(service: InventoryMarketService, id: string) {
  let result!: MarketBatchJob;
  await vi.waitFor(() => {
    result = service.getBatch("a", "browser", id);
    expect(["completed", "stopped"]).toContain(result.status);
  });
  return result;
}

function singleHarness(
  kind: "sale" | "cancel",
  options: Parameters<typeof harness>[0] = {},
) {
  const fixture = harness(options);
  fixture.state.listed = [
    {
      listingid: "901",
      price: 100,
      fee: 15,
      currencyid: 2001,
      asset: {
        id: "200",
        appid: 753,
        contextid: "6",
        amount: 1,
        name: "Listed card",
      },
    },
  ];
  return {
    ...fixture,
    preview: () =>
      kind === "sale"
        ? fixture.service.previewSale("a", "browser", "101", 1)
        : fixture.service.previewCancellation("a", "browser", "901"),
    confirm: (token: string) =>
      kind === "sale"
        ? fixture.service.confirmSale("a", "browser", token)
        : fixture.service.confirmCancellation("a", "browser", token),
  };
}

const interruptions = [
  {
    interruption: "account pause/stop",
    interrupt: (service: InventoryMarketService) =>
      service.stopAccountBatches("a"),
  },
  {
    interruption: "server shutdown",
    interrupt: (service: InventoryMarketService) => service.shutdownBatches(),
  },
];

describe.each(["sale", "cancel"] as const)(
  "single market %s lifecycle",
  (kind) => {
    it.each(interruptions)(
      "invalidates an approved preview on $interruption and permits a fresh session",
      async ({ interrupt }) => {
        const { service, posts, preview, confirm } = singleHarness(kind);
        const approved = await preview();
        interrupt(service);
        await expect(confirm(approved.token)).rejects.toThrow(/invalid/);
        expect(posts).toHaveLength(0);
        const fresh = await preview();
        expect((await confirm(fresh.token)).ok).toBe(true);
        expect(posts).toHaveLength(1);
      },
    );

    it.each(interruptions)(
      "discards a preview still being prepared during $interruption",
      async ({ interrupt }) => {
        const { service, state, posts, preview } = singleHarness(kind);
        let release!: () => void;
        const gate = () =>
          new Promise<void>((resolve) => {
            release = resolve;
          });
        if (kind === "sale") state.inventoryGate = gate;
        else state.listingsGate = gate;
        const pending = preview();
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        interrupt(service);
        release();
        await expect(pending).rejects.toMatchObject({ notSubmitted: true });
        expect(posts).toHaveLength(0);
      },
    );

    it.each(interruptions)(
      "blocks submission after $interruption while waiting for the account lock",
      async ({ interrupt }) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const mutate = vi.fn(
          async <T>(_id: string, action: () => Promise<T>): Promise<T> => {
            await gate;
            return action();
          },
        );
        const { service, posts, preview, confirm } = singleHarness(kind, {
          mutate,
        });
        const approved = await preview();
        const pending = confirm(approved.token);
        await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        interrupt(service);
        release();
        await expect(pending).rejects.toMatchObject({ notSubmitted: true });
        expect(posts).toHaveLength(0);
      },
    );

    it.each(interruptions)(
      "blocks submission after $interruption during Community session renewal",
      async ({ interrupt }) => {
        const { service, state, posts, preview, confirm } = singleHarness(kind);
        const approved = await preview();
        let release!: () => void;
        state.postGate = () =>
          new Promise<void>((resolve) => {
            release = resolve;
          });
        const pending = confirm(approved.token);
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        interrupt(service);
        release();
        await expect(pending).rejects.toMatchObject({ notSubmitted: true });
        expect(posts).toHaveLength(0);
        state.postGate = null;
        expect((await preview()).token).toBeTypeOf("string");
      },
    );

    it.each(interruptions)(
      "preserves the outcome of a request already sent before $interruption",
      async ({ interrupt }) => {
        const { service, state, posts, preview, confirm } = singleHarness(kind);
        const approved = await preview();
        let release!: () => void;
        state.postResponseGate = () =>
          new Promise<void>((resolve) => {
            release = resolve;
          });
        const pending = confirm(approved.token);
        await vi.waitFor(() => expect(posts).toHaveLength(1));
        interrupt(service);
        release();
        expect((await pending).ok).toBe(true);
        expect(posts).toHaveLength(1);
      },
    );
  },
);

describe("confirmed market batches", () => {
  it("previews all totals without submitting and executes only after confirmation", async () => {
    const { service, posts, wait, request } = harness();
    const preview = await service.previewBatch("a", "browser", selection);
    expect(preview.items.map((item) => item.variantId)).toEqual([
      "753:6:10:0",
      "753:6:10:0",
    ]);
    expect(preview.items.map((item) => item.status)).toEqual([
      "ready",
      "ready",
    ]);
    expect(preview.totalBuyerPays).toBe(230);
    expect(preview.totalSellerReceives).toBe(200);
    expect(posts).toHaveLength(0);
    // Identical descriptions share one quote within the preview, not one fetch per asset.
    expect(
      request.mock.calls.filter((call) =>
        call[1].startsWith("/market/itemordershistogram?"),
      ),
    ).toHaveLength(1);
    const job = service.confirmBatch("a", "browser", preview.token);
    expect(job.items.map((item) => item.variantId)).toEqual([
      "753:6:10:0",
      "753:6:10:0",
    ]);
    const result = await finished(service, job.id);
    expect(result.items.map((item) => item.status)).toEqual([
      "listed",
      "listed",
    ]);
    expect(result.completedCount).toBe(2);
    expect(posts).toHaveLength(2);
    expect(wait).toHaveBeenCalledWith(10_000, expect.any(AbortSignal));
    expect(posts.map((post) => post.form?.assetid)).toEqual(["101", "102"]);
  });
  it("keeps one copy across the combined batch, including a stale inventory", async () => {
    const { service, state, posts } = harness();
    state.assets = [asset("101"), asset("102")];
    const preview = await service.previewBatch("a", "browser", selection);
    expect(preview.items.map((item) => item.status)).toEqual([
      "ready",
      "unavailable",
    ]);
    expect(preview.items[1]?.message).toMatch(/last remaining copy/);
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.items.map((item) => item.status)).toEqual([
      "listed",
      "skipped",
    ]);
    expect(posts).toHaveLength(1);
  });
  it("is account/session-bound, expiring and one-use", async () => {
    const { service, state } = harness();
    let preview = await service.previewBatch("a", "browser", selection);
    expect(() =>
      service.confirmBatch("other", "browser", preview.token),
    ).toThrow(/invalid/);
    expect(() =>
      service.confirmBatch("a", "other browser", preview.token),
    ).toThrow(/invalid/);
    state.now += 120_001;
    expect(() => service.confirmBatch("a", "browser", preview.token)).toThrow(
      /expired/,
    );
    preview = await service.previewBatch("a", "browser", selection);
    const job = service.confirmBatch("a", "browser", preview.token);
    expect(() => service.confirmBatch("a", "browser", preview.token)).toThrow(
      /invalid/,
    );
    expect(() => service.getBatch("a", "other browser", job.id)).toThrow(
      /not found/,
    );
    await finished(service, job.id);
  });
  it("exposes delay/progress, prevents a second batch and stops before the next item", async () => {
    const { service, posts, waits } = harness({ controlledWait: true });
    const preview = await service.previewBatch("a", "browser", selection);
    const job = service.confirmBatch("a", "browser", preview.token);
    await vi.waitFor(() =>
      expect(service.getBatch("a", "browser", job.id).status).toBe("waiting"),
    );
    expect(service.currentBatch("a", "browser")?.completedCount).toBe(1);
    expect(service.currentBatch("a", "other browser")).toBeNull();
    expect(waits).toHaveLength(1);
    await expect(
      service.previewBatch("a", "browser", selection),
    ).rejects.toThrow(/already running/);
    service.stopBatch("a", "browser", job.id);
    const result = await finished(service, job.id);
    expect(result.items.map((item) => item.status)).toEqual([
      "listed",
      "skipped",
    ]);
    expect(posts).toHaveLength(1);
  });
  it("checks the stop guard again after waiting for an account mutation lock", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutate = vi.fn(
      async <T>(_id: string, action: () => Promise<T>): Promise<T> => {
        await gate;
        return action();
      },
    );
    const { service, posts } = harness({ mutate });
    const preview = await service.previewBatch("a", "browser", selection);
    const job = service.confirmBatch("a", "browser", preview.token);
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    service.stopBatch("a", "browser", job.id);
    release();
    const result = await finished(service, job.id);
    expect(result.items.every((item) => item.status === "skipped")).toBe(true);
    expect(posts).toHaveLength(0);
    expect(
      (await service.previewBatch("a", "browser", selection)).items[0]?.status,
    ).toBe("ready");
  });
  it("does not reserve or report an unknown submission when stopped during session renewal", async () => {
    const { service, state, posts } = harness();
    let release!: () => void;
    state.postGate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const preview = await service.previewBatch("a", "browser", selection);
    const job = service.confirmBatch("a", "browser", preview.token);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    service.stopBatch("a", "browser", job.id);
    release();
    const result = await finished(service, job.id);
    expect(result.items[0]?.status).toBe("skipped");
    expect(posts).toHaveLength(0);
    state.postGate = null;
    expect(
      (await service.previewBatch("a", "browser", selection)).items[0]?.status,
    ).toBe("ready");
  });
  it("records a pending mobile confirmation per item without retrying it", async () => {
    const { service, state, posts } = harness();
    state.pending = true;
    const preview = await service.previewBatch("a", "browser", selection);
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.items.map((item) => item.status)).toEqual([
      "pending_confirmation",
      "pending_confirmation",
    ]);
    expect(posts).toHaveLength(2);
  });
  it("stops after an uncertain HTTP response and never resubmits the reserved asset", async () => {
    const { service, state, posts } = harness();
    state.uncertain = true;
    const preview = await service.previewBatch("a", "browser", selection);
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.status).toBe("stopped");
    expect(result.items.map((item) => item.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(posts).toHaveLength(1);
    const retry = await service.previewBatch("a", "browser", selection);
    expect(retry.items[0]?.status).toBe("unavailable");
    expect(retry.items[0]?.message).toMatch(/uncertain/);
  });
  it("refreshes prices for every item and reports a changed later quote as a partial failure", async () => {
    const { service, state, posts } = harness();
    state.afterSale = () => {
      state.price = "116";
    };
    const preview = await service.previewBatch("a", "browser", selection);
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.status).toBe("completed");
    expect(result.items.map((item) => item.status)).toEqual([
      "listed",
      "failed",
    ]);
    expect(result.items[1]?.message).toMatch(/prices changed/);
    expect(posts).toHaveLength(1);
  });
  it("stops when wallet or saved rules changed after approval", async () => {
    const { service, state, posts } = harness();
    const preview = await service.previewBatch("a", "browser", selection);
    state.settings = { ...state.settings, delaySeconds: 20 };
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.items.map((item) => item.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(result.status).toBe("stopped");
    expect(posts).toHaveLength(0);
  });
  it("uses the selected order book side and signed currency-bound price adjustment", async () => {
    const { service, state, posts } = harness();
    state.settings = {
      ...state.settings,
      priceMode: "highestBuyOrder",
      adjustment: 5,
      currencyId: 1,
    };
    const preview = await service.previewBatch("a", "browser", selection);
    expect(preview.items[0]?.buyerPays).toBe(115);
    state.price = "999"; // The opposite market side is not the chosen price reference.
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.items.every((item) => item.status === "listed")).toBe(true);
    expect(posts[0]?.form?.price).toBe("100");
  });
  it("requires current ownership and readback for each cancellation", async () => {
    const { service, state, posts } = harness();
    state.listed = ["901", "902"].map((listingid) => ({
      listingid,
      price: 100,
      fee: 15,
      currencyid: 2001,
      asset: {
        id: `2${listingid}`,
        appid: 753,
        contextid: "6",
        amount: 1,
        name: "Listed card",
      },
    }));
    const preview = await service.previewBatch("a", "browser", {
      kind: "cancel",
      listingIds: ["901", "902", "903"],
    });
    expect(preview.items.map((item) => item.status)).toEqual([
      "ready",
      "ready",
      "unavailable",
    ]);
    expect(posts).toHaveLength(0);
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.items.map((item) => item.status)).toEqual([
      "cancelled",
      "cancelled",
      "skipped",
    ]);
    expect(posts.map((post) => post.path)).toEqual([
      "/market/removelisting/901",
      "/market/removelisting/902",
    ]);
    expect(state.listed).toHaveLength(0);
  });
  it("invalidates previews on account stop and shutdown while allowing a later restarted session", async () => {
    const { service } = harness();
    let preview = await service.previewBatch("a", "browser", selection);
    service.stopAccountBatches("a");
    expect(() => service.confirmBatch("a", "browser", preview.token)).toThrow(
      /invalid/,
    );
    preview = await service.previewBatch("a", "browser", selection);
    service.shutdownBatches();
    expect(() => service.confirmBatch("a", "browser", preview.token)).toThrow(
      /invalid/,
    );
    preview = await service.previewBatch("a", "browser", selection);
    expect(
      (
        await finished(
          service,
          service.confirmBatch("a", "browser", preview.token).id,
        )
      ).status,
    ).toBe("completed");
  });
  it("invalidates a preview still being prepared when the account stops", async () => {
    const { service, state } = harness();
    let release!: () => void;
    state.inventoryGate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pending = service.previewBatch("a", "browser", selection);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    service.stopAccountBatches("a");
    release();
    await expect(pending).rejects.toMatchObject({ notSubmitted: true });
  });
  it("bounds batches and rejects repeated asset IDs", async () => {
    const { service, posts } = harness();
    await expect(
      service.previewBatch("a", "browser", {
        kind: "sale",
        items: [selection.items[0]!, selection.items[0]!],
      }),
    ).rejects.toThrow(/distinct/);
    await expect(
      service.previewBatch("a", "browser", {
        kind: "cancel",
        listingIds: Array.from({ length: 51 }, (_, index) => String(index + 1)),
      }),
    ).rejects.toThrow(/50/);
    expect(posts).toHaveLength(0);
  });
  it("invalidates an in-progress preview across a nonterminal shutdown", async () => {
    const { service, state } = harness();
    let release!: () => void;
    state.inventoryGate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pending = service.previewBatch("a", "browser", selection);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    service.shutdownBatches();
    release();
    await expect(pending).rejects.toMatchObject({ notSubmitted: true });
    state.inventoryGate = null;
    const fresh = await service.previewBatch("a", "browser", selection);
    expect(
      (
        await finished(
          service,
          service.confirmBatch("a", "browser", fresh.token).id,
        )
      ).status,
    ).toBe("completed");
  });
  it("serializes settings writes after a sale whose price refresh is in flight", async () => {
    const { service, state, posts } = harness();
    const preview = await service.previewSale("a", "browser", "101", 1);
    let release!: () => void;
    state.histogramGate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const submitting = service.confirmSale("a", "browser", preview.token);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const next = { ...state.settings, currencyId: 1, minBuyerPrice: 200 };
    const write = vi.fn(async () => {
      state.settings = next;
      return next;
    });
    const saving = service.saveSettings("a", next, write);
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    release();
    expect((await submitting).ok).toBe(true);
    await saving;
    expect(posts).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(state.settings.minBuyerPrice).toBe(200);
  });
  it("blocks confirmation while a settings save is pending", async () => {
    const { service, state, posts } = harness();
    const preview = await service.previewBatch("a", "browser", selection);
    let release!: () => void;
    const saving = service.saveSettings(
      "a",
      state.settings,
      () =>
        new Promise<MarketPriceSettings>((resolve) => {
          release = () => resolve(state.settings);
        }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(() => service.confirmBatch("a", "browser", preview.token)).toThrow(
      /being saved/,
    );
    release();
    await saving;
    const job = service.confirmBatch("a", "browser", preview.token);
    await finished(service, job.id);
    expect(posts).toHaveLength(2);
  });
  it("allows cancellation even when saved sale prices belong to a different wallet currency", async () => {
    const { service, state, posts } = harness();
    state.settings = { ...state.settings, currencyId: 1, adjustment: 1 };
    state.currency = 3;
    state.listed = [
      {
        listingid: "901",
        price: 100,
        fee: 15,
        currencyid: 2003,
        asset: {
          id: "200",
          appid: 753,
          contextid: "6",
          amount: 1,
          name: "Listed card",
        },
      },
    ];
    const preview = await service.previewBatch("a", "browser", {
      kind: "cancel",
      listingIds: ["901"],
    });
    expect(preview.items[0]?.status).toBe("ready");
    expect(
      (
        await finished(
          service,
          service.confirmBatch("a", "browser", preview.token).id,
        )
      ).items[0]?.status,
    ).toBe("cancelled");
    expect(posts).toHaveLength(1);
  });

  it("shows every unavailable price rule result and rejects confirmation when no items are eligible", async () => {
    const { service, state, posts } = harness();
    state.settings = { ...state.settings, currencyId: 1, minBuyerPrice: 200 };
    const preview = await service.previewBatch("a", "browser", selection);
    expect(preview.items.every((item) => item.status === "unavailable")).toBe(
      true,
    );
    expect(preview.items[0]?.message).toMatch(/price limits/i);
    expect(preview.totalBuyerPays).toBe(0);
    expect(() => service.confirmBatch("a", "browser", preview.token)).toThrow(
      /No eligible/,
    );
    expect(posts).toHaveLength(0);
  });
  it("stops after an unconfirmed cancellation and leaves later listings untouched", async () => {
    const { service, state, posts } = harness();
    state.keepListing = true;
    state.listed = ["901", "902"].map((listingid) => ({
      listingid,
      price: 100,
      fee: 15,
      currencyid: 2001,
      asset: {
        id: `2${listingid}`,
        appid: 753,
        contextid: "6",
        amount: 1,
        name: "Listed card",
      },
    }));
    const preview = await service.previewBatch("a", "browser", {
      kind: "cancel",
      listingIds: ["901", "902"],
    });
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.items.map((item) => item.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(result.status).toBe("stopped");
    expect(posts).toHaveLength(1);
    expect(state.listed).toHaveLength(2);
  });
  it.each([500, 502, 503])(
    "stops after an uncertain HTTP %s cancellation instead of submitting later listings",
    async (status) => {
      const { service, state, posts } = harness();
      state.cancelStatus = status;
      state.listed = ["901", "902"].map((listingid) => ({
        listingid,
        price: 100,
        fee: 15,
        currencyid: 2001,
        asset: {
          id: `2${listingid}`,
          appid: 753,
          contextid: "6",
          amount: 1,
          name: "Listed card",
        },
      }));
      const preview = await service.previewBatch("a", "browser", {
        kind: "cancel",
        listingIds: ["901", "902"],
      });
      const result = await finished(
        service,
        service.confirmBatch("a", "browser", preview.token).id,
      );

      expect(result.status).toBe("stopped");
      expect(result.items.map((item) => item.status)).toEqual([
        "failed",
        "skipped",
      ]);
      expect(result.items[0]?.message).toMatch(
        /did not confirm|No automatic retry/,
      );
      expect(posts.map((post) => post.path)).toEqual([
        "/market/removelisting/901",
      ]);
      // A server failure can follow a committed cancellation. Its response
      // cannot establish whether Steam applied the request.
      expect(state.listed.map((listing) => listing.listingid)).toEqual(["902"]);
    },
  );
  it("rejects a wallet change before any confirmed batch sale is submitted", async () => {
    const { service, state, posts } = harness();
    const preview = await service.previewBatch("a", "browser", selection);
    state.currency = 3;
    const result = await finished(
      service,
      service.confirmBatch("a", "browser", preview.token).id,
    );
    expect(result.items.map((item) => item.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(result.status).toBe("stopped");
    expect(posts).toHaveLength(0);
  });
});

describe("Steam inventory metadata", () => {
  it("uses internal Steam tags for game, foil and category rather than translated text", () => {
    expect(
      inventoryMetadata({
        market_fee_app: 123,
        tags: [
          {
            category: "Game",
            internal_name: "app_123",
            localized_tag_name: "Example",
          },
          { category: "item_class", internal_name: "item_class_2" },
          { category: "cardborder", internal_name: "cardborder_1" },
        ],
      }),
    ).toMatchObject({
      gameAppId: 123,
      gameName: "Example",
      category: "card",
      cardKind: "foil",
      gameIconUrl:
        "https://cdn.cloudflare.steamstatic.com/steam/apps/123/header.jpg",
    });
    expect(
      inventoryMetadata({
        market_fee_app: "123",
        tags: [{ category: "item_class", internal_name: "item_class_3" }],
      }),
    ).toMatchObject({ gameAppId: 123, category: "background", cardKind: null });
    expect(
      inventoryMetadata({
        market_fee_app: "https://evil.test",
        tags: [
          {
            category: "Game",
            internal_name: "app_1/evil",
            localized_tag_name: "Fake",
          },
        ],
      }),
    ).toEqual({
      gameAppId: null,
      gameName: null,
      gameIconUrl: null,
      category: "other",
      cardKind: null,
    });
  });
  it("includes actual metadata in snapshots without exposing internal fee or group fields", async () => {
    const { service } = harness();
    const snapshot = await service.inventory("a");
    expect(snapshot.items[0]).toMatchObject({
      gameAppId: 123,
      gameName: "Example game",
      category: "card",
      cardKind: "foil",
    });
    expect(snapshot.items[0]).not.toHaveProperty("publisherFee");
  });
});
