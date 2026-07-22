import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminOverview } from "../src/api";
import { DataPanel } from "../src/features/admin/DataPanel";
import { I18nProvider } from "../src/i18n";

function overview(appCount = 55, total = appCount): AdminOverview {
  return {
    generatedAt: Date.now(),
    totals: {
      accounts: 0,
      sessions: 0,
      events: 0,
      presets: 0,
      schedules: 0,
      appCache: total,
      libraryEntries: 0,
      selectedGames: 0,
    },
    sessions: [],
    accounts: [],
    events: [],
    presets: [],
    schedules: [],
    apps: Array.from({ length: appCount }, (_, index) => ({
      appId: 1000 + index,
      name: `Game ${index + 1}`,
      playtimeForever: index,
      source: "library",
      updatedAt: Date.now() - index,
      libraryAccountCount: 1,
      selectedAccountCount: 0,
      presetCount: 0,
    })),
  };
}

function renderPanel(value = overview(), onDeleteApp = vi.fn()) {
  const result = render(
    <DataPanel
      overview={value}
      busyAction={null}
      onClearLibrary={vi.fn()}
      onDeleteApp={onDeleteApp}
      onClearUnusedApps={vi.fn()}
    />,
    { wrapper: I18nProvider },
  );
  return { ...result, onDeleteApp };
}

describe("admin app cache pagination", () => {
  afterEach(cleanup);

  it("limits destructive actions to 25 per page", () => {
    renderPanel();
    expect(
      screen.getAllByRole("button", { name: /Delete: Game/ }),
    ).toHaveLength(25);
    expect(screen.getByText(/1.*25.*55/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getAllByRole("button", { name: /Delete: Game/ }),
    ).toHaveLength(25);
    expect(screen.getByText(/26.*50.*55/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getAllByRole("button", { name: /Delete: Game/ }),
    ).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("searches all loaded pages by name or AppID and shows bounded coverage", () => {
    renderPanel(overview(55, 412));
    expect(screen.getByText(/55.*412/)).toBeVisible();
    const search = screen.getByRole("searchbox", { name: /Search app cache/ });

    fireEvent.change(search, { target: { value: "gAmE 54" } });
    expect(screen.getByText("Game 54")).toBeVisible();
    expect(screen.queryByText("Game 1")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "1007" } });
    expect(screen.getByText("Game 8")).toBeVisible();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText(/No matching cache entries/)).toBeVisible();
  });

  it("keeps delete controls app-specific and clamps a shortened final page", () => {
    const onDeleteApp = vi.fn();
    const { rerender } = renderPanel(overview(), onDeleteApp);
    fireEvent.click(screen.getByRole("button", { name: "Delete: Game 1" }));
    expect(onDeleteApp).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 1000, name: "Game 1" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    rerender(
      <DataPanel
        overview={overview(30)}
        busyAction={null}
        onClearLibrary={vi.fn()}
        onDeleteApp={onDeleteApp}
        onClearUnusedApps={vi.fn()}
      />,
    );
    expect(screen.getByText(/26.*30.*30/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText(/1.*25.*30/)).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /Delete: Game/ }),
    ).toHaveLength(25);
  });
});
