import type { LocaleCode } from "../../i18n";

const en = {
  title: "Card farming",
  description:
    "Collect remaining Steam trading card drops and track the games being farmed.",
  reviewDraft: "Review & save changes",
  pendingChanges: "Unsaved farming changes",
  savedState: "Your saved farming settings are shown.",
  protectionOn: "Refund protection on",
  protectionOff: "Refund protection off",
  parallelSummary: "Up to {count} warm-up games",
  whitelistSummary: "Only {count} allowed games",
  excludedSummary: "{count} excluded",
  activeGames: "Active farming games",
  hours: "Hours",
  scan: "Find card drops",
  switchCta: "Switch to card farming",
  switchHintManualTitle: "Boosting playtime is running right now",
  switchHintManual:
    "Switching stops playtime for your boost games. Your boost selection stays saved and you can switch back in the header at any time.",
  switchHintIdleTitle: "Card farming is not running",
  switchHintIdle:
    "This account reports no game to Steam right now. Switching starts farming the games below.",
  start: "Start farming",
  refresh: "Refresh",
  lastScan: "Card drops last checked",
  neverScanned: "Card drops have not been checked yet.",
  save: "Save settings",
  discard: "Discard changes",
  discarded: "Draft discarded. Your saved settings are shown.",
  settings: "Farming settings",
  chooseGames: "Choose farming games",
  excluded: "Excluded",
  unknownGame: "App {appId}",
  considerAll: "All games considered",
  gamesPage: "{from}–{to} of {total} games",
  libraryEmpty:
    "No imported games yet. Import your library in Boost playtime, find card drops, or use the advanced AppID fields below.",
  advancedIds: "Advanced: enter AppIDs manually",
  noDrops: "No drops left",
  limitHint:
    "This account can warm up at most {limit} games at once. Higher saved limits are capped automatically.",
  retry: "Try again",
  updated: "Farming status updated.",
  refreshFailed:
    "The latest status could not be confirmed. The last known result is shown. Refresh to try again.",
  invalidLimit: "Enter a whole number from 1 to 32.",
  invalidIds: "Enter up to 500 positive AppIDs, separated by commas or spaces.",
  scanningEmpty: "Checking Steam badges for remaining card drops…",
  progress: {
    config: "Saving settings…",
    scan: "Finding card drops…",
    start: "Starting farming…",
    stop: "Stopping farming…",
    refresh: "Refreshing status…",
  },
  success: {
    config: "Settings saved.",
    scan: "Card drop search complete.",
    start: "Farming request complete. See the current state below.",
    stop: "Farming stopped. The account is paused; farming will only restart when you start it again.",
  },
  reasons: {
    not_connected:
      "The Steam session is offline. Start the account and wait until it is connected before farming.",
    not_running:
      "The account is paused or stopped. Start or resume it in the account controls before farming.",
    manual:
      "The account is manually paused. Resume it in the account controls before farming.",
    pause_until:
      "A timed pause is active. Wait for it to finish or resume the account in the account controls.",
    session_limit:
      "The session playtime limit is reached. Review the safety settings before resuming the account.",
    daily_limit:
      "The daily playtime limit is reached. Wait for the next day or review the safety settings.",
    weekly_limit:
      "The weekly playtime limit is reached. Wait for the next week or review the safety settings.",
    safety_failure:
      "A safety stop needs attention. Check the account status and safety settings before resuming.",
    shutting_down:
      "SteamBee is shutting down. Wait until the service is available again.",
    paused_other_session:
      "This Steam account is being used elsewhere. Finish that session, then resume the account explicitly.",
    login_required:
      "The Steam login needs attention. Sign in again before farming.",
    resumed:
      "Farming resumed automatically after an interruption. Card drops were checked again.",
    shutdown:
      "SteamBee restarted while farming. Farming resumes once the account is online, unless you turned that off.",
    connecting:
      "The Steam connection was interrupted. Farming resumes when the account is online again.",
    reconnecting:
      "The Steam connection was interrupted. Farming resumes when the account is online again.",
    disconnected:
      "The Steam connection was lost. Farming resumes when the account is online again.",
    error:
      "The Steam connection failed. Farming resumes when the account is online again.",
    paused: "You paused the account, so farming stopped.",
    paused_manual: "You paused the account, so farming stopped.",
    "preset-applied": "A preset was applied, so farming stopped.",
  },
  loading: "Loading card farming…",
  failed: "Card farming could not be loaded.",
  max: "Parallel warm-up games",
  whitelist: "Only these AppIDs (optional)",
  blacklist: "Exclude these AppIDs",
  idsHint: "Separate AppIDs with commas or spaces. Exclusions take priority.",
  protect: "Protect refundable games",
  autoResume: "Resume farming after a SteamBee restart",
  protection:
    "Games below two hours are skipped during the first 14 days after acquisition. Unknown purchase dates are also skipped. Disable this only if you accept that additional playtime can affect refunds.",
  unavailable:
    "Farming requires an active Steam session without safety holds. Start or resume the account first.",
  dirty:
    "Save your changes before searching or starting. Your draft is kept in this tab until you save or discard it.",
  empty: "Find card drops to see eligible games.",
  noGames: "No remaining card drops were found.",
  game: "Game",
  playtime: "Hours (estimated while active)",
  state: "State",
  eligible: "Ready",
  active: "Active",
  partial:
    "The badge scan reached its limit. More games may exist; this is a partial result.",
  sessionStopped:
    "Farming halted because the account state, session, selection, or safety policy changed. Start it again explicitly when ready.",
  noEligible:
    "No eligible games remain. Review the refund protection and AppID filters.",
  scanFailed:
    "The badge page could not be read. Check the Steam Community session and try again.",
  farmingFailed:
    "Farming halted after an operation failed. Check the account status before starting again.",
  note: "Drop availability and timing are controlled by Steam. Stopping farming pauses the account; the saved boost selection stays available.",
  phases: {
    stopped: "Stopped",
    scanning: "Scanning badges",
    warming: "Warming to two hours",
    farming: "Farming cards",
    completed: "Finished",
    blocked: "Halted",
    error: "Failed",
  },
  statusRunning: "Running for {duration}",
  dropsOpen: "{count} drops left",
  dropsOpenOne: "1 drop left",
  boardLabel: "Card farming by state",
  colRunning: "Farming now",
  colNext: "Up next",
  colSkipped: "Skipped",
  emptyRunning: "Nothing is being farmed right now.",
  emptyNext: "No other games are waiting.",
  emptySkipped: "No games are skipped.",
  exclude: "Exclude",
  excludeGame: "Exclude {name}",
  allowAgain: "Allow again",
  allowAgainGame: "Allow {name} again",
  allowGame: "Allow",
  allowGameNamed: "Allow {name}",
  adjustProtection: "Change protection",
  showAll: "Show all {count}",
  showFewer: "Show fewer",
  rules: "Rules",
  editRules: "Edit rules",
  rulesDescription:
    "Changes apply right away, even while farming. Exclude or allow single games directly on their cards.",
  autoResumeOn: "Resumes after a restart",
  autoResumeOff: "No automatic resume",
  skipDetail: {
    blacklisted: "Excluded by you",
    not_whitelisted: "Not in your selection",
    refund_window: "Still refundable",
    purchase_date_unknown: "Purchase date unknown",
  },
};

const de: typeof en = {
  title: "Karten farmen",
  description:
    "Sammle verbleibende Steam-Kartendrops und behalte die gefarmten Spiele im Blick.",
  reviewDraft: "Änderungen prüfen & speichern",
  pendingChanges: "Ungespeicherte Farming-Änderungen",
  savedState: "Deine gespeicherten Farming-Einstellungen werden angezeigt.",
  protectionOn: "Erstattungsschutz an",
  protectionOff: "Erstattungsschutz aus",
  parallelSummary: "Bis zu {count} Spiele aufwärmen",
  whitelistSummary: "Nur {count} zugelassene Spiele",
  excludedSummary: "{count} ausgeschlossen",
  activeGames: "Aktive Farming-Spiele",
  hours: "Stunden",
  scan: "Kartendrops suchen",
  switchCta: "Zu Karten farmen wechseln",
  switchHintManualTitle: "Gerade läuft „Spielzeit boosten“",
  switchHintManual:
    "Beim Wechsel stoppt die Spielzeit für deine Boost-Spiele. Die Boost-Auswahl bleibt gespeichert, oben im Kopf kannst du jederzeit zurückwechseln.",
  switchHintIdleTitle: "Karten-Farming läuft gerade nicht",
  switchHintIdle:
    "Dieses Konto meldet gerade kein Spiel an Steam. Beim Wechsel werden die Spiele unten gefarmt.",
  start: "Farming starten",
  refresh: "Aktualisieren",
  lastScan: "Kartendrops zuletzt geprüft",
  neverScanned: "Kartendrops wurden noch nicht geprüft.",
  save: "Einstellungen speichern",
  discard: "Änderungen verwerfen",
  discarded:
    "Entwurf verworfen. Deine gespeicherten Einstellungen werden angezeigt.",
  settings: "Farming-Einstellungen",
  chooseGames: "Spiele fürs Farming auswählen",
  excluded: "Ausschließen",
  unknownGame: "App {appId}",
  considerAll: "Alle Spiele werden berücksichtigt",
  gamesPage: "{from}–{to} von {total} Spielen",
  libraryEmpty:
    "Noch keine Spiele importiert. Importiere deine Bibliothek unter Spielzeit boosten, suche Kartendrops oder nutze unten die erweiterten AppID-Felder.",
  advancedIds: "Erweitert: AppIDs manuell eingeben",
  noDrops: "Keine Drops übrig",
  limitHint:
    "Dieses Konto kann höchstens {limit} Spiele gleichzeitig aufwärmen. Höhere gespeicherte Limits werden automatisch begrenzt.",
  retry: "Erneut versuchen",
  updated: "Farming-Status aktualisiert.",
  refreshFailed:
    "Der neueste Status konnte nicht bestätigt werden. Das zuletzt bekannte Ergebnis wird angezeigt. Versuche es mit Aktualisieren erneut.",
  invalidLimit: "Gib eine ganze Zahl zwischen 1 und 32 ein.",
  invalidIds:
    "Gib höchstens 500 positive AppIDs ein, getrennt durch Kommas oder Leerzeichen.",
  scanningEmpty: "Steam-Abzeichen werden auf verbleibende Kartendrops geprüft…",
  progress: {
    config: "Einstellungen werden gespeichert…",
    scan: "Kartendrops werden gesucht…",
    start: "Farming wird gestartet…",
    stop: "Farming wird gestoppt…",
    refresh: "Status wird aktualisiert…",
  },
  success: {
    config: "Einstellungen gespeichert.",
    scan: "Suche nach Kartendrops abgeschlossen.",
    start:
      "Farming-Anfrage abgeschlossen. Den aktuellen Status siehst du unten.",
    stop: "Farming gestoppt. Das Konto ist pausiert; Farming startet erst wieder, wenn du es ausdrücklich startest.",
  },
  reasons: {
    not_connected:
      "Die Steam-Sitzung ist offline. Starte das Konto und warte auf die Verbindung, bevor du farmst.",
    not_running:
      "Das Konto ist pausiert oder gestoppt. Starte es oder setze es in der Kontosteuerung fort.",
    manual:
      "Das Konto ist manuell pausiert. Setze es vor dem Farming in der Kontosteuerung fort.",
    pause_until:
      "Eine zeitlich begrenzte Pause ist aktiv. Warte bis zum Ende oder setze das Konto in der Kontosteuerung fort.",
    session_limit:
      "Das Spielzeitlimit dieser Sitzung ist erreicht. Prüfe die Sicherheitseinstellungen, bevor du das Konto fortsetzt.",
    daily_limit:
      "Das tägliche Spielzeitlimit ist erreicht. Warte auf den nächsten Tag oder prüfe die Sicherheitseinstellungen.",
    weekly_limit:
      "Das wöchentliche Spielzeitlimit ist erreicht. Warte auf die nächste Woche oder prüfe die Sicherheitseinstellungen.",
    safety_failure:
      "Ein Sicherheitsstopp benötigt deine Aufmerksamkeit. Prüfe den Kontostatus und die Sicherheitseinstellungen.",
    shutting_down:
      "SteamBee wird beendet. Warte, bis der Dienst wieder verfügbar ist.",
    paused_other_session:
      "Dieses Steam-Konto wird woanders verwendet. Beende die andere Sitzung und setze das Konto danach ausdrücklich fort.",
    login_required:
      "Die Steam-Anmeldung benötigt deine Aufmerksamkeit. Melde dich vor dem Farming erneut an.",
    resumed:
      "Das Farming wurde nach einer Unterbrechung automatisch fortgesetzt. Die Kartendrops wurden neu geprüft.",
    shutdown:
      "SteamBee wurde während des Farmings neu gestartet. Das Farming geht weiter, sobald das Konto online ist, außer du hast das abgeschaltet.",
    connecting:
      "Die Verbindung zu Steam wurde unterbrochen. Das Farming geht weiter, sobald das Konto wieder online ist.",
    reconnecting:
      "Die Verbindung zu Steam wurde unterbrochen. Das Farming geht weiter, sobald das Konto wieder online ist.",
    disconnected:
      "Die Verbindung zu Steam ist abgerissen. Das Farming geht weiter, sobald das Konto wieder online ist.",
    error:
      "Die Verbindung zu Steam ist fehlgeschlagen. Das Farming geht weiter, sobald das Konto wieder online ist.",
    paused: "Du hast das Konto pausiert, deshalb wurde das Farming gestoppt.",
    paused_manual:
      "Du hast das Konto pausiert, deshalb wurde das Farming gestoppt.",
    "preset-applied":
      "Ein Preset wurde angewendet, deshalb wurde das Farming gestoppt.",
  },
  loading: "Sammelkarten werden geladen…",
  failed: "Sammelkarten konnten nicht geladen werden.",
  max: "Parallele Spiele bis zwei Stunden",
  whitelist: "Nur diese AppIDs (optional)",
  blacklist: "Diese AppIDs ausschließen",
  idsHint:
    "AppIDs durch Kommas oder Leerzeichen trennen. Ausschlüsse haben Vorrang.",
  protect: "Erstattungsfähige Spiele schützen",
  autoResume: "Nach einem Neustart von SteamBee automatisch weiterfarmen",
  protection:
    "Spiele unter zwei Stunden werden in den ersten 14 Tagen nach Erwerb übersprungen. Bei unbekanntem Kaufdatum werden sie ebenfalls übersprungen. Deaktiviere dies nur, wenn du Auswirkungen zusätzlicher Spielzeit auf Erstattungen akzeptierst.",
  unavailable:
    "Farming benötigt eine aktive Steam-Sitzung ohne Sicherheitssperre. Starte das Konto oder setze es zuerst fort.",
  dirty:
    "Speichere Änderungen vor der Suche oder dem Start. Dein Entwurf bleibt in diesem Tab erhalten, bis du ihn speicherst oder verwirfst.",
  empty: "Suche Kartendrops, um geeignete Spiele anzuzeigen.",
  noGames: "Keine verbleibenden Kartendrops gefunden.",
  game: "Spiel",
  playtime: "Stunden (bei Aktivität geschätzt)",
  state: "Status",
  eligible: "Bereit",
  active: "Aktiv",
  partial:
    "Die Abzeichensuche hat ihr Limit erreicht. Weitere Spiele sind möglich; dies ist ein Teilergebnis.",
  sessionStopped:
    "Farming wurde wegen eines geänderten Konto-, Sitzungs-, Auswahl- oder Sicherheitsstatus angehalten. Starte es bei Bedarf ausdrücklich erneut.",
  noEligible:
    "Keine geeigneten Spiele übrig. Prüfe Erstattungsschutz und AppID-Filter.",
  scanFailed:
    "Die Abzeichenseite konnte nicht gelesen werden. Prüfe die Steam-Community-Sitzung und versuche es erneut.",
  farmingFailed:
    "Farming wurde nach einem fehlgeschlagenen Vorgang angehalten. Prüfe vor einem erneuten Start den Kontostatus.",
  note: "Steam bestimmt Verfügbarkeit und Zeitpunkt der Drops. Das Stoppen pausiert das Konto; die gespeicherte Boost-Auswahl bleibt verfügbar.",
  phases: {
    stopped: "Gestoppt",
    scanning: "Abzeichen werden gesucht",
    warming: "Aufwärmen bis zwei Stunden",
    farming: "Karten werden gefarmt",
    completed: "Abgeschlossen",
    blocked: "Angehalten",
    error: "Fehlgeschlagen",
  },
  statusRunning: "Läuft seit {duration}",
  dropsOpen: "{count} Drops offen",
  dropsOpenOne: "1 Drop offen",
  boardLabel: "Karten-Farming nach Zustand",
  colRunning: "Läuft jetzt",
  colNext: "Als Nächstes",
  colSkipped: "Übersprungen",
  emptyRunning: "Gerade wird nichts gefarmt.",
  emptyNext: "Keine weiteren Spiele in der Warteschlange.",
  emptySkipped: "Kein Spiel wird übersprungen.",
  exclude: "Ausschließen",
  excludeGame: "{name} ausschließen",
  allowAgain: "Wieder zulassen",
  allowAgainGame: "{name} wieder zulassen",
  allowGame: "Zulassen",
  allowGameNamed: "{name} zulassen",
  adjustProtection: "Schutz anpassen",
  showAll: "Alle {count} anzeigen",
  showFewer: "Weniger anzeigen",
  rules: "Regeln",
  editRules: "Regeln bearbeiten",
  rulesDescription:
    "Änderungen gelten sofort, auch während des Farmings. Einzelne Spiele schließt du direkt auf ihrer Karte aus oder lässt sie zu.",
  autoResumeOn: "Nach Neustart weiter",
  autoResumeOff: "Kein automatischer Neustart",
  skipDetail: {
    blacklisted: "Von dir ausgeschlossen",
    not_whitelisted: "Nicht in deiner Auswahl",
    refund_window: "Noch erstattbar",
    purchase_date_unknown: "Kaufdatum unbekannt",
  },
};

export function farmingCopy(locale: LocaleCode) {
  return locale === "de" ? de : en;
}
