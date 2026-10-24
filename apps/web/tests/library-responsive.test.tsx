import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n";
import { LibraryTable } from "../src/features/library/LibraryTable";
import type { LibraryRow } from "../src/features/library/types";
import { maxVisibleLibraryRows } from "../src/lib/status";

type LibraryTableProps = ComponentProps<typeof LibraryTable>;
const name =
  "A very long Steam game title that must remain readable on a narrow screen";
const game: LibraryRow = {
  appId: 400,
  name,
  playtimeForever: 120,
  selected: true,
  blockedByLimit: false,
  favorite: false,
  hidden: false,
};
const props = (rows: LibraryRow[] = [game]): LibraryTableProps => ({
  runtimeStatus: "online",
  libraryCount: rows.length,
  rows,
  modeLabel: "All",
  collapsed: false,
  onToggleCollapsed: vi.fn(),
  sorting: [],
  onSortingChange: vi.fn(),
  onToggleApp: vi.fn(),
  onUpdateMeta: vi.fn(async () => undefined),
});

describe("responsive game library", () => {
  let width: number;
  let resize: (nextWidth: number) => void;
  const disconnect = vi.fn();

  beforeEach(() => {
    width = 390;
    disconnect.mockClear();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, width, 600),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          resize = (nextWidth: number) => {
            width = nextWidth;
            this.callback(
              [
                {
                  target,
                  contentRect: new DOMRect(0, 0, width, 600),
                } as ResizeObserverEntry,
              ],
              this as unknown as ResizeObserver,
            );
          };
        }
        disconnect() {
          disconnect();
        }
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a readable narrow list with one checkbox and reachable metadata actions per game", () => {
    const blocked = {
      ...game,
      appId: 500,
      name: "Blocked game",
      selected: false,
      blockedByLimit: true,
    };
    const callbacks = props([game, blocked]);
    render(<LibraryTable {...callbacks} />, { wrapper: I18nProvider });

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText(name)).toHaveClass("break-words");
    expect(screen.getByText(name)).not.toHaveClass("truncate");
    expect(screen.getByText("AppID: 400")).toBeVisible();
    const checkbox = screen.getByRole("checkbox", { name: `Select ${name}` });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Select Blocked game" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByText(name));
    expect(callbacks.onToggleApp).toHaveBeenCalledExactlyOnceWith(400);
    fireEvent.click(screen.getByText("Blocked game"));
    expect(callbacks.onToggleApp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: `Favorite ${name}` }));
    fireEvent.click(screen.getByRole("button", { name: `Hide ${name}` }));
    expect(callbacks.onUpdateMeta).toHaveBeenNthCalledWith(1, 400, {
      favorite: true,
    });
    expect(callbacks.onUpdateMeta).toHaveBeenNthCalledWith(2, 400, {
      hidden: true,
    });
    expect(callbacks.onToggleApp).toHaveBeenCalledTimes(1);
  });

  it("switches between one list and one table while retaining controlled sorting and selection", () => {
    const callbacks = {
      ...props([
        { ...game, appId: 2, name: "Zulu", selected: false },
        { ...game, appId: 1, name: "Alpha" },
      ]),
      sorting: [{ id: "name", desc: false }],
    };
    const view = render(<LibraryTable {...callbacks} />, {
      wrapper: I18nProvider,
    });
    const names = (tag: "li" | "tr") =>
      screen
        .getAllByRole("checkbox")
        .map(
          (checkbox) =>
            checkbox.closest(tag)?.querySelector("strong")?.textContent,
        );
    expect(names("li")).toEqual(["Alpha", "Zulu"]);
    act(() => resize(1000));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(names("tr")).toEqual(["Alpha", "Zulu"]);
    expect(
      screen.getByRole("checkbox", { name: "Select Alpha" }),
    ).toBeChecked();
    act(() => resize(390));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(names("li")).toEqual(["Alpha", "Zulu"]);
    view.rerender(<LibraryTable {...callbacks} collapsed />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    view.rerender(<LibraryTable {...callbacks} />);
    expect(names("li")).toEqual(["Alpha", "Zulu"]);
    expect(disconnect).toHaveBeenCalled();
    expect(callbacks.onToggleApp).not.toHaveBeenCalled();
  });

  it("keeps the same sorted row cap in compact mode", () => {
    const rows = Array.from(
      { length: maxVisibleLibraryRows + 1 },
      (_, index) => ({ ...game, appId: index + 1, name: `Game ${index + 1}` }),
    );
    render(
      <LibraryTable {...props(rows)} sorting={[{ id: "appId", desc: true }]} />,
      { wrapper: I18nProvider },
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(maxVisibleLibraryRows);
    expect(screen.getAllByRole("checkbox")).toHaveLength(maxVisibleLibraryRows);
    expect(
      screen.queryByRole("checkbox", { name: "Select Game 1" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      `Game ${maxVisibleLibraryRows + 1}`,
    );
  });
});
