import { Select } from "../../components/ui/form";
import {
  fontPreferences,
  themePreferences,
  type FontPreference,
  type ThemePreference,
} from "../../hooks/useTheme";
import { useI18n } from "../../i18n";
import { appearanceCopy } from "./copy";

export function AppearancePreferences({
  theme,
  onThemeChange,
  font,
  onFontChange,
  mobile = false,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  font: FontPreference;
  onFontChange: (font: FontPreference) => void;
  mobile?: boolean;
}) {
  const { locale, messages: t } = useI18n();
  const copy = appearanceCopy(locale);
  const themeLabels: Record<ThemePreference, string> = {
    system: t.common.system,
    light: t.common.light,
    dark: t.common.dark,
    ...copy.themes,
  };

  return (
    <>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted-strong)]">
        {t.appShell.themeLabel}
        <Select
          name={mobile ? "mobile-theme" : "theme"}
          value={theme}
          onChange={(event) =>
            onThemeChange(event.target.value as ThemePreference)
          }
          aria-label={t.appShell.themeAria}
        >
          {themePreferences.map((value) => (
            <option key={value} value={value}>
              {themeLabels[value]}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted-strong)]">
        {copy.font}
        <Select
          name={mobile ? "mobile-font" : "font"}
          value={font}
          onChange={(event) =>
            onFontChange(event.target.value as FontPreference)
          }
          aria-label={copy.fontAria}
        >
          {fontPreferences.map((value) => (
            <option key={value} value={value}>
              {copy.fonts[value]}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-xs font-normal leading-5 text-[var(--muted)]">
        {copy.localFonts}
      </p>
    </>
  );
}
