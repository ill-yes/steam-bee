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
import type { ComponentProps } from "react";
import {
  DEFAULT_FARMING_CONFIG,
  type FarmingSnapshot,
} from "@steam-bee/contracts";
import { api } from "../src/api";
import { FarmingPanel as ActualFarmingPanel } from "../src/features/farming/FarmingPanel";
import { clearFarmingDraft } from "../src/features/farming/drafts";
import { I18nProvider } from "../src/i18n";

vi.mock("../src/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api")>()),
  api: vi.fn(),
}));

function FarmingPanel(props: ComponentProps<typeof ActualFarmingPanel>) {
  return <ActualFarmingPanel library={[]} {...props} />;
}

async function openSettings() {
  if (screen.queryByRole("dialog", { name: "Edit rules" })) return;
  fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
  await screen.findByRole("dialog", { name: "Edit rules" });
}

async function openAdvancedIds() {
  await openSettings();
  const summary = await screen.findByText("Advanced: enter AppIDs manually", {
    selector: "summary",
  });
  if (!summary.closest("details")?.open) fireEvent.click(summary);
}

function snapshot(
  accountId = "first",
  phase: FarmingSnapshot["phase"] = "stopped",
): FarmingSnapshot {
  return {
    accountId,
    phase,
    config: structuredClone(DEFAULT_FARMING_CONFIG),
    games: [],
    activeAppIds: [],
    remainingDrops: 0,
    scannedAt: null,
    startedAt: null,
    truncated: false,
    reason: null,
    canStart: true,
    gameLimit: 32,
  };
}

function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("card farming controls", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const values = new Map([["steam-bee-locale", "en"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const sessionValues = new Map<string, string>();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionValues.set(key, value),
        removeItem: (key: string) => sessionValues.delete(key),
      },
    });
    clearFarmingDraft("first");
    clearFarmingDraft("second");
    vi.mocked(api).mockResolvedValue(snapshot());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    clearFarmingDraft("first");
    clearFarmingDraft("second");
  });

  it("protects refunds by default and requires saving changed settings before starting", async () => {
    render(
      <I18nProvider>
        <FarmingPanel accountId="first" />
      </I18nProvider>,
    );
    await openSettings();
    const protection = await screen.findByRole("checkbox", {
      name: "Protect refundable games",
    });
    expect(protection).toBeChecked();
    fireEvent.click(protection);
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toHaveAccessibleDescription(
      /Save your changes before searching or starting/,
    );
    expect(
      screen.getByRole("button", { name: "Find card drops" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/accounts/first/farming/config",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            ...DEFAULT_FARMING_CONFIG,
            skipRefundable: false,
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Switch to card farming" }),
      ).toBeEnabled(),
    );
  });

  it("does not show another account's delayed badge results", async () => {
    const pending = deferred<FarmingSnapshot>();
    vi.mocked(api).mockImplementation(async (path) =>
      path.includes("/first/") ? pending.promise : snapshot("second"),
    );
    const view = render(
      <I18nProvider>
        <FarmingPanel accountId="first" />
      </I18nProvider>,
    );
    view.rerender(
      <I18nProvider>
        <FarmingPanel accountId="second" />
      </I18nProvider>,
    );
    await screen.findByRole("button", { name: "Switch to card farming" });
    await act(async () => {
      pending.resolve({
        ...snapshot("first"),
        games: [
          {
            appId: 1,
            name: "Other account's private game",
            remainingDrops: 3,
            playtimeMinutes: 180,
            acquiredAt: null,
            skipReason: null,
          },
        ],
      });
    });
    expect(
      screen.queryByText("Other account's private game"),
    ).not.toBeInTheDocument();
  });

  it("offers retry after initial failure without showing an empty editable configuration", async () => {
    vi.mocked(api).mockRejectedValueOnce(
      new Error("Steam session unavailable"),
    );
    render(<FarmingPanel accountId="first" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Steam session unavailable",
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await openSettings();

    expect(await screen.findByRole("spinbutton")).toHaveValue(32);
    expect(
      screen.queryByText("Steam session unavailable"),
    ).not.toBeInTheDocument();
  });

  it("retains raw drafts across navigation and isolates them by account until discarded", async () => {
    vi.mocked(api).mockImplementation(async (path) =>
      snapshot(path.includes("/second/") ? "second" : "first"),
    );
    const view = render(<FarmingPanel accountId="first" />);
    await openAdvancedIds();
    const whitelist = await screen.findByRole("textbox", {
      name: "Only these AppIDs (optional)",
    });
    fireEvent.change(whitelist, { target: { value: "730, unfinished" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Protect refundable games" }),
    );
    view.unmount();

    const secondView = render(<FarmingPanel accountId="second" />);
    await openSettings();
    expect(await screen.findByRole("spinbutton")).toHaveValue(32);
    await openAdvancedIds();
    expect(
      screen.getByRole("textbox", { name: "Only these AppIDs (optional)" }),
    ).toHaveValue("");
    secondView.rerender(<FarmingPanel accountId="first" />);
    await openAdvancedIds();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Only these AppIDs (optional)" }),
      ).toHaveValue("730, unfinished"),
    );
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    expect(
      screen.getByRole("checkbox", { name: "Protect refundable games" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByRole("spinbutton")).toHaveValue(32);
    expect(
      screen.getByRole("checkbox", { name: "Protect refundable games" }),
    ).toBeChecked();
    expect(
      window.sessionStorage.getItem("steam-bee-farming-draft:first"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeEnabled();
  });

  it("keeps a draft on navigation when session storage is blocked", async () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    const view = render(<FarmingPanel accountId="first" />);
    await openAdvancedIds();
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Exclude these AppIDs" }),
      { target: { value: "570, 10" } },
    );
    view.unmount();
    render(<FarmingPanel accountId="first" />);
    await openAdvancedIds();

    expect(
      await screen.findByRole("textbox", { name: "Exclude these AppIDs" }),
    ).toHaveValue("570, 10");
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
  });

  it("validates each field, focuses the first error, and does not submit invalid settings", async () => {
    render(<FarmingPanel accountId="first" />);
    await openSettings();
    fireEvent.change(await screen.findByRole("spinbutton"), {
      target: { value: "" },
    });
    await openAdvancedIds();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Only these AppIDs (optional)" }),
      { target: { value: "730, bad" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    const limit = screen.getByRole("spinbutton");
    expect(limit).toHaveAttribute("aria-invalid", "true");
    expect(limit).toHaveAccessibleDescription(
      "Enter a whole number from 1 to 32.",
    );
    expect(limit).toHaveFocus();
    expect(
      screen.getByRole("textbox", { name: /Only these AppIDs/ }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(
      vi.mocked(api).mock.calls.some(([path]) => path.endsWith("/config")),
    ).toBe(false);
  });

  it("keeps failed save inputs and allows retry without enabling scan or start", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/config"))
        throw new Error("Settings storage unavailable");
      return snapshot();
    });
    render(<FarmingPanel accountId="first" />);
    await openAdvancedIds();
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Exclude these AppIDs" }),
      { target: { value: "570" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Settings storage unavailable",
    );
    expect(
      screen.getByRole("textbox", { name: "Exclude these AppIDs" }),
    ).toHaveValue("570");
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Find card drops" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeDisabled();
  });

  it("shows the saved limit and its effective account cap without making default settings invalid", async () => {
    vi.mocked(api).mockResolvedValue({ ...snapshot(), gameLimit: 31 });
    render(<FarmingPanel accountId="first" />);
    await openSettings();

    const limit = await screen.findByRole("spinbutton");
    expect(limit).toHaveValue(32);
    expect(limit).toHaveAttribute("max", "32");
    expect(limit).toBeValid();
    expect(
      screen.getByText(/This account can warm up at most 31 games/),
    ).toBeInTheDocument();
  });

  it("keeps a successful start visible if the subsequent status read fails", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/start")) return snapshot("first", "farming");
      if (++reads === 1) return snapshot();
      throw new Error("Latest status unavailable");
    });
    render(<FarmingPanel accountId="first" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Switch to card farming" }),
    );

    expect(await screen.findByText("Farming cards")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The latest status could not be confirmed",
    );
    expect(
      screen.queryByRole("button", { name: "Switch to card farming" }),
    ).not.toBeInTheDocument();
  });

  it("commits a successful save and retains known availability when the status follow-up fails", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/config"))
        return {
          ...snapshot(),
          canStart: false,
          config: { ...DEFAULT_FARMING_CONFIG, skipRefundable: false },
        };
      if (++reads === 1) return { ...snapshot(), gameLimit: 31 };
      throw new Error("Status refresh unavailable");
    });
    render(<FarmingPanel accountId="first" />);
    await openSettings();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Protect refundable games" }),
    );
    fireEvent.submit(screen.getByRole("form", { name: "Farming settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The latest status could not be confirmed",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit rules" }),
      ).not.toBeInTheDocument(),
    );
    await openSettings();
    expect(
      screen.getByRole("checkbox", { name: "Protect refundable games" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Save settings" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeEnabled();
    expect(
      screen.getByText(/This account can warm up at most 31 games/),
    ).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem("steam-bee-farming-draft:first"),
    ).toBeNull();
  });

  it("recovers a failed status poll without losing the active farming state", async () => {
    vi.useFakeTimers();
    vi.mocked(api)
      .mockResolvedValueOnce(snapshot("first", "farming"))
      .mockRejectedValueOnce(new Error("Temporary read failure"))
      .mockResolvedValue(snapshot("first", "farming"));
    render(<FarmingPanel accountId="first" />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Temporary read failure",
    );
    expect(screen.getByText("Farming cards")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Farming cards")).toBeInTheDocument();
    expect(vi.mocked(api)).toHaveBeenCalledTimes(3);
  });

  it("explains a concrete safety hold and keeps refund details associated with the checkbox", async () => {
    vi.mocked(api).mockResolvedValue({
      ...snapshot(),
      canStart: false,
      reason: "daily_limit",
    });
    render(<FarmingPanel accountId="first" />);
    await openSettings();

    const checkbox = await screen.findByRole("checkbox", {
      name: "Protect refundable games",
    });
    expect(checkbox).toHaveAccessibleDescription(
      /Unknown purchase dates are also skipped/,
    );
    const start = screen.getByRole("button", {
      name: "Switch to card farming",
    });
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      /The daily playtime limit is reached/,
    );
  });

  it("refreshes availability after account controls resume it without losing an unsaved draft", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        ...snapshot(),
        canStart: false,
        reason: "not_running",
      })
      .mockResolvedValue(snapshot());
    const view = render(
      <FarmingPanel
        accountId="first"
        accountStatus="paused_manual"
        activityMode="idle"
      />,
    );
    await openSettings();
    const limit = await screen.findByRole("spinbutton");
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeDisabled();
    fireEvent.change(limit, { target: { value: "4" } });

    view.rerender(
      <FarmingPanel
        accountId="first"
        accountStatus="boosting"
        activityMode="manual"
      />,
    );
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Discard changes" }),
      ).toBeEnabled(),
    );
    expect(limit).toHaveValue(4);
    expect(
      screen.queryByText(/The account is paused or stopped/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeEnabled();
    expect(
      vi
        .mocked(api)
        .mock.calls.every(([, options]) => options?.method === undefined),
    ).toBe(true);
  });

  it("sorts badge games into running, waiting and skipped columns", async () => {
    vi.mocked(api).mockResolvedValue({
      ...snapshot("first", "farming"),
      scannedAt: 0,
      activeAppIds: [730],
      config: { ...DEFAULT_FARMING_CONFIG, blacklist: [570] },
      games: [
        {
          appId: 730,
          name: "A very long game name",
          remainingDrops: 2,
          playtimeMinutes: 150,
          acquiredAt: null,
          skipReason: null,
        },
        {
          appId: 440,
          name: "Waiting game",
          remainingDrops: 1,
          playtimeMinutes: 200,
          acquiredAt: null,
          skipReason: null,
        },
        {
          appId: 570,
          name: "Excluded game",
          remainingDrops: 3,
          playtimeMinutes: null,
          acquiredAt: null,
          skipReason: "blacklisted",
        },
        {
          appId: 620,
          name: "New purchase",
          remainingDrops: 4,
          playtimeMinutes: 10,
          acquiredAt: null,
          skipReason: "refund_window",
        },
      ],
    });
    render(<FarmingPanel accountId="first" />);

    const running = await screen.findByRole("list", { name: "Farming now" });
    expect(
      within(running).getByRole("heading", { name: "A very long game name" }),
    ).toBeInTheDocument();
    expect(within(running).getByText(/2 drops left/)).toBeInTheDocument();
    expect(within(running).getByText(/2\.5 h/)).toBeInTheDocument();
    expect(running.querySelector('img[src*="/730/"]')).not.toBeNull();
    const waiting = screen.getByRole("list", { name: "Up next" });
    expect(within(waiting).getByText(/1 drop left/)).toBeInTheDocument();
    const skipped = screen.getByRole("list", { name: "Skipped" });
    expect(within(skipped).getByText("Excluded by you")).toBeInTheDocument();
    expect(within(skipped).getByText("Still refundable")).toBeInTheDocument();
    expect(
      within(skipped).getByRole("button", { name: "Change protection" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("excludes and re-allows single games while farming keeps running", async () => {
    let config = { ...DEFAULT_FARMING_CONFIG, blacklist: [570] };
    const farming = () => ({
      ...snapshot("first", "farming"),
      scannedAt: 0,
      activeAppIds: [730],
      config,
      games: [
        {
          appId: 730,
          name: "Running game",
          remainingDrops: 2,
          playtimeMinutes: 150,
          acquiredAt: null,
          skipReason: null,
        },
        {
          appId: 570,
          name: "Excluded game",
          remainingDrops: 3,
          playtimeMinutes: 150,
          acquiredAt: null,
          skipReason: config.blacklist.includes(570) ? "blacklisted" : null,
        },
      ],
    });
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.endsWith("/config"))
        config = JSON.parse(String(init?.body)) as typeof config;
      return farming();
    });
    render(<FarmingPanel accountId="first" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Exclude Running game" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/accounts/first/farming/config",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            ...DEFAULT_FARMING_CONFIG,
            blacklist: [570, 730],
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Allow Excluded game again" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Allow Excluded game again" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith("/api/accounts/first/farming"),
    );
    expect(config.blacklist).toEqual([730]);
    expect(
      vi.mocked(api).mock.calls.some(([path]) => path.endsWith("/stop")),
    ).toBe(false);
  });

  it.each([
    {
      locale: "en",
      dateLocale: "en-US",
      unscanned: "Card drops have not been checked yet.",
      scan: "Find card drops",
      refresh: "Refresh",
      refreshed: "Farming status updated.",
    },
    {
      locale: "de",
      dateLocale: "de-DE",
      unscanned: "Kartendrops wurden noch nicht geprüft.",
      scan: "Kartendrops suchen",
      refresh: "Aktualisieren",
      refreshed: "Farming-Status aktualisiert.",
    },
  ])(
    "shows the badge check time in $locale without treating a status refresh as a new scan",
    async ({ locale, dateLocale, unscanned, scan, refresh, refreshed }) => {
      window.localStorage.setItem("steam-bee-locale", locale);
      let scannedAt: number | null = null;
      vi.mocked(api).mockImplementation(async (path) => {
        if (path.endsWith("/scan")) scannedAt = 0;
        return { ...snapshot(), scannedAt };
      });
      const view = render(
        <I18nProvider>
          <FarmingPanel accountId="first" />
        </I18nProvider>,
      );
      expect(await screen.findByText(unscanned)).toBeInTheDocument();
      expect(view.container.querySelector("time")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: scan }));
      await waitFor(() =>
        expect(view.container.querySelector("time")).toHaveAttribute(
          "dateTime",
          "1970-01-01T00:00:00.000Z",
        ),
      );
      expect(screen.queryByText(unscanned)).not.toBeInTheDocument();
      const checkedTime = new Intl.DateTimeFormat(dateLocale, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(0);
      expect(view.container.querySelector("time")).toHaveTextContent(
        checkedTime,
      );

      await waitFor(() =>
        expect(screen.getByRole("button", { name: refresh })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: refresh }));
      await screen.findByText(refreshed);
      expect(view.container.querySelector("time")).toHaveAttribute(
        "dateTime",
        "1970-01-01T00:00:00.000Z",
      );
      expect(view.container.querySelector("time")).toHaveTextContent(
        checkedTime,
      );
      expect(
        vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/scan")),
      ).toHaveLength(1);
    },
  );

  it("makes a restored settings draft reviewable without starting any game", async () => {
    const first = render(<FarmingPanel accountId="first" />);
    await openSettings();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "4" },
    });
    first.unmount();

    render(<FarmingPanel accountId="first" />);
    const review = await screen.findByRole("button", {
      name: "Review & save changes",
    });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to card farming" }),
    ).toBeDisabled();
    fireEvent.click(review);

    expect(await screen.findByRole("spinbutton")).toHaveValue(4);
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
    expect(
      vi.mocked(api).mock.calls.every(([, options]) => !options?.method),
    ).toBe(true);
  });
});
