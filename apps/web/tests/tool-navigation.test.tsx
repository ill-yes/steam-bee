import { useRef, useState } from "react";
import { Layers } from "lucide-react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ToolPageHeader,
  ToolRefreshButton,
} from "../src/components/ui/tool-page-header";
import { ToolTabs } from "../src/components/ui/tool-tabs";
import { I18nProvider } from "../src/i18n";

const items = [
  { id: "inventory", label: "Inventory", count: 12 },
  { id: "market", label: "Market" },
  { id: "pricing", label: "Price rules" },
] as const;

function Workspace({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState<string>("inventory");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ToolTabs
        label="Inventory views"
        items={items}
        value={value}
        onChange={setValue}
      >
        {items.map((item) => (
          <div key={item.id} hidden={value !== item.id}>
            <label>
              {item.label} draft
              <input defaultValue="" />
            </label>
          </div>
        ))}
      </ToolTabs>
    </form>
  );
}

describe("tool page navigation", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => "en", setItem: vi.fn() },
    });
  });
  afterEach(cleanup);

  it("keeps a single tab stop, labelled content and drafts when switching views", () => {
    const submit = vi.fn();
    render(<Workspace onSubmit={submit} />, { wrapper: I18nProvider });
    const inventory = screen.getByRole("tab", { name: "Inventory 12" });
    const market = screen.getByRole("tab", { name: "Market" });
    const input = screen.getByRole("textbox", { name: "Inventory draft" });
    fireEvent.change(input, { target: { value: "unsaved" } });
    fireEvent.click(market);
    expect(screen.getByRole("tabpanel", { name: "Market" })).toContainElement(
      screen.getByRole("textbox", { name: "Market draft" }),
    );
    expect(
      screen.queryByRole("textbox", { name: "Inventory draft" }),
    ).toBeNull();
    fireEvent.keyDown(market, { key: "Home" });
    expect(inventory).toHaveFocus();
    expect(input).toHaveValue("unsaved");
    fireEvent.keyDown(inventory, { key: "ArrowLeft" });
    const pricing = screen.getByRole("tab", { name: "Price rules" });
    expect(pricing).toHaveFocus();
    fireEvent.keyDown(pricing, { key: "ArrowRight" });
    expect(inventory).toHaveFocus();
    fireEvent.keyDown(inventory, { key: "End" });
    expect(pricing).toHaveFocus();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([pricing]);
    expect(tabs.every((tab) => tab.getAttribute("type") === "button")).toBe(
      true,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("reverses arrow navigation in right-to-left locales", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => "ar", setItem: vi.fn() },
    });
    render(<Workspace onSubmit={vi.fn()} />, { wrapper: I18nProvider });
    const inventory = screen.getByRole("tab", { name: "Inventory 12" });
    fireEvent.keyDown(inventory, { key: "ArrowLeft" });
    const market = screen.getByRole("tab", { name: "Market" });
    expect(market).toHaveFocus();
    expect(market).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(market, { key: "ArrowRight" });
    expect(inventory).toHaveFocus();
  });

  it("provides a stable heading focus target and blocks duplicate refreshes", () => {
    const refresh = vi.fn();
    function Page({ busy }: { busy: boolean }) {
      const heading = useRef<HTMLHeadingElement>(null);
      return (
        <>
          <ToolPageHeader
            icon={Layers}
            title="Inventory"
            description="Manage your cards."
            titleRef={heading}
            actions={
              <ToolRefreshButton
                label="Refresh inventory"
                busy={busy}
                onClick={refresh}
              />
            }
          />
          <button type="button" onClick={() => heading.current?.focus()}>
            Return to overview
          </button>
        </>
      );
    }
    const view = render(<Page busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to overview" }));
    expect(screen.getByRole("heading", { name: "Inventory" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    view.rerender(<Page busy />);
    const button = screen.getByRole("button", { name: "Refresh inventory" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
