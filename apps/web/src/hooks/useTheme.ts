import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const storageKey = "steam-bee-theme";

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    window.localStorage.setItem(storageKey, theme);
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  return { theme, setTheme };
}
