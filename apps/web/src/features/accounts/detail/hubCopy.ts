import type { LocaleCode } from "../../../i18n";

const en = {
  workspace: "Account workspace",
  library: "Games & playtime",
  inventory: "Inventory & market",
  farming: "Card farming",
  offers: "Free game offers",
  account: "Account & safety",
  activeGames: "Currently reported to Steam",
  activeGamesShort: "Active games",
  activeGamesScroll: "Active games; scroll horizontally for more",
  noActiveGames: "No games are currently reported to Steam.",
  manual: "Manual playtime",
  farm: "Card farming + playtime",
  idle: "Idle",
  switchManual: "Switch to manual game selection",
  switchManualShort: "Manual",
  logsShort: "Logs",
  pauseShort: "Pause",
  stopShort: "Stop",
  switchConfirm: "Switch mode",
  confirmSwitch:
    "Stop card farming and resume playtime for your saved manual game selection? Farming will not restart automatically.",
  switchApply:
    "Card farming is active. Applying this manual selection stops farming and switches this account to manual playtime. Continue?",
  switchSettings:
    "Card farming is active. Changing these account settings stops farming and returns this account to its saved manual game selection. Continue?",
  switchPreset:
    "Card farming is active. Applying this preset stops farming and switches this account to the preset's manual game selection. Continue?",
  farmingSelectionHint:
    "Card farming is active. This is your saved manual selection. Applying it stops farming; navigating between tabs does not change the current activity.",
  savedSelection: "Saved manual games",
  savedSelectionHint:
    "Saved for manual playtime; farming uses the games shown above.",
  farmingStatusHint:
    "Card farming controls the active games shown above. Your saved manual selection stays available in Games & playtime.",
  openAccount: "Open account & safety",
};
const de: typeof en = {
  workspace: "Konto-Arbeitsbereich",
  library: "Spiele & Spielzeit",
  inventory: "Inventar & Markt",
  farming: "Karten-Farming",
  offers: "Gratisangebote",
  account: "Konto & Sicherheit",
  activeGames: "Gerade an Steam gemeldet",
  activeGamesShort: "Aktive Spiele",
  activeGamesScroll: "Aktive Spiele; für weitere seitlich scrollen",
  noActiveGames: "Gerade werden keine Spiele an Steam gemeldet.",
  manual: "Manuelle Spielzeit",
  farm: "Karten-Farming + Spielzeit",
  idle: "Inaktiv",
  switchManual: "Zur manuellen Spielauswahl wechseln",
  switchManualShort: "Manuell",
  logsShort: "Logs",
  pauseShort: "Pause",
  stopShort: "Stop",
  switchConfirm: "Modus wechseln",
  confirmSwitch:
    "Karten-Farming stoppen und die Spielzeit für deine gespeicherte manuelle Spielauswahl fortsetzen? Farming startet nicht automatisch neu.",
  switchApply:
    "Karten-Farming ist aktiv. Das Anwenden dieser manuellen Auswahl stoppt Farming und wechselt dieses Konto zur manuellen Spielzeit. Fortfahren?",
  switchSettings:
    "Karten-Farming ist aktiv. Das Ändern dieser Kontoeinstellungen stoppt Farming und setzt die gespeicherte manuelle Spielauswahl fort. Fortfahren?",
  switchPreset:
    "Karten-Farming ist aktiv. Das Anwenden dieser Vorlage stoppt Farming und wechselt dieses Konto zur manuellen Spielauswahl der Vorlage. Fortfahren?",
  farmingSelectionHint:
    "Karten-Farming ist aktiv. Hier siehst du deine gespeicherte manuelle Auswahl. Das Anwenden stoppt Farming; ein Tabwechsel ändert die laufende Aktivität nicht.",
  savedSelection: "Gespeicherte manuelle Spiele",
  savedSelectionHint:
    "Für manuelle Spielzeit gespeichert; Farming verwendet die oben angezeigten Spiele.",
  farmingStatusHint:
    "Karten-Farming steuert die oben angezeigten aktiven Spiele. Deine gespeicherte manuelle Auswahl bleibt unter Spiele & Spielzeit verfügbar.",
  openAccount: "Konto & Sicherheit öffnen",
};

export function hubCopy(locale: LocaleCode) {
  return locale === "de" ? de : en;
}
