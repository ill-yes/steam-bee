import { MAX_STEAM_APP_ID, type FarmingConfig } from "@steam-bee/contracts";

export type FarmingDraft = {
  maxConcurrentGames: string;
  skipRefundable: boolean;
  autoResume: boolean;
  whitelist: string;
  blacklist: string;
};

const drafts = new Map<string, FarmingDraft>();
const storageKey = (accountId: string) =>
  `steam-bee-farming-draft:${accountId}`;

export function configDraft(config: FarmingConfig): FarmingDraft {
  return {
    maxConcurrentGames: String(config.maxConcurrentGames),
    skipRefundable: config.skipRefundable,
    autoResume: config.autoResume,
    whitelist: config.whitelist.join(", "),
    blacklist: config.blacklist.join(", "),
  };
}

export function readFarmingDraft(accountId: string): FarmingDraft | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey(accountId));
    if (stored) {
      const value: unknown = JSON.parse(stored);
      if (
        value &&
        typeof value === "object" &&
        "maxConcurrentGames" in value &&
        typeof value.maxConcurrentGames === "string" &&
        "skipRefundable" in value &&
        typeof value.skipRefundable === "boolean" &&
        (!("autoResume" in value) || typeof value.autoResume === "boolean") &&
        "whitelist" in value &&
        typeof value.whitelist === "string" &&
        "blacklist" in value &&
        typeof value.blacklist === "string"
      )
        // Drafts saved before auto-resume existed keep its default.
        return { autoResume: true, ...value } as FarmingDraft;
    }
  } catch {
    // The in-memory draft also survives navigation when storage is blocked.
  }
  return drafts.get(accountId) ?? null;
}

export function writeFarmingDraft(accountId: string, draft: FarmingDraft) {
  drafts.set(accountId, draft);
  try {
    window.sessionStorage.setItem(storageKey(accountId), JSON.stringify(draft));
  } catch {
    // AppIDs and preferences can still be edited without browser storage.
  }
}

export function clearFarmingDraft(accountId: string) {
  drafts.delete(accountId);
  try {
    window.sessionStorage.removeItem(storageKey(accountId));
  } catch {
    // The in-memory draft has already been discarded.
  }
}

export function parseDraftIds(value: string): number[] | null {
  if (!value.trim()) return [];
  const values = value.split(/[\s,]+/).filter(Boolean);
  if (
    values.length > 500 ||
    values.some(
      (id) =>
        !/^\d+$/.test(id) || Number(id) <= 0 || Number(id) > MAX_STEAM_APP_ID,
    )
  )
    return null;
  return [...new Set(values.map(Number))];
}
