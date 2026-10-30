const en = {
  title: "Free to keep",
  description:
    "Steam sometimes gives games away for a short time. Claim one in time and it stays in your library for good.",
  howTitle: "How this works",
  howCheck: "SteamBee regularly checks the Steam store for games at −100 %.",
  howOwned: "Games this account already owns are hidden.",
  howClaim:
    "You claim a game in the store yourself. SteamBee never buys anything.",
  refresh: "Refresh",
  refreshing: "Refreshing offers…",
  loading: "Checking Steam offers…",
  emptyTitle: "No free game offers right now",
  empty: "No temporary free game offers found in the checked results.",
  staleEmpty:
    "There were no offers in the last successful check. Current availability could not be verified.",
  openStore: "Claim in store",
  offerLabel: "−100 % · free",
  regionLabel: "US store offers",
  region: "Availability and terms may differ in your region.",
  offerDetails: "Region & ownership details",
  checked: "Store last checked",
  ownership: "Owned games excluded using the library imported on",
  ownershipHelp:
    "Games acquired since that import may still appear. Import the library again to update ownership.",
  excluded: "Owned offers excluded",
  checkAgain: "Check again",
  notificationSetup: "Set up offer notices",
  noLibrary:
    "Import this account’s library to exclude owned games and enable offer notices. Until then, these results may include games you own.",
  stale:
    "Steam is unavailable. These cached offers may have expired; check their current price in Steam.",
  refreshFailed:
    "The last loaded results are still shown. This refresh could not verify their current availability.",
  truncated:
    "Only the first 300 search results were checked. More offers may be available on Steam.",
  notifications: "Notify me about new offers",
  notificationTitle: "Don’t miss the next offer",
  notificationSummary:
    "Get a notice when a new offer appears for this account.",
  notificationDetails: "How offer notices work",
  stopNotifications: "Disable offer notifications",
  notificationBusy: "Checking notification permission…",
  notificationHelp:
    "Checks every five minutes while this account’s dashboard stays open, including in a background tab. Existing offers are not announced when enabled or reopened. Notices stop when the dashboard closes.",
  notificationsPaused:
    "Offer notices are paused until this account’s library is imported.",
  dashboardEnabled:
    "Dashboard offer notices are enabled on this browser for this account.",
  browserEnabled: "Browser notification permission is allowed.",
  unsupported:
    "Browser notifications are unavailable here. Dashboard notices still work while this account’s dashboard is open.",
  denied:
    "Browser notifications are blocked. Dashboard notices still work; change your browser settings to allow system notifications.",
  dismissed:
    "Browser permission was not granted. Dashboard notices still work.",
  allowBrowser: "Allow browser notifications",
  newOffers: "New free game offers",
  notificationBody: "New offers on Steam: ",
};

const de: typeof en = {
  title: "Gratis zum Behalten",
  description:
    "Steam verschenkt ab und zu Spiele für kurze Zeit. Wer sie rechtzeitig holt, behält sie für immer.",
  howTitle: "So funktioniert das",
  howCheck: "SteamBee prüft den Steam-Store regelmäßig auf Spiele mit −100 %.",
  howOwned: "Spiele, die dieses Konto schon hat, werden ausgeblendet.",
  howClaim: "Du holst sie selbst im Store ab. SteamBee kauft nichts.",
  refresh: "Aktualisieren",
  refreshing: "Angebote werden aktualisiert…",
  loading: "Steam-Angebote werden geprüft…",
  emptyTitle: "Gerade keine Gratisangebote",
  empty:
    "In den geprüften Ergebnissen wurden keine zeitlich begrenzten Gratisangebote gefunden.",
  staleEmpty:
    "Bei der letzten erfolgreichen Prüfung gab es keine Angebote. Die aktuelle Verfügbarkeit konnte nicht geprüft werden.",
  openStore: "Im Store holen",
  offerLabel: "−100 % · gratis",
  regionLabel: "Angebote aus dem US-Store",
  region: "Verfügbarkeit und Bedingungen können in deiner Region abweichen.",
  offerDetails: "Details zu Region & Besitzstand",
  checked: "Store zuletzt geprüft",
  ownership: "Eigene Spiele ausgeblendet nach dem Bibliotheksimport vom",
  ownershipHelp:
    "Später erworbene Spiele können noch erscheinen. Importiere die Bibliothek erneut, um den Besitzstand zu aktualisieren.",
  excluded: "Ausgeblendete eigene Angebote",
  checkAgain: "Erneut prüfen",
  notificationSetup: "Angebotshinweise einrichten",
  noLibrary:
    "Importiere die Bibliothek dieses Kontos, um eigene Spiele auszublenden und Angebotshinweise zu aktivieren. Bis dahin können die Ergebnisse bereits vorhandene Spiele enthalten.",
  stale:
    "Steam ist nicht erreichbar. Diese zwischengespeicherten Angebote können abgelaufen sein; prüfe den aktuellen Preis auf Steam.",
  refreshFailed:
    "Die zuletzt geladenen Ergebnisse werden weiter angezeigt. Ihre aktuelle Verfügbarkeit konnte bei dieser Aktualisierung nicht geprüft werden.",
  truncated:
    "Es wurden nur die ersten 300 Suchergebnisse geprüft. Auf Steam kann es weitere Angebote geben.",
  notifications: "Neue Angebote melden",
  notificationTitle: "Das nächste Angebot mitbekommen",
  notificationSummary:
    "Erhalte einen Hinweis, wenn für dieses Konto ein neues Angebot erscheint.",
  notificationDetails: "So funktionieren Angebotshinweise",
  stopNotifications: "Angebotshinweise deaktivieren",
  notificationBusy: "Benachrichtigungsberechtigung wird geprüft…",
  notificationHelp:
    "Prüft alle fünf Minuten, solange das Dashboard dieses Kontos geöffnet bleibt, auch in einem Hintergrundtab. Beim Aktivieren oder erneuten Öffnen werden bestehende Angebote nicht gemeldet. Hinweise enden beim Schließen des Dashboards.",
  notificationsPaused:
    "Angebotshinweise sind pausiert, bis die Bibliothek dieses Kontos importiert wurde.",
  dashboardEnabled:
    "Dashboardhinweise für neue Angebote sind in diesem Browser für dieses Konto aktiviert.",
  browserEnabled: "Die Browserberechtigung für Benachrichtigungen ist erteilt.",
  unsupported:
    "Browserbenachrichtigungen sind hier nicht verfügbar. Dashboardhinweise funktionieren weiterhin, solange das Dashboard dieses Kontos geöffnet ist.",
  denied:
    "Browserbenachrichtigungen sind blockiert. Dashboardhinweise funktionieren weiterhin; erlaube Systembenachrichtigungen in den Browsereinstellungen.",
  dismissed:
    "Die Browserberechtigung wurde nicht erteilt. Dashboardhinweise funktionieren weiterhin.",
  allowBrowser: "Browserbenachrichtigungen erlauben",
  newOffers: "Neue Gratisangebote",
  notificationBody: "Neue Angebote auf Steam: ",
};

export function discoveryCopy(locale: string) {
  return locale === "de" ? de : en;
}
