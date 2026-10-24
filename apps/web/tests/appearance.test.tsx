import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/features/accounts/AppShell";
import { useTheme } from "../src/hooks/useTheme";
import { I18nProvider } from "../src/i18n";

function Harness() {
  const { theme, setTheme } = useTheme();
  return (
    <I18nProvider>
      <AppShell theme={theme} onThemeChange={setTheme}>
        <main>
          <button type="button">Outside preferences</button>
        </main>
      </AppShell>
    </I18nProvider>
  );
}

describe("appearance preferences", () => {
  beforeEach(() => {
    const values = new Map<string, string>([["steam-bee-locale", "en"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      } satisfies Storage,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-font");
  });

  it.each(["light", "dark", "midnight", "forest", "paper"])(
    "restores the saved %s palette and font",
    (theme) => {
      window.localStorage.setItem("steam-bee-theme", theme);
      window.localStorage.setItem("steam-bee-font", "serif");

      render(<Harness />);

      expect(document.documentElement).toHaveAttribute("data-theme", theme);
      expect(document.documentElement).toHaveAttribute("data-font", "serif");
    },
  );

  it("shares persisted theme and font changes between desktop and mobile controls", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByLabelText("Appearance settings"));
    const desktop = screen
      .getByLabelText("Appearance settings")
      .closest("details")!;
    fireEvent.change(
      within(desktop).getByRole("combobox", { name: "Theme mode" }),
      {
        target: { value: "midnight" },
      },
    );
    fireEvent.change(
      within(desktop).getByRole("combobox", { name: "Select interface font" }),
      { target: { value: "mono" } },
    );

    fireEvent.click(
      screen.getByLabelText("Open display and language settings"),
    );
    const mobileTheme = container.querySelector('select[name="mobile-theme"]')!;
    const mobileFont = container.querySelector('select[name="mobile-font"]')!;
    expect(mobileTheme).toHaveValue("midnight");
    expect(mobileFont).toHaveValue("mono");
    expect(window.localStorage.getItem("steam-bee-theme")).toBe("midnight");
    expect(window.localStorage.getItem("steam-bee-font")).toBe("mono");
    expect(document.documentElement).toHaveAttribute("data-font", "mono");

    fireEvent.change(mobileTheme, { target: { value: "system" } });
    fireEvent.change(mobileFont, { target: { value: "system" } });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(document.documentElement).not.toHaveAttribute("data-font");
    expect(
      within(desktop).getByRole("combobox", { name: "Theme mode" }),
    ).toHaveValue("system");
  });

  it("rejects unknown saved appearance preferences", () => {
    window.localStorage.setItem("steam-bee-theme", "custom-background");
    window.localStorage.setItem(
      "steam-bee-font",
      "https://example.com/font.woff",
    );
    render(<Harness />);

    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(document.documentElement).not.toHaveAttribute("data-font");
    expect(window.localStorage.getItem("steam-bee-theme")).toBe("system");
    expect(window.localStorage.getItem("steam-bee-font")).toBe("system");
  });

  it("allows preference changes when browser storage is unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    const { container } = render(<Harness />);
    const theme = container.querySelector('select[name="theme"]')!;
    const font = container.querySelector('select[name="font"]')!;

    fireEvent.change(theme, { target: { value: "forest" } });
    fireEvent.change(font, { target: { value: "humanist" } });

    expect(document.documentElement).toHaveAttribute("data-theme", "forest");
    expect(document.documentElement).toHaveAttribute("data-font", "humanist");
  });

  it("localizes the appearance controls in German", () => {
    window.localStorage.setItem("steam-bee-locale", "de");
    render(<Harness />);
    const trigger = screen.getByLabelText("Darstellung einstellen");
    fireEvent.click(trigger);
    const menu = within(trigger.closest("details")!);

    expect(
      menu.getByRole("combobox", { name: "Schriftart auswählen" }),
    ).toBeInTheDocument();
    expect(
      menu.getByRole("option", { name: "Mitternacht" }),
    ).toBeInTheDocument();
    expect(
      menu.getByRole("option", { name: "Klassische Serifenschrift" }),
    ).toBeInTheDocument();
  });

  it("closes preferences with Escape and restores focus to their trigger", () => {
    render(<Harness />);
    const trigger = screen.getByLabelText("Appearance settings");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = trigger.closest("details")!;
    const font = within(menu).getByRole("combobox", {
      name: "Select interface font",
    });
    font.focus();
    fireEvent.keyDown(font, { key: "Escape" });
    expect(menu).not.toHaveAttribute("open");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(
      document.getElementById(trigger.getAttribute("aria-controls")!),
    ).toBeInTheDocument();
  });

  it("dismisses on outside pointer without moving focus back into the popover", () => {
    render(<Harness />);
    const trigger = screen.getByLabelText("Appearance settings");
    fireEvent.click(trigger);
    const outside = screen.getByRole("button", { name: "Outside preferences" });
    fireEvent.pointerDown(outside);
    outside.focus();
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    expect(outside).toHaveFocus();
  });

  it("keeps the popover open between its fields and closes when focus leaves", () => {
    render(<Harness />);
    const trigger = screen.getByLabelText("Appearance settings");
    fireEvent.click(trigger);
    const menu = trigger.closest("details")!;
    const theme = within(menu).getByRole("combobox", { name: "Theme mode" });
    const font = within(menu).getByRole("combobox", {
      name: "Select interface font",
    });
    theme.focus();
    font.focus();
    expect(menu).toHaveAttribute("open");
    screen.getByRole("button", { name: "Outside preferences" }).focus();
    expect(menu).not.toHaveAttribute("open");
  });

  it("closes hidden popovers when the layout crosses the desktop breakpoint", () => {
    const layout = new EventTarget();
    const matchMedia = vi.fn(() => ({
      addEventListener: layout.addEventListener.bind(layout),
      removeEventListener: layout.removeEventListener.bind(layout),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    render(<Harness />);
    const trigger = screen.getByLabelText("Open display and language settings");
    fireEvent.click(trigger);
    expect(trigger.closest("details")).toHaveAttribute("open");
    act(() => layout.dispatchEvent(new Event("change")));
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(trigger.closest("details")).not.toHaveAttribute("open");
  });

  it("synchronizes valid preferences and storage resets across browser tabs", () => {
    render(<Harness />);
    act(() => {
      window.localStorage.setItem("steam-bee-theme", "forest");
      window.localStorage.setItem("steam-bee-font", "mono");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "steam-bee-theme" }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: "steam-bee-font" }),
      );
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "forest");
    expect(document.documentElement).toHaveAttribute("data-font", "mono");
    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(document.documentElement).not.toHaveAttribute("data-font");
  });

  it("offers built-in palettes and local fonts without background customization", () => {
    const { container } = render(<Harness />);
    const trigger = screen.getByLabelText("Appearance settings");
    fireEvent.click(trigger);
    const menu = within(trigger.closest("details")!);
    expect(menu.getAllByRole("combobox")).toHaveLength(2);
    expect(menu.queryByText(/background/i)).not.toBeInTheDocument();
    expect(
      container.querySelector(
        'input[type="file"],input[type="url"],input[type="color"]',
      ),
    ).toBeNull();
  });
});

describe("built-in palette readability", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const rules = [...css.matchAll(/(:root[^{}]*)\{([^{}]*)\}/g)];
  const variables = (selector: string) => {
    const matchingRules = rules.filter(([_, selectors]) =>
      selectors!.split(",").some((value) => value.trim() === selector),
    );
    if (matchingRules.length === 0)
      throw new Error(`Missing palette ${selector}`);
    return Object.fromEntries(
      matchingRules.flatMap((rule) =>
        [...rule[2]!.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(
          ([_, key, value]) => [key, value!],
        ),
      ),
    );
  };

  it.each(["light", "dark", "midnight", "forest", "paper"])(
    "%s keeps interface and button text at AA contrast",
    (theme) => {
      // Explicit palettes must retain their own light/dark basis regardless of
      // the user's OS preference. Apply the shared basis before the overrides.
      const palette = {
        ...variables(":root"),
        ...(["dark", "midnight", "forest"].includes(theme)
          ? variables(':root[data-theme="dark"]')
          : {}),
        ...variables(`:root[data-theme="${theme}"]`),
      };
      for (const foreground of ["ink", "muted", "muted-strong"]) {
        for (const background of [
          "bg",
          "topbar",
          "surface",
          "surface-2",
          "surface-3",
          "input",
          "selected",
        ]) {
          expect(
            contrast(palette[foreground]!, palette[background]!),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrast(palette["primary-fg"]!, palette.primary!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(palette["primary-fg"]!, palette["primary-hover"]!),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

function contrast(first: string, second: string) {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      )
      .reduce(
        (sum, channel, index) =>
          sum + channel * [0.2126, 0.7152, 0.0722][index]!,
        0,
      );
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
