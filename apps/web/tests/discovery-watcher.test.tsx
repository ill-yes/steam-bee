import { act, cleanup, render } from "@testing-library/react";
import type { FreeGamesResponse } from "@steam-bee/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FreeGamesWatcher } from "../src/features/discovery/FreeGamesWatcher";
import {
  announceOfferPreferenceChange,
  offerNotificationStorageKey,
  saveOfferNotificationState,
  readOfferNotificationState,
} from "../src/features/discovery/notification-state";
import { toast } from "sonner";
import { I18nProvider } from "../src/i18n";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

const state = { enabled: true, baselined: true, seen: [1] };
const snapshot = (
  id: number,
  overrides: Partial<FreeGamesResponse> = {},
): FreeGamesResponse => ({
  offers: [
    {
      appId: id,
      name: `Game ${id}`,
      storeUrl: `https://store.steampowered.com/app/${id}/`,
    },
  ],
  checkedAt: 1000,
  stale: false,
  truncated: false,
  libraryImportedAt: 500,
  excludedOwnedCount: 0,
  region: "US",
  ...overrides,
});
const reply = (data: FreeGamesResponse) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(data),
});

describe("dashboard free-offer watcher", () => {
  const notify = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    notify.mockClear();
    vi.mocked(toast.info).mockClear();
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    class BrowserNotification {
      static permission = "granted";
      constructor(title: string, options: unknown) {
        notify(title, options);
      }
    }
    vi.stubGlobal("Notification", BrowserNotification);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("makes no requests until opted in, baselines silently, polls behind other tools and stops on disable", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(snapshot(1)));
    vi.stubGlobal("fetch", fetcher);
    render(<FreeGamesWatcher accountId="a" />, { wrapper: I18nProvider });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      saveOfferNotificationState("a", state);
      announceOfferPreferenceChange("a", state);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    // Watcher is mounted independently of the offers panel, including in a background tab.
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fetcher.mockResolvedValue(reply(snapshot(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "New free game offers",
      expect.objectContaining({ body: "New offers on Steam: Game 2" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const requestCount = fetcher.mock.calls.length;
    await act(async () => {
      const disabled = { ...state, enabled: false };
      saveOfferNotificationState("a", disabled);
      announceOfferPreferenceChange("a", disabled);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(requestCount);
  });

  it("does not announce offers accumulated while closed and follows cross-tab preferences", async () => {
    saveOfferNotificationState("a", state);
    const fetcher = vi.fn().mockResolvedValue(reply(snapshot(2)));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(<FreeGamesWatcher accountId="a" />, { wrapper: I18nProvider });
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(reply(snapshot(3)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const requestCount = fetcher.mock.calls.length;
    await act(async () => {
      saveOfferNotificationState("a", { ...state, enabled: false });
      window.dispatchEvent(
        new StorageEvent("storage", { key: offerNotificationStorageKey("a") }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(requestCount);
  });

  it("never notifies from stale results or an unknown owned library", async () => {
    saveOfferNotificationState("a", state);
    const fetcher = vi
      .fn()
      .mockResolvedValue(reply(snapshot(2, { stale: true })));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(<FreeGamesWatcher accountId="a" />, { wrapper: I18nProvider });
    });
    fetcher.mockResolvedValue(reply(snapshot(3, { libraryImportedAt: null })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    fetcher.mockResolvedValue(reply(snapshot(4)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(notify).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(reply(snapshot(5)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("synchronizes seen-only storage updates without restarting polls or losing the next offer", async () => {
    saveOfferNotificationState("a", state);
    const fetcher = vi.fn().mockResolvedValue(reply(snapshot(1)));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(<FreeGamesWatcher accountId="a" />, { wrapper: I18nProvider });
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      saveOfferNotificationState("a", { ...state, seen: [1, 2] });
      window.dispatchEvent(
        new StorageEvent("storage", { key: offerNotificationStorageKey("a") }),
      );
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(reply(snapshot(3)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(readOfferNotificationState("a").seen).toEqual(
      expect.arrayContaining([1, 2, 3]),
    );
  });

  it("shares an offer claim between two dashboard watchers", async () => {
    saveOfferNotificationState("a", state);
    const fetcher = vi.fn().mockResolvedValue(reply(snapshot(1)));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(
        <>
          <FreeGamesWatcher accountId="a" />
          <FreeGamesWatcher accountId="a" />
        </>,
        { wrapper: I18nProvider },
      );
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValue(reply(snapshot(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("keeps in-app notices working without browser notification permission", async () => {
    saveOfferNotificationState("a", state);
    vi.stubGlobal("Notification", undefined);
    const fetcher = vi.fn().mockResolvedValue(reply(snapshot(1)));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(<FreeGamesWatcher accountId="a" />, { wrapper: I18nProvider });
    });
    fetcher.mockResolvedValue(reply(snapshot(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(toast.info).toHaveBeenCalledWith("New free game offers", {
      description: "Game 2",
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores a completed poll after an opt-out in another tab", async () => {
    saveOfferNotificationState("a", state);
    let finish!: (value: ReturnType<typeof reply>) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot(1)))
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof reply>>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      render(<FreeGamesWatcher accountId="a" />, { wrapper: I18nProvider });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    await act(async () => {
      saveOfferNotificationState("a", { ...state, enabled: false });
      window.dispatchEvent(
        new StorageEvent("storage", { key: offerNotificationStorageKey("a") }),
      );
      finish(reply(snapshot(2)));
    });
    expect(notify).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(readOfferNotificationState("a").enabled).toBe(false);
  });

  it("ignores a pending old-account poll after switching accounts", async () => {
    saveOfferNotificationState("a", state);
    saveOfferNotificationState("b", state);
    let finish!: (value: ReturnType<typeof reply>) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot(1)))
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof reply>>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(reply(snapshot(10)));
    vi.stubGlobal("fetch", fetcher);
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<FreeGamesWatcher accountId="a" />, {
        wrapper: I18nProvider,
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    await act(async () => {
      view.rerender(<FreeGamesWatcher accountId="b" />);
    });
    await act(async () => {
      finish(reply(snapshot(2)));
    });
    expect(notify).not.toHaveBeenCalled();
    expect(readOfferNotificationState("a").seen).not.toContain(2);
    fetcher.mockResolvedValue(reply(snapshot(11)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "New free game offers",
      expect.objectContaining({ tag: "steam-bee-free-offers:b" }),
    );
  });
});
