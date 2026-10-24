import type { MarketCurrency, MarketPriceSettings } from "@steam-bee/contracts";
import { parseMajorToMinor } from "./inventory-model";

export type PriceRulesDraft = {
  priceMode: MarketPriceSettings["priceMode"];
  adjustment: string;
  minimum: string;
  maximum: string;
  delay: string;
  currency: MarketCurrency | null;
};
const key = (accountId: string) => `steam-bee-market-rule-draft:${accountId}`;
export function readPriceRulesDraft(accountId: string): PriceRulesDraft | null {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(key(accountId)) ?? "null",
    );
    if (!value || typeof value !== "object") return null;
    const draft = value as Partial<PriceRulesDraft>;
    if (
      draft.priceMode !== "lowestSellOrder" &&
      draft.priceMode !== "highestBuyOrder"
    )
      return null;
    if (
      ![draft.adjustment, draft.minimum, draft.maximum, draft.delay].every(
        (field) => typeof field === "string" && field.length <= 80,
      )
    )
      return null;
    const wallet = draft.currency;
    if (
      wallet !== null &&
      (!wallet ||
        !Number.isSafeInteger(wallet.id) ||
        wallet.id < 1 ||
        !/^[A-Z]{3}$/.test(wallet.code) ||
        !Number.isInteger(wallet.minorUnit) ||
        wallet.minorUnit < 0 ||
        wallet.minorUnit > 3)
    )
      return null;
    return draft as PriceRulesDraft;
  } catch {
    return null;
  }
}
export function storePriceRulesDraft(
  accountId: string,
  draft: PriceRulesDraft | null,
) {
  try {
    if (draft)
      window.localStorage.setItem(key(accountId), JSON.stringify(draft));
    else window.localStorage.removeItem(key(accountId));
  } catch {
    /* Keep the current in-memory draft usable without browser storage. */
  }
}
export function rulesDraftMatchesSettings(
  draft: PriceRulesDraft,
  settings: MarketPriceSettings,
) {
  const digits = draft.currency?.minorUnit ?? 2;
  const adjustment = parseMajorToMinor(draft.adjustment, digits, {
    allowNegative: true,
  });
  const min =
    draft.minimum.trim() === ""
      ? null
      : parseMajorToMinor(draft.minimum, digits);
  const max =
    draft.maximum.trim() === ""
      ? null
      : parseMajorToMinor(draft.maximum, digits);
  if (
    adjustment === null ||
    (draft.minimum.trim() && min === null) ||
    (draft.maximum.trim() && max === null)
  )
    return false;
  const currencyId =
    adjustment !== 0 || min !== null || max !== null
      ? (draft.currency?.id ?? null)
      : null;
  return (
    draft.priceMode === settings.priceMode &&
    adjustment === settings.adjustment &&
    min === settings.minBuyerPrice &&
    max === settings.maxBuyerPrice &&
    Number(draft.delay) === settings.delaySeconds &&
    currencyId === settings.currencyId
  );
}
