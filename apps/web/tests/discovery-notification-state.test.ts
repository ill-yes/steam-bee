import type { FreeGameOffer } from "@steam-bee/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptOfferSnapshot,
  commitOfferSnapshot,
  emptyNotificationState,
  observeOfferPreference,
  offerNotificationStorageKey,
  readOfferNotificationState,
  saveOfferNotificationState,
  type OfferNotificationState,
} from "../src/features/discovery/notification-state";

const offer = (appId: number): FreeGameOffer => ({
  appId,
  name: `Game ${appId}`,
  storeUrl: `https://store.steampowered.com/app/${appId}/`,
});
const enabled = (seen: number[] = []): OfferNotificationState => ({
  enabled: true,
  baselined: true,
  seen,
});
const options = { baseline: false, isCurrent: () => true };

function serializedLockManager() {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, callback: () => unknown) => {
    const previous = tails.get(name) ?? Promise.resolve();
    const next = previous.then(callback);
    tails.set(
      name,
      next.catch(() => undefined),
    );
    return next;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  return request;
}

describe("free-offer notification state", () => {
  let values: Map<string, string>;
  let setItem: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    values = new Map();
    setItem = vi.fn((key: string, value: string) => values.set(key, value));
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem,
      },
    });
    vi.stubGlobal("navigator", {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes corrupt stored data and keeps only positive unique safe IDs", () => {
    values.set(offerNotificationStorageKey("a"), "bad JSON");
    expect(readOfferNotificationState("a")).toEqual(emptyNotificationState());
    values.set(
      offerNotificationStorageKey("a"),
      JSON.stringify({
        enabled: 1,
        baselined: "true",
        seen: [1, 2, 1, "3", null, 0, -1, 3.5, Number.MAX_SAFE_INTEGER + 1],
      }),
    );
    expect(readOfferNotificationState("a")).toEqual({
      enabled: false,
      baselined: false,
      seen: [2, 1],
    });
    values.set(
      offerNotificationStorageKey("a"),
      JSON.stringify({ enabled: true, baselined: true, seen: "invalid" }),
    );
    expect(readOfferNotificationState("a")).toEqual(enabled());
    expect(readOfferNotificationState("b")).toEqual(emptyNotificationState());
  });

  it("normalizes saves and avoids unchanged storage writes", () => {
    const dirty = { enabled: true, baselined: true, seen: [1, 1, -2, 3] };
    saveOfferNotificationState("a", dirty);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readOfferNotificationState("a")).toEqual(enabled([1, 3]));
    saveOfferNotificationState("a", dirty);
    saveOfferNotificationState("a", enabled([1, 3]));
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("deduplicates snapshot offers and keeps recently seen IDs within the 500-item history", () => {
    const initial = enabled(
      Array.from({ length: 500 }, (_, index) => index + 1),
    );
    const result = acceptOfferSnapshot(initial, [
      offer(1),
      offer(501),
      offer(501),
      offer(0),
      offer(-4),
    ]);
    expect(result.newOffers).toEqual([offer(501)]);
    expect(result.state.seen).toHaveLength(500);
    expect(result.state.seen).not.toContain(2);
    expect(result.state.seen.slice(-2)).toEqual([1, 501]);
    expect(new Set(result.state.seen).size).toBe(500);
    expect(initial.seen).toHaveLength(500);
  });

  it("bounds excessive histories on both read and save", () => {
    const seen = Array.from({ length: 700 }, (_, index) => index + 1);
    values.set(offerNotificationStorageKey("a"), JSON.stringify(enabled(seen)));
    expect(readOfferNotificationState("a").seen).toEqual(seen.slice(-500));
    saveOfferNotificationState("b", enabled(seen));
    expect(readOfferNotificationState("b").seen).toEqual(seen.slice(-500));
  });

  it("silently establishes a baseline without discarding historical IDs", async () => {
    saveOfferNotificationState("a", enabled([1, 2]));
    const result = await commitOfferSnapshot(
      "a",
      enabled([1]),
      [offer(3), offer(3)],
      { ...options, baseline: true },
    );
    expect(result.newOffers).toEqual([]);
    expect(result.state).toEqual(enabled([1, 2, 3]));
  });

  it("merges the freshest persisted history and claims only unknown offers", async () => {
    saveOfferNotificationState("a", enabled([2]));
    const result = await commitOfferSnapshot(
      "a",
      enabled([1]),
      [offer(1), offer(2), offer(3)],
      options,
    );
    expect(result.newOffers).toEqual([offer(3)]);
    expect(result.state.seen).toEqual([1, 2, 3]);
    expect(readOfferNotificationState("a")).toEqual(result.state);
  });

  it("uses in-memory preferences if storage is missing or blocked", async () => {
    const missing = await commitOfferSnapshot(
      "a",
      enabled([1]),
      [offer(2)],
      options,
    );
    expect(missing.newOffers).toEqual([offer(2)]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage blocked");
      },
    });
    expect(readOfferNotificationState("a")).toEqual(emptyNotificationState());
    expect(
      await commitOfferSnapshot("b", enabled([1]), [offer(2)], options),
    ).toEqual({ state: enabled([1, 2]), newOffers: [offer(2)] });
    expect(() => saveOfferNotificationState("b", enabled())).not.toThrow();
  });

  it("falls back to a local commit when an embedded context rejects Web Locks", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: vi
          .fn()
          .mockRejectedValue(
            new DOMException("Access denied", "SecurityError"),
          ),
      },
    });
    saveOfferNotificationState("a", enabled([1]));
    const result = await commitOfferSnapshot(
      "a",
      enabled([1]),
      [offer(2)],
      options,
    );
    expect(result.newOffers).toEqual([offer(2)]);
    expect(readOfferNotificationState("a").seen).toEqual([1, 2]);
  });

  it("announces successful changes in this tab and does not repeat unchanged writes or events", async () => {
    saveOfferNotificationState("a", enabled([1]));
    setItem.mockClear();
    const listener = vi.fn();
    const stop = observeOfferPreference("a", listener);
    try {
      const first = await commitOfferSnapshot(
        "a",
        enabled([1]),
        [offer(2)],
        options,
      );
      expect(listener).toHaveBeenCalledExactlyOnceWith(first.state);
      expect(setItem).toHaveBeenCalledTimes(1);
      const next = await commitOfferSnapshot(
        "a",
        first.state,
        [offer(2)],
        options,
      );
      expect(next.newOffers).toEqual([]);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(setItem).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("serializes simultaneous snapshots so only one tab claims each new offer", async () => {
    const request = serializedLockManager();
    saveOfferNotificationState("a", enabled([1]));
    const [first, second] = await Promise.all([
      commitOfferSnapshot("a", enabled([1]), [offer(2)], options),
      commitOfferSnapshot("a", enabled([1]), [offer(2)], options),
    ]);
    expect(first.newOffers).toEqual([offer(2)]);
    expect(second.newOffers).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      offerNotificationStorageKey("a"),
      expect.any(Function),
    );
    expect(readOfferNotificationState("a").seen).toEqual([1, 2]);
  });

  it("does not write or claim offers after the owning account request becomes stale", async () => {
    saveOfferNotificationState("a", enabled([1]));
    setItem.mockClear();
    const result = await commitOfferSnapshot("a", enabled([1]), [offer(2)], {
      ...options,
      isCurrent: () => false,
    });
    expect(result.newOffers).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
    expect(readOfferNotificationState("a").seen).toEqual([1]);
  });

  it("checks request currency again immediately before committing a snapshot", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    saveOfferNotificationState("a", enabled([1]));
    setItem.mockClear();
    const result = await commitOfferSnapshot("a", enabled([1]), [offer(2)], {
      ...options,
      isCurrent,
    });
    expect(result.newOffers).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("honors an opt-out written while waiting for another tab's lock", async () => {
    serializedLockManager();
    let release!: () => void;
    const held = navigator.locks.request(
      offerNotificationStorageKey("a"),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    saveOfferNotificationState("a", enabled([1]));
    const pending = commitOfferSnapshot("a", enabled([1]), [offer(2)], options);
    saveOfferNotificationState("a", { ...enabled([1]), enabled: false });
    setItem.mockClear();
    release();
    await held;
    const result = await pending;
    expect(result.state.enabled).toBe(false);
    expect(result.newOffers).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
    expect(readOfferNotificationState("a").enabled).toBe(false);
  });
});
