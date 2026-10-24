import type {
  InventoryPriceOverview,
  InventoryPriceOverviewRow,
  MarketCurrency,
} from "@steam-bee/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api";
import { useInventoryPrices } from "../src/features/inventory/useInventoryPrices";

vi.mock("../src/api", async (original) => ({
  ...(await original<typeof import("../src/api")>()),
  api: vi.fn(),
}));

type Options = Parameters<typeof useInventoryPrices>[0];
const usd: MarketCurrency = { id: 1, code: "USD", minorUnit: 2 };
const eur: MarketCurrency = { id: 3, code: "EUR", minorUnit: 2 };
const variant = (id: number) => `753:6:${100 + id}:0`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function options(overrides: Partial<Options> = {}): Options {
  return {
    accountId: "first",
    inventoryFetchedAt: 1000,
    enabled: true,
    currency: usd,
    rulesFingerprint: "rules-a",
    onContextExpired: vi.fn(async () => undefined),
    ...overrides,
  };
}

function overview(
  ids: string[],
  overrides: Partial<InventoryPriceOverview> = {},
  rowOverrides: Partial<InventoryPriceOverviewRow> = {},
): InventoryPriceOverview {
  return {
    accountId: "first",
    inventoryFetchedAt: 1000,
    currency: usd,
    priceMode: "lowestSellOrder",
    rulesFingerprint: "rules-a",
    walletFingerprint: "wallet-a",
    rows: ids.map((variantId) => ({
      variantId,
      rawReferenceBuyerPrice: 300,
      estimate: { buyerPaysPerItem: 290, sellerReceivesPerItem: 250 },
      observedAt: Date.now(),
      freshUntil: Date.now() + 60_000,
      displayUntil: Date.now() + 300_000,
      stale: false,
      error: null,
      retryAt: null,
      ...rowOverrides,
    })),
    ...overrides,
  };
}

function requestedIds(init?: RequestInit): string[] {
  return (JSON.parse(String(init?.body)) as { variantIds: string[] })
    .variantIds;
}

async function settle(action?: () => void) {
  await act(async () => {
    action?.();
    await Promise.resolve();
  });
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("visible inventory price reads and context isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    vi.mocked(api).mockReset();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("loads distinct visible variants in chunks of five with only one request in flight", async () => {
    const pending: Array<ReturnType<typeof deferred<InventoryPriceOverview>>> =
      [];
    vi.mocked(api).mockImplementation(() => {
      const request = deferred<InventoryPriceOverview>();
      pending.push(request);
      return request.promise;
    });
    const { result } = renderHook(() => useInventoryPrices(options()));
    const ids = Array.from({ length: 12 }, (_, index) => variant(index));
    await settle(() =>
      result.current.onVisibleVariantsChange([...ids, ids[0]!]),
    );
    await advance(150);
    expect(api).toHaveBeenCalledTimes(1);
    expect(requestedIds(vi.mocked(api).mock.calls[0]?.[1])).toHaveLength(5);
    await advance(5000);
    expect(api).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 3; index++) {
      const call = vi.mocked(api).mock.calls[index]!;
      await settle(() =>
        pending[index]!.resolve(overview(requestedIds(call[1]))),
      );
      await advance(150);
    }
    expect(api).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(api).mock.calls.map(([, init]) => requestedIds(init).length),
    ).toEqual([5, 5, 2]);
    expect(
      new Set(
        vi.mocked(api).mock.calls.flatMap(([, init]) => requestedIds(init)),
      ),
    ).toEqual(new Set(ids));
    expect(
      ids.every((id) => result.current.prices[id]?.status === "ready"),
    ).toBe(true);
  });

  it.each([
    ["account", { accountId: "second" }],
    ["inventory", { inventoryFetchedAt: 2000 }],
    ["currency", { currency: eur }],
    ["saved rules", { rulesFingerprint: "rules-b" }],
  ] as const)(
    "drops late responses after changing the %s context",
    async (_name, changed) => {
      const oldRead = deferred<InventoryPriceOverview>();
      let current = options();
      vi.mocked(api).mockImplementationOnce(() => oldRead.promise);
      vi.mocked(api).mockImplementation(async (_path, init) =>
        overview(
          requestedIds(init),
          {
            accountId: current.accountId,
            inventoryFetchedAt: current.inventoryFetchedAt!,
            currency: current.currency,
            rulesFingerprint: current.rulesFingerprint!,
            walletFingerprint: "new-wallet",
          },
          { estimate: { buyerPaysPerItem: 900, sellerReceivesPerItem: 800 } },
        ),
      );
      const { result, rerender } = renderHook(
        (props: Options) => useInventoryPrices(props),
        {
          initialProps: current,
        },
      );
      await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
      await advance(150);
      const oldSignal = vi.mocked(api).mock.calls[0]?.[1]?.signal;
      current = { ...current, ...changed };
      rerender(current);
      expect(oldSignal?.aborted).toBe(true);
      await settle(() => oldRead.resolve(overview([variant(1)])));
      expect(result.current.prices[variant(1)]?.buyerPrice).not.toBe(290);
      await advance(150);
      expect(result.current.prices[variant(1)]).toMatchObject({
        status: "ready",
        buyerPrice: 900,
        currency: current.currency,
      });
    },
  );

  it("applies an HTTP429 cooldown to new visible IDs and manual retries", async () => {
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError("Too many reads", "HTTP_429", 429),
    );
    vi.mocked(api).mockImplementation(async (_path, init) =>
      overview(requestedIds(init)),
    );
    const { result } = renderHook(() => useInventoryPrices(options()));
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(result.current.prices[variant(1)]?.error).toBe("RATE_LIMITED");
    await settle(() =>
      result.current.onVisibleVariantsChange([variant(2), variant(3)]),
    );
    await settle(() => result.current.retry());
    await advance(59_000);
    expect(api).toHaveBeenCalledTimes(1);
    await advance(1500);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.prices[variant(2)]?.status).toBe("ready");
  });

  it("repairs an expired context once per failed chain and allows recovery for another account", async () => {
    const onContextExpired = vi.fn(async () => undefined);
    vi.mocked(api).mockRejectedValue(
      new ApiError("Refresh inventory", "INVENTORY_PRICE_CONTEXT_EXPIRED", 409),
    );
    const initial = options({ onContextExpired });
    const { result, rerender } = renderHook(
      (props: Options) => useInventoryPrices(props),
      {
        initialProps: initial,
      },
    );
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(onContextExpired).toHaveBeenCalledTimes(1);
    await advance(61_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(onContextExpired).toHaveBeenCalledTimes(1);
    rerender({ ...initial, accountId: "second", inventoryFetchedAt: 2000 });
    await advance(150);
    expect(onContextExpired).toHaveBeenCalledTimes(2);
  });

  it("does not start another automatic repair when the first repair itself refreshes the snapshot", async () => {
    const repair = deferred<void>();
    const onContextExpired = vi.fn(() => repair.promise);
    vi.mocked(api).mockRejectedValue(
      new ApiError("Refresh inventory", "INVENTORY_PRICE_CONTEXT_EXPIRED", 409),
    );
    const initial = options({ onContextExpired });
    const { result, rerender } = renderHook(
      (props: Options) => useInventoryPrices(props),
      {
        initialProps: initial,
      },
    );
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(onContextExpired).toHaveBeenCalledTimes(1);
    rerender({ ...initial, inventoryFetchedAt: 2000 });
    await settle(() => repair.resolve());
    await advance(150);
    expect(api).toHaveBeenCalledTimes(2);
    expect(onContextExpired).toHaveBeenCalledTimes(1);
  });

  it("retains the failed repair budget when the snapshot commits after the repair promise resolved", async () => {
    const onContextExpired = vi.fn(async () => undefined);
    vi.mocked(api).mockRejectedValue(
      new ApiError("Refresh inventory", "INVENTORY_PRICE_CONTEXT_EXPIRED", 409),
    );
    const initial = options({ onContextExpired });
    const { result, rerender } = renderHook(
      (props: Options) => useInventoryPrices(props),
      {
        initialProps: initial,
      },
    );
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(onContextExpired).toHaveBeenCalledTimes(1);
    // React can commit a refresh result after the callback's promise settles.
    rerender({ ...initial, inventoryFetchedAt: 2000 });
    await advance(150);
    expect(api).toHaveBeenCalledTimes(2);
    expect(onContextExpired).toHaveBeenCalledTimes(1);
  });

  it("does not automatically retry or refresh a context that exceeds the supported size", async () => {
    const onContextExpired = vi.fn(async () => undefined);
    vi.mocked(api).mockRejectedValue(
      new ApiError("Too large", "INVENTORY_PRICE_CONTEXT_TOO_LARGE", 409),
    );
    const { result } = renderHook(() =>
      useInventoryPrices(options({ onContextExpired })),
    );
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(result.current.prices[variant(1)]?.error).toBe("CONTEXT_TOO_LARGE");
    await advance(10 * 60_000);
    expect(api).toHaveBeenCalledTimes(1);
    expect(onContextExpired).not.toHaveBeenCalled();
  });

  it("expires visible price amounts at displayUntil even when retry is much later", async () => {
    const observedAt = Date.now();
    let reads = 0;
    vi.mocked(api).mockImplementation(async (_path, init) =>
      overview(
        requestedIds(init),
        {},
        {
          observedAt,
          freshUntil: observedAt + 1000,
          displayUntil: observedAt + 2000,
          ...(++reads === 1
            ? {}
            : {
                stale: true,
                error: "RATE_LIMITED" as const,
                retryAt: observedAt + 10_000,
              }),
        },
      ),
    );
    const { result } = renderHook(() => useInventoryPrices(options()));
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(result.current.prices[variant(1)]?.status).toBe("ready");
    await advance(1000);
    expect(result.current.prices[variant(1)]).toMatchObject({
      status: "stale",
      buyerPrice: 290,
      retryAt: observedAt + 10_000,
    });
    expect(api).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(result.current.prices[variant(1)]).toMatchObject({
      buyerPrice: null,
      sellerReceivesPerItem: null,
      sourceBuyerPrice: null,
    });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("resets an aborted loading card even when it scrolled offscreen before the document hid", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    let firstSignal: AbortSignal | null | undefined;
    vi.mocked(api).mockImplementationOnce((_path, init) => {
      firstSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    vi.mocked(api).mockImplementation(async (_path, init) =>
      overview(requestedIds(init)),
    );
    const { result } = renderHook(() => useInventoryPrices(options()));
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(result.current.prices[variant(1)]?.status).toBe("loading");
    await settle(() => result.current.onVisibleVariantsChange([variant(2)]));
    await settle(() => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(firstSignal?.aborted).toBe(true);
    await settle(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(150);
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    expect(result.current.prices[variant(1)]).toMatchObject({
      status: "ready",
      buyerPrice: 290,
    });
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("keeps an unexpired estimate during a wallet read failure and clears all old estimates on a real wallet change", async () => {
    const observedAt = Date.now();
    let reads = 0;
    vi.mocked(api).mockImplementation(async (_path, init) => {
      const ids = requestedIds(init);
      reads++;
      if (reads === 1)
        return overview(ids, {}, { freshUntil: observedAt + 1000 });
      if (reads === 2)
        return overview(
          ids,
          {
            currency: null,
            walletFingerprint: null,
          },
          {
            estimate: null,
            rawReferenceBuyerPrice: null,
            observedAt: null,
            freshUntil: null,
            displayUntil: null,
            error: "STEAM_UNAVAILABLE",
          },
        );
      return overview(ids, { currency: eur, walletFingerprint: "wallet-b" });
    });
    const { result } = renderHook(() => useInventoryPrices(options()));
    await settle(() =>
      result.current.onVisibleVariantsChange([variant(1), variant(2)]),
    );
    await advance(150);
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(1000);
    expect(result.current.prices[variant(1)]).toMatchObject({
      status: "stale",
      buyerPrice: 290,
      sellerReceivesPerItem: 250,
      currency: usd,
      fetchedAt: observedAt + 150,
      error: "STEAM_UNAVAILABLE",
    });
    await settle(() => result.current.onVisibleVariantsChange([variant(3)]));
    await advance(150);
    expect(result.current.prices[variant(1)]).toBeUndefined();
    expect(result.current.prices[variant(2)]).toBeUndefined();
    expect(result.current.prices[variant(3)]).toMatchObject({
      status: "ready",
      buyerPrice: 290,
      currency: eur,
    });
  });

  it("removes expired amounts while a refresh request is still unresolved", async () => {
    const observedAt = Date.now();
    const refresh = deferred<InventoryPriceOverview>();
    vi.mocked(api).mockImplementationOnce(async (_path, init) =>
      overview(
        requestedIds(init),
        {},
        {
          observedAt,
          freshUntil: observedAt + 1000,
          displayUntil: observedAt + 2000,
        },
      ),
    );
    vi.mocked(api).mockImplementation(() => refresh.promise);
    const { result } = renderHook(() => useInventoryPrices(options()));
    await settle(() => result.current.onVisibleVariantsChange([variant(1)]));
    await advance(150);
    await advance(1000);
    expect(result.current.prices[variant(1)]).toMatchObject({
      status: "stale",
      buyerPrice: 290,
      refreshing: true,
    });
    await advance(1000);
    expect(result.current.prices[variant(1)]?.buyerPrice).toBeNull();
    expect(api).toHaveBeenCalledTimes(2);
    await settle(() => refresh.resolve(overview([variant(1)])));
  });

  it("invalidates all rule-dependent estimates as soon as a mismatched fingerprint is observed", async () => {
    const repair = deferred<void>();
    const onRulesChanged = vi.fn(() => repair.promise);
    let reads = 0;
    vi.mocked(api).mockImplementation(async (_path, init) =>
      overview(requestedIds(init), {
        rulesFingerprint: ++reads === 1 ? "rules-a" : "rules-b",
      }),
    );
    const { result } = renderHook(() =>
      useInventoryPrices(options({ onRulesChanged })),
    );
    await settle(() =>
      result.current.onVisibleVariantsChange([variant(1), variant(2)]),
    );
    await advance(150);
    expect(result.current.prices[variant(1)]?.buyerPrice).toBe(290);
    expect(result.current.prices[variant(2)]?.sellerReceivesPerItem).toBe(250);
    await settle(() => result.current.onVisibleVariantsChange([variant(3)]));
    await advance(150);
    expect(onRulesChanged).toHaveBeenCalledTimes(1);
    for (const id of [variant(1), variant(2)]) {
      expect(result.current.prices[id]?.buyerPrice ?? null).toBeNull();
      expect(
        result.current.prices[id]?.sellerReceivesPerItem ?? null,
      ).toBeNull();
    }
    await settle(() => repair.resolve());
  });

  it("clears and reloads an earlier chunk when observed rules change before the expected fingerprint has loaded", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (_path, init) => {
      const first = ++reads === 1;
      return overview(
        requestedIds(init),
        {
          rulesFingerprint: first ? "rules-a" : "rules-b",
        },
        {
          estimate: first
            ? { buyerPaysPerItem: 290, sellerReceivesPerItem: 250 }
            : { buyerPaysPerItem: 490, sellerReceivesPerItem: 450 },
        },
      );
    });
    const { result } = renderHook(() =>
      useInventoryPrices(options({ rulesFingerprint: null })),
    );
    const ids = Array.from({ length: 10 }, (_, index) => variant(index));
    await settle(() => result.current.onVisibleVariantsChange(ids));
    await advance(150);
    const firstChunk = requestedIds(vi.mocked(api).mock.calls[0]?.[1]);
    expect(firstChunk).toHaveLength(5);
    expect(
      firstChunk.every((id) => result.current.prices[id]?.buyerPrice === 290),
    ).toBe(true);
    await advance(150);
    expect(api).toHaveBeenCalledTimes(2);
    // The newly observed fingerprint invalidates all prices from the old chunk.
    expect(
      firstChunk.every((id) => result.current.prices[id] === undefined),
    ).toBe(true);
    const secondChunk = requestedIds(vi.mocked(api).mock.calls[1]?.[1]);
    expect(
      secondChunk.every((id) => result.current.prices[id]?.buyerPrice === 490),
    ).toBe(true);
    await advance(150);
    expect(api).toHaveBeenCalledTimes(3);
    expect(new Set(requestedIds(vi.mocked(api).mock.calls[2]?.[1]))).toEqual(
      new Set(firstChunk),
    );
    expect(
      ids.every((id) => result.current.prices[id]?.buyerPrice === 490),
    ).toBe(true);
    expect(
      ids.every(
        (id) => result.current.prices[id]?.sellerReceivesPerItem === 450,
      ),
    ).toBe(true);
  });
});
