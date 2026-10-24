import { useEffect, useState } from "react";

export const themePreferences = [
  "system",
  "light",
  "dark",
  "midnight",
  "forest",
  "paper",
] as const;
export type ThemePreference = (typeof themePreferences)[number];

export const fontPreferences = ["system", "humanist", "serif", "mono"] as const;
export type FontPreference = (typeof fontPreferences)[number];

const storageKey = "steam-bee-theme";

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(readStoredTheme);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setTheme(readStoredTheme());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    try {
      window.localStorage?.setItem(storageKey, theme);
    } catch {
      // Theme selection still works in memory when storage is unavailable.
    }
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  return { theme, setTheme };
}

function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage?.getItem(storageKey);
    if (themePreferences.includes(stored as ThemePreference)) {
      return stored as ThemePreference;
    }
  } catch {
    // System preference remains the fallback without storage access.
  }
  return "system";
}

export function useFontPreference() {
  const readFont = (): FontPreference => {
    if (typeof window === "undefined") return "system";
    try {
      const stored = window.localStorage?.getItem("steam-bee-font");
      if (fontPreferences.includes(stored as FontPreference)) {
        return stored as FontPreference;
      }
    } catch {
      // Font selection remains available without storage access.
    }
    return "system";
  };
  const [font, setFont] = useState<FontPreference>(readFont);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "steam-bee-font" || event.key === null)
        setFont(readFont());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    try {
      window.localStorage?.setItem("steam-bee-font", font);
    } catch {
      // The current session can still use the selected font.
    }
    if (font === "system") {
      document.documentElement.removeAttribute("data-font");
    } else {
      document.documentElement.setAttribute("data-font", font);
    }
  }, [font]);

  return { font, setFont };
}
