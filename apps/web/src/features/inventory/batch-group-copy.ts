const en = {
  previewSummary:
    "Variants: {variants} · Copies: {quantity} · Inventory entries: {entries} · {delay} seconds between actions",
  progressSummary:
    "Variants: {variants} · Copies: {quantity} · Inventory entries: {entries}",
  groupQuantity: "Copies: {quantity} · Inventory entries: {entries}",
  ready: "Ready offers: {count} · Copies: {quantity}",
  unavailable: "Unavailable entries: {count} · Copies: {quantity}",
  readyStatus: "Ready",
  unavailableStatus: "Unavailable",
  details: "Inventory entries & results ({count})",
  detailsFor: "Inventory entries and results for {name} ({count})",
  assetId: "Inventory ID",
  listingId: "Market offer ID",
  copies: "Copies",
  statusCount: "{status}: {count}",
  listedOffers: "Listed market offers: {count}",
};

const de: typeof en = {
  previewSummary:
    "Varianten: {variants} · Exemplare: {quantity} · Inventarpositionen: {entries} · {delay} Sekunden zwischen Aktionen",
  progressSummary:
    "Varianten: {variants} · Exemplare: {quantity} · Inventarpositionen: {entries}",
  groupQuantity: "Exemplare: {quantity} · Inventarpositionen: {entries}",
  ready: "Bereite Angebote: {count} · Exemplare: {quantity}",
  unavailable: "Nicht verfügbare Positionen: {count} · Exemplare: {quantity}",
  readyStatus: "Bereit",
  unavailableStatus: "Nicht verfügbar",
  details: "Inventarpositionen & Ergebnisse ({count})",
  detailsFor: "Inventarpositionen und Ergebnisse für {name} ({count})",
  assetId: "Inventar-ID",
  listingId: "Marktangebots-ID",
  copies: "Exemplare",
  statusCount: "{status}: {count}",
  listedOffers: "Erstellte Marktangebote: {count}",
};

export function batchGroupCopy(locale: string) {
  return locale === "de" ? de : en;
}
