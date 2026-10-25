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
  stopShort: "Disconnect",
  disconnect: "Disconnect from Steam",
  activityBoosting: "Boosting playtime",
  activityFarming: "Farming cards",
  activityOnline: "Online, no game",
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
  navLabel: "Account sections",
  navActivity: "Activity",
  navItems: "Items",
  navDiscover: "Discover",
  navAccount: "Account",
  inventoryNav: "Inventory",
  listings: "Market listings",
  rules: "Pricing rules",
  planning: "Presets & schedules",
  dropsCount: "{count} drops",
  modeLabel: "Activity reported to Steam",
  modeNone: "Nothing",
  modeNoneOnline: "Online, no game",
  modeNoneOffline: "Not connected",
  modeBoost: "Boost playtime",
  modeBoostGames: "{count} of {limit} games",
  modeBoostEmpty: "Choose games first",
  modeFarm: "Farm cards",
  modeFarmDrops: "{drops} drops in {games} games",
  modeFarmNoDrops: "No card drops found",
  modeFarmUnknown: "Card drops not checked yet",
  modeFarmUnavailable: "Open card farming to check drops",
  modeExplain:
    "Steam keeps one list of running games per account, so only one mode runs at a time. The other mode's selection stays saved.",
  confirmFarming:
    "Switch to card farming? Playtime for your {count} selected games stops; the selection stays saved. When all drops are collected, the account pauses.",
  confirmFarmingIdle:
    "Start card farming? When all drops are collected, the account pauses.",
  farmingConfirm: "Start farming",
  confirmIdle:
    "Stop reporting games to Steam? The account stays connected and paused; your selections stay saved.",
  idleConfirm: "Pause",
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
  stopShort: "Trennen",
  disconnect: "Von Steam trennen",
  activityBoosting: "Spielzeit wird geboostet",
  activityFarming: "Karten werden gefarmt",
  activityOnline: "Online, ohne Spiel",
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
  navLabel: "Konto-Bereiche",
  navActivity: "Aktivität",
  navItems: "Gegenstände",
  navDiscover: "Entdecken",
  navAccount: "Konto",
  inventoryNav: "Inventar",
  listings: "Marktangebote",
  rules: "Preisregeln",
  planning: "Vorlagen & Zeitpläne",
  dropsCount: "{count} Drops",
  modeLabel: "Was dieses Konto an Steam meldet",
  modeNone: "Nichts",
  modeNoneOnline: "Online, ohne Spiel",
  modeNoneOffline: "Nicht verbunden",
  modeBoost: "Spielzeit boosten",
  modeBoostGames: "{count} von {limit} Spielen",
  modeBoostEmpty: "Erst Spiele auswählen",
  modeFarm: "Karten farmen",
  modeFarmDrops: "{drops} Drops in {games} Spielen",
  modeFarmNoDrops: "Keine Kartendrops gefunden",
  modeFarmUnknown: "Kartendrops noch nicht geprüft",
  modeFarmUnavailable: "Karten-Farming öffnen, um Drops zu prüfen",
  modeExplain:
    "Steam kennt pro Konto nur eine Liste laufender Spiele. Deshalb läuft immer genau ein Modus. Die Auswahl des anderen Modus bleibt gespeichert.",
  confirmFarming:
    "Zu Karten farmen wechseln? Die Spielzeit für deine {count} ausgewählten Spiele stoppt, die Auswahl bleibt gespeichert. Sind alle Drops eingesammelt, wird das Konto pausiert.",
  confirmFarmingIdle:
    "Karten farmen starten? Sind alle Drops eingesammelt, wird das Konto pausiert.",
  farmingConfirm: "Farming starten",
  confirmIdle:
    "Keine Spiele mehr an Steam melden? Das Konto bleibt verbunden und pausiert, deine Auswahl bleibt gespeichert.",
  idleConfirm: "Pausieren",
};

export function hubCopy(locale: LocaleCode) {
  return locale === "de" ? de : en;
}
