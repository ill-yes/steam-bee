import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreeGamesResponse } from "@steam-bee/contracts";
import { FreeGamesPanel } from "../src/features/discovery/FreeGamesPanel";
import {
  acceptOfferSnapshot,
  emptyNotificationState,
  readOfferNotificationState,
  announceOfferPreferenceChange,
  saveOfferNotificationState,
} from "../src/features/discovery/notification-state";
import { I18nProvider } from "../src/i18n";

const offer = (id: number) => ({
  appId: id,
  name: `Game ${id}`,
  storeUrl: `https://store.steampowered.com/app/${id}/`,
});
const response = (
  overrides: Partial<FreeGamesResponse> = {},
): FreeGamesResponse => ({
  offers: [offer(42)],
  checkedAt: 1000,
  stale: false,
  truncated: false,
  libraryImportedAt: 500,
  excludedOwnedCount: 0,
  region: "US",
  ...overrides,
});
const fetchResponse = (value: FreeGamesResponse) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function resetStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

describe("offer notifications", () => {
  beforeEach(resetStorage);
  it("requires opt-in, baselines current offers and deduplicates new offers", () => {
    expect(
      acceptOfferSnapshot(emptyNotificationState(), [offer(1)]).newOffers,
    ).toEqual([]);
    const baseline = acceptOfferSnapshot(
      { ...emptyNotificationState(), enabled: true },
      [offer(1)],
    );
    expect(baseline.newOffers).toEqual([]);
    const next = acceptOfferSnapshot(baseline.state, [offer(1), offer(2)]);
    expect(next.newOffers).toEqual([offer(2)]);
    expect(acceptOfferSnapshot(next.state, [offer(2)]).newOffers).toEqual([]);
  });
  it("keeps account preferences separate and recovers from corrupt stored data", () => {
    window.localStorage.setItem(
      "steam-bee-free-offers:a",
      JSON.stringify({
        enabled: true,
        baselined: true,
        seen: [1, "2", null, -4],
      }),
    );
    expect(readOfferNotificationState("a")).toEqual({
      enabled: true,
      baselined: true,
      seen: [1],
    });
    expect(readOfferNotificationState("b")).toEqual(emptyNotificationState());
    window.localStorage.setItem("steam-bee-free-offers:a", "broken json");
    expect(readOfferNotificationState("a")).toEqual(emptyNotificationState());
  });
});

describe("free games panel", () => {
  beforeEach(resetStorage);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("loads only the selected account and exposes safe store links and explicit regional scope", async () => {
    const fetcher = vi.fn().mockResolvedValue(fetchResponse(response()));
    vi.stubGlobal("fetch", fetcher);
    render(<FreeGamesPanel accountId="my-account" />, {
      wrapper: I18nProvider,
    });
    const link = await screen.findByRole("link", {
      name: "Open in Steam: Game 42",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://store.steampowered.com/app/42/",
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/accounts/my-account/free-games",
    );
    expect(screen.getByText(/US store offers/)).toBeVisible();
  });
  it("does not allow notifications without an imported library and labels stale data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          fetchResponse(
            response({ offers: [], stale: true, libraryImportedAt: null }),
          ),
        ),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    expect(
      await screen.findByText(/cached offers may have expired/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/There were no offers in the last successful check/),
    ).toBeVisible();
  });
  it("ignores a late offer response after switching accounts", async () => {
    let completeFirst!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeFirst = resolve;
          }),
      )
      .mockImplementationOnce(async () =>
        fetchResponse(response({ offers: [offer(43)] })),
      );
    vi.stubGlobal("fetch", fetcher);
    const view = render(<FreeGamesPanel accountId="first" />, {
      wrapper: I18nProvider,
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    view.rerender(<FreeGamesPanel accountId="second" />);
    await screen.findByText("Game 43");
    await act(async () => {
      completeFirst(fetchResponse(response()));
    });
    expect(screen.queryByText("Game 42")).not.toBeInTheDocument();
    expect(screen.getByText("Game 43")).toBeVisible();
  });
  it("prompts only on explicit enable and leaves notifications to the dashboard watcher", async () => {
    const notify = vi.fn();
    class BrowserNotification {
      static permission = "granted";
      static requestPermission = vi.fn().mockResolvedValue("granted");
      constructor(title: string, options: unknown) {
        notify(title, options);
      }
    }
    vi.stubGlobal("Notification", BrowserNotification);
    const fetcher = vi.fn().mockImplementation(async () =>
      fetchResponse(
        response({
          offers:
            fetcher.mock.calls.length === 1
              ? [offer(42)]
              : [offer(42), offer(43)],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByText("Game 42");
    expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    );
    await screen.findByRole("button", { name: "Disable offer notifications" });
    expect(notify).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Game 43");
    expect(notify).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(notify).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Disable offer notifications" }),
    );
    expect(readOfferNotificationState("a").enabled).toBe(false);
  });
  it("keeps dashboard notices available when browser notifications are unsupported", async () => {
    vi.stubGlobal("Notification", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fetchResponse(response())),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByText("Game 42");
    fireEvent.click(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Disable offer notifications",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/Browser notifications are unavailable here/),
    ).toBeVisible();
    expect(readOfferNotificationState("a").enabled).toBe(true);
  });

  it("does not re-prompt denied browser permission and explains the dashboard fallback", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fetchResponse(response())),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByText("Game 42");
    fireEvent.click(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    );
    await screen.findByRole("button", { name: "Disable offer notifications" });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.getByText(/Browser notifications are blocked/)).toBeVisible();
    expect(readOfferNotificationState("a").enabled).toBe(true);
  });

  it("allows a dismissed permission prompt to be retried without disabling dashboard notices", async () => {
    const requestPermission = vi
      .fn()
      .mockResolvedValueOnce("default")
      .mockResolvedValueOnce("granted");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fetchResponse(response())),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByText("Game 42");
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Allow browser notifications",
      }),
    );
    expect(
      await screen.findByText("Browser notification permission is allowed."),
    ).toBeVisible();
    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(readOfferNotificationState("a").enabled).toBe(true);
  });

  it("ignores permission granted after the selected account has changed", async () => {
    let resolvePermission!: (value: string) => void;
    const requestPermission = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvePermission = resolve;
        }),
    );
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const fetcher = vi.fn().mockResolvedValue(fetchResponse(response()));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<FreeGamesPanel accountId="a" />, {
      wrapper: I18nProvider,
    });
    await screen.findByText("Game 42");
    fireEvent.click(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
    view.rerender(<FreeGamesPanel accountId="b" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await act(async () => resolvePermission("granted"));
    expect(readOfferNotificationState("a").enabled).toBe(false);
    expect(readOfferNotificationState("b").enabled).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Disable offer notifications" }),
    ).not.toBeInTheDocument();
  });

  it("respects an opt-out from another tab while the permission prompt is pending", async () => {
    let resolvePermission!: (value: string) => void;
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: () =>
        new Promise<string>((resolve) => {
          resolvePermission = resolve;
        }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fetchResponse(response())),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByText("Game 42");
    fireEvent.click(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    );
    await act(async () => {
      const disabled = emptyNotificationState();
      saveOfferNotificationState("a", disabled);
      announceOfferPreferenceChange("a", disabled);
      resolvePermission("granted");
    });
    expect(readOfferNotificationState("a").enabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "Notify me about new offers" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps cached cards after a refresh failure and explains that they were not verified", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(fetchResponse(response()))
      .mockRejectedValueOnce(new Error("Store request failed"));
    vi.stubGlobal("fetch", fetcher);
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByText("Game 42");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByText(/This refresh could not verify/),
    ).toBeVisible();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Store request failed");
    expect(screen.getByText("Game 42")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled();
    expect(screen.getByText(/Owned offers excluded: 0/)).toBeVisible();
    const ownershipHelp = screen.getByText(
      /Games acquired since that import may still appear/,
    );
    expect(ownershipHelp).not.toBeVisible();
    fireEvent.click(screen.getByText("Region & ownership details"));
    expect(ownershipHelp).toBeVisible();
  });

  it("combines a stale snapshot and refresh failure into one warning while keeping the offers available", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(fetchResponse(response({ stale: true })))
        .mockRejectedValueOnce(new Error("Store request failed")),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByRole("link", { name: "Open in Steam: Game 42" });
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Store request failed");

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /cached offers may have expired; check their current price in Steam/,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Store request failed");
    expect(
      screen.queryByText(/This refresh could not verify/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open in Steam: Game 42" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled();
  });

  it("shows an actionable initial error and recovers on refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("Steam offers unavailable"))
        .mockResolvedValueOnce(fetchResponse(response())),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Steam offers unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("link", { name: "Open in Steam: Game 42" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps compact context before the games and moves ownership explanations and notification support below them", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          fetchResponse(response({ offers: [offer(42), offer(43)] })),
        ),
    );
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });
    await screen.findByText("Game 42");
    const region = screen.getByText(/US store offers/);
    const heading = screen.getByRole("heading", { name: "Game 42" });
    expect(
      region.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open in Steam: Game 43" }),
    ).toHaveClass("min-h-11");
    const ownership = screen.getByText(
      /Owned games excluded using the library imported on/,
    );
    expect(ownership).not.toBeVisible();
    expect(
      heading.compareDocumentPosition(ownership) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(
        screen.getByRole("complementary", {
          name: "Don’t miss the next offer",
        }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Region & ownership details"));
    expect(ownership).toBeVisible();
  });

  it("gives an empty offer list a refresh action and a path to notification settings without enabling them", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(fetchResponse(response({ offers: [] })))
      .mockResolvedValueOnce(fetchResponse(response()));
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });
    vi.stubGlobal("fetch", fetcher);
    render(<FreeGamesPanel accountId="a" />, { wrapper: I18nProvider });

    expect(
      await screen.findByRole("heading", {
        name: "No free game offers right now",
      }),
    ).toBeVisible();
    const notificationLink = screen.getByRole("link", {
      name: "Set up offer notices",
    });
    expect(notificationLink).toHaveAttribute(
      "href",
      `#${screen.getByRole("heading", { name: "Don’t miss the next offer" }).id}`,
    );
    expect(readOfferNotificationState("a").enabled).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(
      await screen.findByRole("link", { name: "Open in Steam: Game 42" }),
    ).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
