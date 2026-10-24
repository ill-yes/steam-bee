import type { LocaleCode } from "../../i18n";

const en = {
  appearance: "Appearance",
  appearanceAria: "Appearance settings",
  font: "Interface font",
  fontAria: "Select interface font",
  localFonts: "Fonts use the typefaces installed on this device.",
  themes: { midnight: "Midnight", forest: "Forest", paper: "Paper" },
  fonts: {
    system: "System default",
    humanist: "Humanist sans",
    serif: "Classic serif",
    mono: "Monospace",
  },
};

const de: typeof en = {
  appearance: "Darstellung",
  appearanceAria: "Darstellung einstellen",
  font: "Schriftart",
  fontAria: "Schriftart auswählen",
  localFonts: "Verwendet Schriftarten, die auf diesem Gerät installiert sind.",
  themes: { midnight: "Mitternacht", forest: "Wald", paper: "Papier" },
  fonts: {
    system: "Systemstandard",
    humanist: "Humanistische Sans",
    serif: "Klassische Serifenschrift",
    mono: "Monospace",
  },
};

export function appearanceCopy(locale: LocaleCode) {
  return locale === "de" ? de : en;
}
