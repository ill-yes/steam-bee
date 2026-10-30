import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SteamToolsPanel } from "../src/features/accounts/SteamToolsPanel";
import { I18nProvider } from "../src/i18n";

vi.mock("../src/features/discovery/FreeGamesWatcher", () => ({
  FreeGamesWatcher: ({ accountId }: { accountId: string }) => (
    <output data-testid="watcher">{accountId}</output>
  ),
}));
vi.mock("../src/features/discovery/FreeGamesPanel", () => ({
  FreeGamesPanel: ({ accountId }: { accountId: string }) => (
    <p>Offers for {accountId}</p>
  ),
}));
vi.mock("../src/features/inventory/InventoryPanel", () => ({
  InventoryPanel: ({
    accountId,
    view,
  }: {
    accountId: string;
    view?: string;
  }) => (
    <p>
      Inventory for {accountId}: {view}
    </p>
  ),
}));
vi.mock("../src/features/farming/FarmingPanel", () => ({
  FarmingPanel: ({
    accountId,
    library,
    activityMode,
    accountStatus,
  }: {
    accountId: string;
    library?: { name: string }[];
    activityMode?: string;
    accountStatus?: string;
  }) => (
    <div>
      <p>Farming for {accountId}</p>
      <output>{activityMode}</output>
      <output>{accountStatus}</output>
      <p>{library?.map((game) => game.name).join(", ")}</p>
    </div>
  ),
}));

describe("account workspace navigation", () => {
  beforeEach(() => {
    const storage = new Map<string, string>([["steam-bee-locale", "en"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
  });
  afterEach(cleanup);

  const nav = () =>
    within(screen.getByRole("navigation", { name: "Account sections" }));
  const item = (name: string) =>
    nav().getByRole("button", { name: new RegExp(`^${name}`) });

  it("starts on games with grouped sections and one current page", () => {
    render(
      <SteamToolsPanel
        accountId="first"
        libraryPanel={<p>Saved games</p>}
        automationPanels={{
          presets: <p>Presets</p>,
          schedules: <p>Schedules</p>,
          analytics: <p>Statistics</p>,
        }}
        accountPanel={<p>Account settings</p>}
      />,
      { wrapper: I18nProvider },
    );
    const groups = nav().getAllByRole("group");
    expect(
      groups.map((group) => group.getAttribute("aria-labelledby")),
    ).toHaveLength(5);
    expect(
      within(nav().getByRole("group", { name: "Items" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Inventory", "Market listings", "Pricing rules"]);
    expect(
      within(nav().getByRole("group", { name: "Automation" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Presets", "Schedules", "Statistics"]);
    expect(nav().getAllByRole("button")).toHaveLength(10);
    expect(
      nav()
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-current") === "page"),
    ).toEqual([item("Boost playtime")]);
    expect(
      screen.getByRole("region", { name: "Boost playtime" }),
    ).toHaveTextContent("Saved games");
    expect(screen.getByTestId("watcher")).toHaveTextContent("first");
  });

  it("switches full panels and keeps one inventory panel for its three views", async () => {
    render(
      <SteamToolsPanel accountId="first" libraryPanel={<p>Saved games</p>} />,
      { wrapper: I18nProvider },
    );
    fireEvent.click(item("Inventory"));
    expect(
      await screen.findByText("Inventory for first: inventory"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Saved games")).not.toBeInTheDocument();
    fireEvent.click(item("Market listings"));
    expect(
      await screen.findByText("Inventory for first: listings"),
    ).toBeInTheDocument();
    expect(item("Market listings")).toHaveAttribute("aria-current", "page");
    expect(item("Inventory")).not.toHaveAttribute("aria-current");
    fireEvent.click(item("Card farming"));
    expect(await screen.findByText("Farming for first")).toBeInTheDocument();
    expect(screen.queryByText(/Inventory for first/)).not.toBeInTheDocument();
    expect(screen.getByTestId("watcher")).toBeInTheDocument();
  });

  it("offers every section in one mobile section picker", async () => {
    render(
      <SteamToolsPanel
        accountId="first"
        remainingDrops={3}
        libraryPanel={<p>Saved games</p>}
        automationPanels={{
          presets: <p>Presets</p>,
          schedules: <p>Schedules</p>,
          analytics: <p>Statistics</p>,
        }}
      />,
      { wrapper: I18nProvider },
    );
    const picker = screen.getByRole("combobox", { name: /Section/ });
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Boost playtime",
      "Card farming (3 drops)",
      "Inventory",
      "Market listings",
      "Pricing rules",
      "Free to keep",
      "Presets",
      "Schedules",
      "Statistics",
      "Account & safety",
    ]);
    fireEvent.change(picker, { target: { value: "schedules" } });
    expect(item("Schedules")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Schedules" })).toHaveTextContent(
      "Schedules",
    );
  });

  it("shows remaining card drops in the navigation and hides automation without panels", () => {
    render(<SteamToolsPanel accountId="first" remainingDrops={37} />, {
      wrapper: I18nProvider,
    });
    expect(item("Card farming")).toHaveTextContent("37 drops");
    expect(nav().queryByRole("button", { name: /^Presets/ })).toBeNull();
  });

  it("clears selected panels and private content when switching accounts", async () => {
    const view = render(
      <SteamToolsPanel accountId="first" libraryPanel={<p>First library</p>} />,
      { wrapper: I18nProvider },
    );
    fireEvent.click(item("Inventory"));
    await screen.findByText("Inventory for first: inventory");
    view.rerender(
      <SteamToolsPanel
        accountId="second"
        libraryPanel={<p>Second library</p>}
      />,
    );
    expect(screen.queryByText(/Inventory for first/)).not.toBeInTheDocument();
    expect(screen.queryByText("First library")).not.toBeInTheDocument();
    expect(item("Boost playtime")).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("region", { name: "Boost playtime" }),
    ).toHaveTextContent("Second library");
    expect(screen.getByTestId("watcher")).toHaveTextContent("second");
  });

  it("passes library and actual activity mode to farming and keeps multiple hubs independent", async () => {
    render(
      <>
        <SteamToolsPanel
          accountId="first"
          library={[{ appId: 730, name: "Counter-Strike 2" }]}
          activityMode="farming"
          accountStatus="boosting"
        />
        <SteamToolsPanel accountId="second" />
      </>,
      { wrapper: I18nProvider },
    );
    const [first, second] = screen.getAllByRole("navigation", {
      name: "Account sections",
    });
    fireEvent.click(
      within(first!).getByRole("button", { name: /^Card farming/ }),
    );
    const panel = await screen.findByRole("region", { name: "Card farming" });
    expect(
      await within(panel).findByText("Farming for first"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Counter-Strike 2")).toBeInTheDocument();
    expect(within(panel).getByText("farming")).toBeInTheDocument();
    expect(within(panel).getByText("boosting")).toBeInTheDocument();
    expect(
      within(second!).getByRole("button", { name: /^Card farming/ }),
    ).not.toHaveAttribute("aria-current");
  });
});
