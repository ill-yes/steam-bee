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
  InventoryPanel: ({ accountId }: { accountId: string }) => (
    <p>Inventory for {accountId}</p>
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

  it("starts on games with five valid tab and panel relationships", () => {
    render(
      <SteamToolsPanel
        accountId="first"
        libraryPanel={<p>Saved games</p>}
        accountPanel={<p>Account settings</p>}
      />,
      { wrapper: I18nProvider },
    );
    const tabs = within(
      screen.getByRole("tablist", { name: "Account workspace" }),
    ).getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    for (const [index, tab] of tabs.entries()) {
      expect(tab).toHaveAttribute("aria-selected", String(index === 0));
      expect(tab).toHaveAttribute("tabindex", index === 0 ? "0" : "-1");
      const panel = document.getElementById(
        tab.getAttribute("aria-controls")!,
      )!;
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
      expect(panel.hidden).toBe(index !== 0);
    }
    expect(
      screen.getByRole("tabpanel", { name: "Games & playtime" }),
    ).toHaveTextContent("Saved games");
    expect(screen.getByTestId("watcher")).toHaveTextContent("first");
  });

  it("switches full panels without collapsing the active tab or removing the watcher", async () => {
    render(
      <SteamToolsPanel accountId="first" libraryPanel={<p>Saved games</p>} />,
      { wrapper: I18nProvider },
    );
    const inventory = screen.getByRole("tab", { name: "Inventory & market" });
    fireEvent.click(inventory);
    expect(await screen.findByText("Inventory for first")).toBeInTheDocument();
    expect(screen.queryByText("Saved games")).not.toBeInTheDocument();
    fireEvent.click(inventory);
    expect(inventory).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Inventory & market" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Card farming" }));
    expect(await screen.findByText("Farming for first")).toBeInTheDocument();
    expect(screen.queryByText("Inventory for first")).not.toBeInTheDocument();
    expect(screen.getByTestId("watcher")).toBeInTheDocument();
  });

  it("supports arrow, Home and End navigation with one tab stop", async () => {
    render(
      <SteamToolsPanel
        accountId="first"
        accountPanel={<p>Account settings</p>}
      />,
      { wrapper: I18nProvider },
    );
    const library = screen.getByRole("tab", { name: "Games & playtime" });
    library.focus();
    fireEvent.keyDown(library, { key: "ArrowRight" });
    const inventory = screen.getByRole("tab", { name: "Inventory & market" });
    expect(inventory).toHaveFocus();
    expect(inventory).toHaveAttribute("aria-selected", "true");
    await screen.findByText("Inventory for first");
    fireEvent.keyDown(inventory, { key: "End" });
    const account = screen.getByRole("tab", { name: "Account & safety" });
    expect(account).toHaveFocus();
    expect(
      screen.getByRole("tabpanel", { name: "Account & safety" }),
    ).toHaveTextContent("Account settings");
    fireEvent.keyDown(account, { key: "Home" });
    expect(library).toHaveFocus();
    expect(
      screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0),
    ).toEqual([library]);
    fireEvent.keyDown(library, { key: "ArrowLeft" });
    expect(account).toHaveFocus();
  });

  it("clears selected panels and private content when switching accounts", async () => {
    const view = render(
      <SteamToolsPanel accountId="first" libraryPanel={<p>First library</p>} />,
      { wrapper: I18nProvider },
    );
    fireEvent.click(screen.getByRole("tab", { name: "Inventory & market" }));
    await screen.findByText("Inventory for first");
    view.rerender(
      <SteamToolsPanel
        accountId="second"
        libraryPanel={<p>Second library</p>}
      />,
    );
    expect(screen.queryByText("Inventory for first")).not.toBeInTheDocument();
    expect(screen.queryByText("First library")).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Games & playtime" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Games & playtime" }),
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
    const tabs = screen.getAllByRole("tab", { name: "Card farming" });
    expect(tabs[0]!.getAttribute("aria-controls")).not.toBe(
      tabs[1]!.getAttribute("aria-controls"),
    );
    fireEvent.click(tabs[0]!);
    const panel = await screen.findByRole("tabpanel", { name: "Card farming" });
    expect(
      await within(panel).findByText("Farming for first"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Counter-Strike 2")).toBeInTheDocument();
    expect(within(panel).getByText("farming")).toBeInTheDocument();
    expect(within(panel).getByText("boosting")).toBeInTheDocument();
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });
});
