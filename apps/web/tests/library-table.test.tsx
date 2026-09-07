import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n";
import { LibraryTable } from "../src/features/library/LibraryTable";
import type { LibraryRow } from "../src/features/library/types";

const row: LibraryRow = {
  appId: 400,
  name: "Portal",
  playtimeForever: 120,
  selected: false,
  blockedByLimit: false,
  favorite: false,
  hidden: false,
};

type LibraryTableProps = ComponentProps<typeof LibraryTable>;

function renderTable({
  onToggleApp = vi.fn(),
  onUpdateMeta = vi.fn(async () => undefined),
}: {
  onToggleApp?: LibraryTableProps["onToggleApp"];
  onUpdateMeta?: LibraryTableProps["onUpdateMeta"];
} = {}) {
  render(
    <LibraryTable
      runtimeStatus="online"
      libraryCount={1}
      rows={[row]}
      modeLabel="All"
      collapsed={false}
      onToggleCollapsed={vi.fn()}
      sorting={[]}
      onSortingChange={vi.fn()}
      onToggleApp={onToggleApp}
      onUpdateMeta={onUpdateMeta}
    />,
    { wrapper: I18nProvider },
  );
  return { onToggleApp, onUpdateMeta };
}

describe("library table keyboard behavior", () => {
  afterEach(cleanup);

  it("keeps row-wide pointer selection without adding a redundant tab stop", () => {
    const { onToggleApp } = renderTable();
    const dataRow = screen.getByText("Portal").closest("tr");

    expect(dataRow).not.toHaveAttribute("tabindex");
    expect(dataRow).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByText("Portal"));
    expect(onToggleApp).toHaveBeenCalledOnce();
    expect(onToggleApp).toHaveBeenCalledWith(400);
  });

  it("lets the native checkbox own keyboard selection", () => {
    const { onToggleApp } = renderTable();
    const checkbox = screen.getByRole("checkbox", { name: /Portal/ });

    fireEvent.keyDown(checkbox, { key: " " });
    expect(onToggleApp).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    expect(onToggleApp).toHaveBeenCalledOnce();
    expect(onToggleApp).toHaveBeenCalledWith(400);
  });

  it("does not turn metadata keyboard actions into selection changes", () => {
    const { onToggleApp, onUpdateMeta } = renderTable();
    const favorite = screen.getByRole("button", {
      name: /Portal.*favorite|favorite.*Portal/i,
    });
    const hide = screen.getByRole("button", {
      name: /hide.*Portal|Portal.*hide/i,
    });

    fireEvent.keyDown(favorite, { key: "Enter" });
    fireEvent.keyDown(hide, { key: " " });
    expect(onToggleApp).not.toHaveBeenCalled();

    fireEvent.click(favorite);
    fireEvent.click(hide);
    expect(onUpdateMeta).toHaveBeenNthCalledWith(1, 400, { favorite: true });
    expect(onUpdateMeta).toHaveBeenNthCalledWith(2, 400, { hidden: true });
    expect(onToggleApp).not.toHaveBeenCalled();
  });

  it("applies controlled sorting on mount and when sorting props change", () => {
    const rows: LibraryRow[] = [
      { ...row, appId: 30, name: "Portal 10", playtimeForever: 60 },
      { ...row, appId: 10, name: "alpha", playtimeForever: 120 },
      { ...row, appId: 20, name: "Portal 2", playtimeForever: 240 },
    ];
    const props: LibraryTableProps = {
      runtimeStatus: "online",
      libraryCount: rows.length,
      rows,
      modeLabel: "All",
      collapsed: false,
      onToggleCollapsed: vi.fn(),
      sorting: [{ id: "name", desc: false }],
      onSortingChange: vi.fn(),
      onToggleApp: vi.fn(),
      onUpdateMeta: vi.fn(async () => undefined),
    };
    const { rerender } = render(<LibraryTable {...props} />, {
      wrapper: I18nProvider,
    });
    const displayedNames = () =>
      screen
        .getAllByRole("checkbox")
        .map(
          (checkbox) =>
            checkbox.closest("tr")?.querySelector("strong")?.textContent,
        );

    expect(displayedNames()).toEqual(["alpha", "Portal 2", "Portal 10"]);

    rerender(
      <LibraryTable
        {...props}
        sorting={[{ id: "playtimeForever", desc: true }]}
      />,
    );
    expect(displayedNames()).toEqual(["Portal 2", "alpha", "Portal 10"]);

    rerender(
      <LibraryTable {...props} sorting={[{ id: "appId", desc: false }]} />,
    );
    expect(displayedNames()).toEqual(["alpha", "Portal 2", "Portal 10"]);

    rerender(<LibraryTable {...props} sorting={[]} />);
    expect(displayedNames()).toEqual(["Portal 10", "alpha", "Portal 2"]);

    rerender(
      <LibraryTable
        {...props}
        rows={rows.map((app) => ({
          ...app,
          selected: app.appId === 20,
          blockedByLimit: app.appId !== 20,
        }))}
      />,
    );
    expect(displayedNames()).toEqual(["alpha", "Portal 2", "Portal 10"]);
    expect(screen.getByRole("checkbox", { name: /Portal 2/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Portal 2/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /alpha/ })).toBeDisabled();
    expect(screen.getByText("Portal 2").closest("tr")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(props.onSortingChange).not.toHaveBeenCalled();
    expect(props.onToggleApp).not.toHaveBeenCalled();
  });
});
