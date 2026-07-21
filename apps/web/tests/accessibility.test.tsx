import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../src/components/ui/dialog";
import { AppShell } from "../src/features/accounts/AppShell";
import { I18nProvider } from "../src/i18n";

describe("accessible application chrome", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
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
    document.body.style.overflow = "";
    document.documentElement.dir = "ltr";
    window.localStorage.clear();
  });

  it("closes a modal on the native Escape event and restores focus", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open modal
          </button>
          {open ? (
            <Dialog title="Modal title" onClose={() => setOpen(false)}>
              <button type="button">Modal action</button>
            </Dialog>
          ) : null}
        </>
      );
    }

    render(<Harness />, { wrapper: I18nProvider });
    const trigger = screen.getByRole("button", { name: "Open modal" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("overflow-x-hidden", "overflow-y-auto");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("exposes mobile locale and theme controls including RTL", async () => {
    window.localStorage.setItem("steam-bee-locale", "en");
    const onThemeChange = vi.fn();
    const { container } = render(
      <AppShell theme="system" onThemeChange={onThemeChange}>
        <main>Content</main>
      </AppShell>,
      { wrapper: I18nProvider },
    );

    const summary = screen.getByLabelText("Open display and language settings");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");

    const locale = container.querySelector<HTMLSelectElement>(
      'select[name="mobile-locale"]',
    );
    const theme = container.querySelector<HTMLSelectElement>(
      'select[name="mobile-theme"]',
    );
    expect(locale).not.toBeNull();
    expect(theme).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Source code" })).toHaveLength(
      2,
    );

    fireEvent.change(theme!, { target: { value: "dark" } });
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    fireEvent.change(locale!, { target: { value: "ar" } });

    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(window.localStorage.getItem("steam-bee-locale")).toBe("ar");
    fireEvent.change(locale!, { target: { value: "en" } });
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
  });

  it("keeps light-theme semantic status text above AA contrast", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    for (const [foreground, background] of [
      ["good", "good-soft"],
      ["warn", "warn-soft"],
    ] as const) {
      const foregroundValue = cssVariable(css, foreground);
      const backgroundValue = cssVariable(css, background);
      expect(
        contrastRatio(foregroundValue, backgroundValue),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function cssVariable(css: string, name: string) {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1];
  if (!value) throw new Error(`Missing hexadecimal CSS variable --${name}.`);
  return value;
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
  return channels
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!,
      0,
    );
}
