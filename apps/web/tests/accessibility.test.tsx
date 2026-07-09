import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  });
});
