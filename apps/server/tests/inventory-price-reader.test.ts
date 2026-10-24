import { describe, expect, it, vi } from "vitest";
import { parseWallet } from "../src/inventory/money.js";
import {
  MarketPriceReader,
  PriceReadError,
} from "../src/inventory/price-reader.js";

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

function walletResponse(data = walletData()) {
  return new Response(`var g_rgWalletInfo = ${JSON.stringify(data)};`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const state = {
    now: 1_000_000,
    wallet: walletData(),
    listing: "Market_LoadOrderSpread(12345);",
    orders: {
      success: 1,
      lowest_sell_order: "115",
      highest_buy_order: "109",
    } as Record<string, unknown>,
    status: 200,
    failure: null as Error | null,
  };
  const request = vi.fn(async (_accountId: string, path: string) => {
    if (path === "/market/?l=english") return walletResponse(state.wallet);
    if (path.startsWith("/market/listings/753/"))
      return new Response(state.listing);
    if (path.startsWith("/market/itemordershistogram?")) {
      if (state.failure) throw state.failure;
      return Response.json(state.orders, { status: state.status });
    }
    throw new Error(`Unexpected read: ${path}`);
  });
  const reader = new MarketPriceReader({ request, now: () => state.now });
  const wallet = parseWallet(state.wallet);
  return { reader, request, state, wallet };
}

describe("display-only market price reads", () => {
  it("reads authoritative wallet fees once per account, clones results and expires them after thirty seconds", async () => {
    const { reader, request, state } = harness();
    const [first, second] = await Promise.all([
      reader.wallet("a"),
      reader.wallet("a"),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      currency: { id: 1, code: "USD", minorUnit: 2 },
      country: "US",
      steamRate: { numerator: 5n, denominator: 100n },
      publisherRate: { numerator: 10n, denominator: 100n },
    });
    first.currency.code = "tampered";
    expect(second.currency.code).toBe("USD");
    expect((await reader.wallet("a")).currency.code).toBe("USD");
    state.now += 30_000;
    state.wallet = walletData({
      wallet_currency: 8,
      wallet_country: "JP",
      wallet_market_minimum: 100,
      wallet_currency_increment: 100,
    });
    expect((await reader.wallet("a")).currency).toEqual({
      id: 8,
      code: "JPY",
      minorUnit: 0,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps private wallet caches bounded and separate between accounts", async () => {
    const { reader, request } = harness();
    for (let index = 0; index < 9; index++) await reader.wallet(`a-${index}`);
    await reader.wallet("a-8");
    expect(request).toHaveBeenCalledTimes(9);
    await reader.wallet("a-0");
    expect(request).toHaveBeenCalledTimes(10);
  });

  it("reads both book sides once for concurrent display requests and keeps the original observation time", async () => {
    const { reader, request, state, wallet } = harness();
    const [first, second] = await Promise.all([
      reader.observation("a", "123-Card", wallet),
      reader.observation("a", "123-Card", wallet),
    ]);
    expect(first).toEqual({
      lowestSellOrder: 115,
      highestBuyOrder: 109,
      observedAt: state.now,
      freshUntil: state.now + 60_000,
      displayUntil: state.now + 300_000,
      stale: false,
      error: null,
      retryAt: null,
    });
    expect(second).toEqual(first);
    expect(request).toHaveBeenCalledTimes(2);
    first.lowestSellOrder = 999;
    state.now += 50_000;
    expect(await reader.observation("b", "123-Card", wallet)).toMatchObject({
      lowestSellOrder: 115,
      observedAt: state.now - 50_000,
    });
    expect(request).toHaveBeenCalledTimes(2);
    state.now += 10_000;
    expect((await reader.observation("a", "123-Card", wallet)).observedAt).toBe(
      state.now,
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(
      request.mock.calls.filter((call) =>
        call[1].startsWith("/market/listings/"),
      ),
    ).toHaveLength(1);
  });

  it("shares only public item IDs while separating order books by wallet currency and country", async () => {
    const { reader, request, wallet } = harness();
    await reader.observation("a", "123-Card", wallet);
    await reader.observation(
      "b",
      "123-Card",
      parseWallet(walletData({ wallet_currency: 3, wallet_country: "DE" })),
    );
    await reader.observation(
      "c",
      "123-Card",
      parseWallet(walletData({ wallet_country: "CA" })),
    );
    expect(
      request.mock.calls.filter((call) =>
        call[1].startsWith("/market/listings/"),
      ),
    ).toHaveLength(1);
    const books = request.mock.calls.filter((call) =>
      call[1].startsWith("/market/itemordershistogram?"),
    );
    expect(books).toHaveLength(3);
    expect(
      books.map((call) =>
        new URL(call[1], "https://steamcommunity.com").searchParams.get(
          "country",
        ),
      ),
    ).toEqual(["US", "DE", "CA"]);
    expect(
      books.map((call) =>
        new URL(call[1], "https://steamcommunity.com").searchParams.get(
          "currency",
        ),
      ),
    ).toEqual(["1", "3", "1"]);
  });

  it("uses only GET-compatible fixed paths and encodes the entire market name", async () => {
    const { reader, request, wallet } = harness();
    const name = "123-A card / ?name#fragment & value";
    await reader.wallet("a");
    await reader.observation("a", name, wallet);
    expect(request.mock.calls[1]?.[1]).toBe(
      `/market/listings/753/${encodeURIComponent(name)}?l=english`,
    );
    expect(
      request.mock.calls.every(
        (call) => call.length === 2 && call[1].startsWith("/market/"),
      ),
    ).toBe(true);
    expect(
      request.mock.calls.some((call) => /sellitem|removelisting/.test(call[1])),
    ).toBe(false);
  });

  it("expires public item IDs after six hours", async () => {
    const { reader, request, state, wallet } = harness();
    await reader.observation("a", "123-Card", wallet);
    state.now += 6 * 60 * 60_000;
    state.listing = "Market_LoadOrderSpread(67890);";
    await reader.observation("a", "123-Card", wallet);
    expect(
      request.mock.calls.filter((call) =>
        call[1].startsWith("/market/listings/"),
      ),
    ).toHaveLength(2);
    expect(request.mock.calls.at(-1)?.[1]).toContain("item_nameid=67890");
  });

  it("returns explicit stale data after refresh failure only within the five minute display window", async () => {
    const { reader, request, state, wallet } = harness();
    const first = await reader.observation("a", "123-Card", wallet);
    state.now += 60_001;
    state.status = 503;
    expect(await reader.observation("a", "123-Card", wallet)).toEqual({
      ...first,
      stale: true,
      error: "STEAM_UNAVAILABLE",
    });
    expect(request).toHaveBeenCalledTimes(3);
    state.now = first.displayUntil;
    await expect(
      reader.observation("a", "123-Card", wallet),
    ).rejects.toMatchObject({ code: "STEAM_UNAVAILABLE" });
  });

  it("keeps successful empty book sides distinct from fetch failures", async () => {
    const { reader, state, wallet } = harness();
    state.orders = {
      success: 1,
      lowest_sell_order: null,
      highest_buy_order: "0",
    };
    expect(await reader.observation("a", "123-Empty", wallet)).toMatchObject({
      lowestSellOrder: null,
      highestBuyOrder: null,
      stale: false,
      error: null,
    });
    state.orders = {
      success: 1,
      lowest_sell_order: "115",
      highest_buy_order: null,
    };
    expect(await reader.observation("a", "123-No bids", wallet)).toMatchObject({
      lowestSellOrder: 115,
      highestBuyOrder: null,
      error: null,
    });
  });

  it.each(["-1", "1.15", "1000000001", "price=115", {}, "NaN"])(
    "rejects unsupported order prices %j without inventing a quote",
    async (value) => {
      const { reader, state, wallet } = harness();
      state.orders.lowest_sell_order = value;
      await expect(
        reader.observation("a", "123-Card", wallet),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_PRICE" });
    },
  );

  it("coalesces refresh failures and applies a global cooldown without retrying a request", async () => {
    const { reader, request, state, wallet } = harness();
    const first = await reader.observation("a", "123-Card", wallet);
    state.now += 60_001;
    state.status = 429;
    const stale = await reader.observation("a", "123-Card", wallet);
    expect(stale).toEqual({
      ...first,
      stale: true,
      error: "RATE_LIMITED",
      retryAt: state.now + 60_000,
    });
    const calls = request.mock.calls.length;
    await expect(
      reader.observation("b", "Other card", wallet),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAt: stale.retryAt });
    expect(await reader.observation("a", "123-Card", wallet)).toEqual(stale);
    expect(request).toHaveBeenCalledTimes(calls);
    state.now = stale.retryAt!;
    state.status = 200;
    expect(await reader.observation("a", "123-Card", wallet)).toMatchObject({
      stale: false,
      observedAt: state.now,
      error: null,
      retryAt: null,
    });
    expect(request).toHaveBeenCalledTimes(calls + 1);
  });

  it("backs off repeated throttling from sixty seconds up to five minutes across different items", async () => {
    const { reader, request, state, wallet } = harness();
    state.status = 429;
    for (const [index, delay] of [
      60_000, 120_000, 240_000, 300_000, 300_000,
    ].entries()) {
      const failedAt = state.now;
      await expect(
        reader.observation("a", `Card ${index}`, wallet),
      ).rejects.toMatchObject({
        code: "RATE_LIMITED",
        retryAt: failedAt + delay,
      });
      state.now = failedAt + delay;
    }
    expect(request).toHaveBeenCalledTimes(10);
  });

  it("caps upstream concurrency at two and bounds the waiting queue", async () => {
    const gate = deferred<void>();
    let active = 0;
    let maximum = 0;
    const request = vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await gate.promise;
      active--;
      return walletResponse();
    });
    const reader = new MarketPriceReader({ request, now: () => 1000 });
    const result = Promise.allSettled(
      Array.from({ length: 43 }, (_, index) =>
        reader.wallet(`account-${index}`),
      ),
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    gate.resolve();
    const settled = await result;
    expect(maximum).toBe(2);
    expect(request).toHaveBeenCalledTimes(42);
    expect(settled.filter((row) => row.status === "fulfilled")).toHaveLength(
      42,
    );
    expect(settled.filter((row) => row.status === "rejected")).toEqual([
      {
        status: "rejected",
        reason: expect.objectContaining({
          code: "RATE_LIMITED",
          retryAt: 2000,
        }),
      },
    ]);
  });

  it("expires queued reads after twenty seconds and never submits them later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const gate = deferred<void>();
    const request = vi.fn(async () => {
      await gate.promise;
      return walletResponse();
    });
    const reader = new MarketPriceReader({ request });
    const active = Promise.all([reader.wallet("a"), reader.wallet("b")]);
    const queued = reader.wallet("c");
    let settled = false;
    void queued.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const timedOut = expect(queued).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAt: 22_000,
    });
    try {
      await vi.advanceTimersByTimeAsync(19_999);
      expect(settled).toBe(false);
      expect(request).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await timedOut;
      gate.resolve();
      await active;
      expect(request).toHaveBeenCalledTimes(2);
      await reader.wallet("c");
      expect(request).toHaveBeenCalledTimes(3);
    } finally {
      gate.resolve();
      await active;
      vi.useRealTimers();
    }
  });

  it.each(["account stop", "shutdown"])(
    "does not republish a private wallet after %s or replace a newer wallet",
    async (interruption) => {
      const oldResponse = deferred<Response>();
      const request = vi.fn(async () =>
        request.mock.calls.length === 1
          ? oldResponse.promise
          : walletResponse(
              walletData({ wallet_currency: 3, wallet_country: "DE" }),
            ),
      );
      const reader = new MarketPriceReader({ request });
      const pending = reader.wallet("a");
      const stopped = expect(pending).rejects.toMatchObject({
        code: "STEAM_UNAVAILABLE",
      });
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      if (interruption === "account stop") reader.clearAccount("a");
      else reader.shutdown();
      expect((await reader.wallet("a")).currency.code).toBe("EUR");
      oldResponse.resolve(walletResponse());
      await stopped;
      expect((await reader.wallet("a")).currency.code).toBe("EUR");
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it("discards invalidated queued wallet reads before contacting Steam", async () => {
    const gate = deferred<void>();
    const request = vi.fn(async () => {
      await gate.promise;
      return walletResponse();
    });
    const reader = new MarketPriceReader({ request });
    const first = reader.wallet("a");
    const second = reader.wallet("b");
    const pending = reader.wallet("c");
    const stopped = expect(pending).rejects.toMatchObject({
      code: "STEAM_UNAVAILABLE",
    });
    reader.clearAccount("c");
    gate.resolve();
    await Promise.all([first, second, stopped]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("bounds streamed response bodies and cancels oversized data", async () => {
    const cancel = vi.fn();
    const request = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
            },
            cancel,
          }),
        ),
    );
    const reader = new MarketPriceReader({ request });
    await expect(reader.wallet("a")).rejects.toMatchObject({
      code: "UNSUPPORTED_PRICE",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or executable wallet assignments without evaluating them", async () => {
    const executable = vi.fn(() => walletData());
    vi.stubGlobal("untrustedWalletScript", executable);
    const request = vi.fn(
      async () =>
        new Response(
          "var g_rgWalletInfo = globalThis.untrustedWalletScript();",
        ),
    );
    const reader = new MarketPriceReader({ request });
    try {
      await expect(reader.wallet("a")).rejects.toMatchObject({
        code: "STEAM_UNAVAILABLE",
      });
      expect(executable).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports unsupported wallet currency or fees without publishing partial wallet data", async () => {
    const { reader, state } = harness();
    state.wallet.wallet_currency = 999;
    await expect(reader.wallet("a")).rejects.toMatchObject({
      code: "UNSUPPORTED_PRICE",
    });
    state.wallet = walletData({ wallet_fee_percent: "private-cookie-value" });
    await expect(reader.wallet("a")).rejects.toMatchObject({
      code: "UNSUPPORTED_PRICE",
    });
    state.wallet = walletData();
    expect((await reader.wallet("a")).currency.code).toBe("USD");
  });

  it("scrubs unexpected transport errors instead of exposing cookies or request details", async () => {
    const request = vi.fn(async () => {
      throw new Error("private-cookie-value in upstream transport");
    });
    const reader = new MarketPriceReader({ request });
    const error = await reader.wallet("a").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PriceReadError);
    expect(error).toMatchObject({ code: "STEAM_UNAVAILABLE", retryAt: null });
    expect(String(error)).not.toContain("private-cookie-value");
  });

  it("bounds both public caches and evicts old entries while retaining recently observed variants", async () => {
    const { reader, request, wallet } = harness();
    for (let index = 0; index < 2001; index++)
      await reader.observation("a", `Card ${index}`, wallet);
    expect(request).toHaveBeenCalledTimes(4002);
    await reader.observation("a", "Card 2000", wallet);
    expect(request).toHaveBeenCalledTimes(4002);
    await reader.observation("a", "Card 0", wallet);
    expect(request).toHaveBeenCalledTimes(4004);
  }, 15_000);
});
