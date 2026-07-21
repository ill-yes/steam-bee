import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function renderTable({
  onToggleApp = vi.fn(),
  onUpdateMeta = vi.fn(async () => undefined),
}: {
  onToggleApp?: ReturnType<typeof vi.fn>;
  onUpdateMeta?: ReturnType<typeof vi.fn>;
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
});
