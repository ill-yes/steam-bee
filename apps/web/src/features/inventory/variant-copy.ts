const en = {
  variants: "Variants: {count}",
  copies: "Copies in inventory: {count}",
  additional: "Additional copies: {count}",
  inInventory: "In inventory",
  extraCopies: "Additional copies",
  market: "Steam Market",
  trade: "Steam trading",
  available: "Available",
  partlyAvailable: "Partly available",
  unavailable: "Unavailable",
  choose: "Select for batch sale",
  keepOne: "At least one copy of each variant stays in your inventory.",
  unique: "Only copy — stays in your inventory.",
  protected:
    "One copy stays in your inventory; only additional copies can be sold.",
  notMarketable:
    "Steam does not allow these copies to be sold on the Community Market.",
  noEligible:
    "No additional copies of this variant are currently available for sale.",
  partialSale:
    "{count} of {total} additional copies can be sold on the Steam Market.",
  quantity: "Sale quantity",
  maximum: "up to {count} per batch",
  remains: "Copies remaining after the sale: {count}",
  remainsOne: "After the sale: 1 copy remains.",
  invalidQuantity: "Enter a whole number from 1 to {max}.",
  actionLimit:
    "This selection needs {count} market actions. A batch supports up to 50. Reduce the quantity or selection; nothing was added.",
  actionQuantityLimit:
    "This quantity would exceed 50 market actions. Reduce the quantity before reviewing the sale.",
  referenceSell: "Lowest market offer / copy",
  referenceBuy: "Highest buy order / copy",
  referenceUnknown: "Market reference / copy",
  ownPrice: "Your listing price / copy",
  proceeds: "Expected proceeds ({count} copies)",
  proceedsOne: "Expected proceeds (1 copy)",
  proceedsPerCopy: "Expected proceeds / copy",
  afterFees: "After Steam and publisher fees",
  invalidPriceQuantity: "Enter a valid sale quantity to calculate proceeds.",
  priceLoading: "Loading market prices…",
  priceWaiting: "Market prices have not loaded yet.",
  priceError: "Market prices could not be loaded.",
  priceNoOrders: "There are no matching market orders for this price source.",
  priceCurrencyMismatch:
    "The pricing rules use another wallet currency. Review and save the rules for the current wallet.",
  priceOutsideLimits:
    "The estimated price is outside your saved price limits. Review your pricing rules.",
  priceBelowFees:
    "This price is too low to cover the required Steam and publisher fees.",
  priceUnsupported:
    "This market price cannot be represented safely. Request a new sale preview before selling.",
  priceSteamUnavailable:
    "Steam market prices are temporarily unavailable. Try again later.",
  priceRateLimited:
    "Steam has limited market requests. Wait until the retry time before refreshing.",
  priceUnknownVariant:
    "This variant is no longer in the inventory snapshot. Refresh the inventory.",
  priceContextExpired:
    "The inventory has changed. Prices will be reloaded after the inventory refresh.",
  priceContextTooLarge:
    "This inventory exceeds the size supported by the price overview. Final sale previews remain available.",
  priceUnavailable: "No market price is currently available.",
  estimateUnavailable:
    "A sale estimate is not available for the saved pricing rules.",
  stalePrice: "Previous estimate — refresh before relying on this price.",
  priceRefreshing: "Refreshing prices…",
  priceAt: "Price checked {time}",
  priceAge: "{count} min ago",
  priceNow: "just now",
  retryPrice: "Refresh price",
  retryAt: "Try again {time}",
  estimateHelp:
    "Prices are estimates. The sale preview shows the current fees and proceeds before you confirm.",
  selectionVariants: "Selected variants: {count}",
  selectionCopies: "Selected copies: {count}",
  selectionActions: "{count} of 50 market actions",
  hiddenSelection:
    "{count} selected variants are hidden by the current filters. They remain in the sale preview.",
  page: "Variants {from}–{to} of {total}",
  group: "Variants: {variants} · Copies: {copies} · Additional: {extra}",
  groupMatches: "{matching} of {total} variants match the filters.",
  previewSelected: "Review selected sales",
  selectGame: "Select duplicates for this game",
  clearGame: "Deselect duplicates for this game",
  selectFiltered: "Select filtered duplicates",
  clearFiltered: "Deselect filtered duplicates",
  filterRemove: "Remove filter: {name}",
  searchFilter: "Search: {query}",
  sortFilter: "Sort: {name}",
  stockLoading: "Inventory is refreshing. Sales will be available afterwards.",
  stockStale: "Refresh the inventory before reviewing a sale.",
  actionBusy:
    "Another market action is running. Please wait or stop the batch.",
  rulesBlocked:
    "Save or discard your pricing rule changes before reviewing a sale.",
};
const de: typeof en = {
  variants: "Varianten: {count}",
  copies: "Exemplare im Inventar: {count}",
  additional: "Zusätzliche Exemplare: {count}",
  inInventory: "Im Inventar",
  extraCopies: "Zusätzliche Exemplare",
  market: "Steam-Markt",
  trade: "Steam-Tausch",
  available: "Möglich",
  partlyAvailable: "Teilweise möglich",
  unavailable: "Nicht möglich",
  choose: "Für Sammelverkauf auswählen",
  keepOne: "Mindestens ein Exemplar jeder Variante bleibt im Inventar.",
  unique: "Einziges Exemplar – bleibt im Inventar.",
  protected:
    "Ein Exemplar bleibt im Inventar; nur zusätzliche Exemplare sind verkaufbar.",
  notMarketable:
    "Steam erlaubt für diese Exemplare keinen Verkauf auf dem Community-Markt.",
  noEligible:
    "Für diese Variante sind derzeit keine zusätzlichen Exemplare verkaufbar.",
  partialSale:
    "{count} von {total} zusätzlichen Exemplaren sind auf dem Steam-Markt verkaufbar.",
  quantity: "Verkaufsmenge",
  maximum: "höchstens {count} je Stapel",
  remains: "Nach Verkauf im Inventar: {count} Exemplare",
  remainsOne: "Nach Verkauf im Inventar: 1 Exemplar",
  invalidQuantity: "Gib eine ganze Zahl zwischen 1 und {max} ein.",
  actionLimit:
    "Diese Auswahl benötigt {count} Marktaktionen. Ein Stapel unterstützt höchstens 50. Verringere die Menge oder Auswahl; es wurde nichts hinzugefügt.",
  actionQuantityLimit:
    "Diese Menge überschreitet 50 Marktaktionen. Verringere sie, bevor du den Verkauf prüfst.",
  referenceSell: "Niedrigstes Marktangebot / Stück",
  referenceBuy: "Höchster Kaufauftrag / Stück",
  referenceUnknown: "Marktreferenz / Stück",
  ownPrice: "Dein Angebotspreis je Exemplar",
  proceeds: "Voraussichtlicher Erlös ({count} Stück)",
  proceedsOne: "Voraussichtlicher Erlös (1 Stück)",
  proceedsPerCopy: "Voraussichtlicher Erlös / Stück",
  afterFees: "Nach Steam- und Publisher-Gebühren",
  invalidPriceQuantity:
    "Gib eine gültige Verkaufsmenge ein, um den Erlös zu berechnen.",
  priceLoading: "Marktpreise werden geladen…",
  priceWaiting: "Marktpreise sind noch nicht geladen.",
  priceError: "Marktpreise konnten nicht geladen werden.",
  priceNoOrders:
    "Für diese Preisquelle sind keine passenden Marktaufträge vorhanden.",
  priceCurrencyMismatch:
    "Die Preisregeln verwenden eine andere Wallet-Währung. Prüfe und speichere die Regeln für die aktuelle Wallet.",
  priceOutsideLimits:
    "Der geschätzte Preis liegt außerhalb deiner gespeicherten Preisgrenzen. Prüfe deine Preisregeln.",
  priceBelowFees:
    "Dieser Preis reicht nicht für die erforderlichen Steam- und Publisher-Gebühren aus.",
  priceUnsupported:
    "Dieser Marktpreis lässt sich nicht sicher darstellen. Fordere vor dem Verkauf eine neue Verkaufsvorschau an.",
  priceSteamUnavailable:
    "Steam-Marktpreise sind vorübergehend nicht verfügbar. Versuche es später erneut.",
  priceRateLimited:
    "Steam begrenzt gerade Marktanfragen. Warte bis zum angegebenen Zeitpunkt, bevor du aktualisierst.",
  priceUnknownVariant:
    "Diese Variante ist nicht mehr im Inventarstand enthalten. Aktualisiere das Inventar.",
  priceContextExpired:
    "Das Inventar hat sich geändert. Nach der Inventaraktualisierung werden die Preise neu geladen.",
  priceContextTooLarge:
    "Dieses Inventar überschreitet die unterstützte Größe der Preisübersicht. Verbindliche Verkaufsvorschauen bleiben verfügbar.",
  priceUnavailable: "Derzeit ist kein Marktpreis verfügbar.",
  estimateUnavailable:
    "Für die gespeicherten Preisregeln ist keine Verkaufsschätzung verfügbar.",
  stalePrice:
    "Vorherige Schätzung – aktualisiere sie, bevor du dich darauf verlässt.",
  priceRefreshing: "Preise werden aktualisiert…",
  priceAt: "Preisstand: {time}",
  priceAge: "vor {count} Min.",
  priceNow: "gerade eben",
  retryPrice: "Preis aktualisieren",
  retryAt: "Erneut versuchen: {time}",
  estimateHelp:
    "Preise sind Schätzungen. Die Verkaufsvorschau zeigt aktuelle Gebühren und Erlöse vor deiner Bestätigung.",
  selectionVariants: "Ausgewählte Varianten: {count}",
  selectionCopies: "Ausgewählte Exemplare: {count}",
  selectionActions: "{count} von 50 Marktaktionen",
  hiddenSelection:
    "{count} ausgewählte Varianten sind durch die aktuellen Filter ausgeblendet. Sie bleiben in der Verkaufsvorschau enthalten.",
  page: "Varianten {from}–{to} von {total}",
  group: "Varianten: {variants} · Exemplare: {copies} · Zusätzlich: {extra}",
  groupMatches: "{matching} von {total} Varianten passen zum Filter.",
  previewSelected: "Verkäufe prüfen",
  selectGame: "Duplikate dieses Spiels auswählen",
  clearGame: "Duplikate dieses Spiels abwählen",
  selectFiltered: "Gefilterte Duplikate auswählen",
  clearFiltered: "Gefilterte Duplikate abwählen",
  filterRemove: "Filter entfernen: {name}",
  searchFilter: "Suche: {query}",
  sortFilter: "Sortierung: {name}",
  stockLoading:
    "Das Inventar wird aktualisiert. Danach sind Verkäufe wieder möglich.",
  stockStale: "Aktualisiere das Inventar, bevor du einen Verkauf prüfst.",
  actionBusy:
    "Eine andere Marktaktion läuft. Warte bitte oder stoppe den Stapel.",
  rulesBlocked:
    "Speichere oder verwirf deine Preisregeländerungen, bevor du einen Verkauf prüfst.",
};
export function variantInventoryCopy(locale: string) {
  return locale === "de" ? de : en;
}
