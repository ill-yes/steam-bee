import type { FreeGameOffer } from "@steam-bee/contracts";

export type OfferNotificationState = {
  enabled: boolean;
  baselined: boolean;
  seen: number[];
};
export const emptyNotificationState = (): OfferNotificationState => ({
  enabled: false,
  baselined: false,
  seen: [],
});
export const offerNotificationStorageKey = (accountId: string) =>
  `steam-bee-free-offers:${accountId}`;
export const offerPreferenceEvent = "steam-bee:free-offer-preference";
const seenLimit = 500;

function normalizeSeen(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const id of value) {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
      continue;
    // The last occurrence is the most recent observation of this offer.
    seen.delete(id);
    seen.add(id);
  }
  return [...seen].slice(-seenLimit);
}

function normalizeState(value: unknown): OfferNotificationState {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return emptyNotificationState();
  const state = value as Partial<OfferNotificationState>;
  return {
    enabled: state.enabled === true,
    baselined: state.baselined === true,
    seen: normalizeSeen(state.seen),
  };
}

function readStoredState(accountId: string): OfferNotificationState | null {
  try {
    const raw = window.localStorage.getItem(
      offerNotificationStorageKey(accountId),
    );
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? normalizeState(value)
      : null;
  } catch {
    return null;
  }
}

/** Returns true only when a changed value was successfully persisted. */
function persistState(accountId: string, state: OfferNotificationState) {
  try {
    const key = offerNotificationStorageKey(accountId);
    const serialized = JSON.stringify(normalizeState(state));
    if (window.localStorage.getItem(key) === serialized) return false;
    window.localStorage.setItem(key, serialized);
    return true;
  } catch {
    // The caller retains its in-memory preference when storage is blocked.
    return false;
  }
}

export function announceOfferPreferenceChange(
  accountId: string,
  state: OfferNotificationState,
) {
  window.dispatchEvent(
    new CustomEvent(offerPreferenceEvent, { detail: { accountId, state } }),
  );
}

export function observeOfferPreference(
  accountId: string,
  listener: (state: OfferNotificationState) => void,
) {
  const onPreference = (event: Event) => {
    const change = (
      event as CustomEvent<{ accountId: string; state: OfferNotificationState }>
    ).detail;
    if (change?.accountId === accountId) listener(normalizeState(change.state));
  };
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === offerNotificationStorageKey(accountId)
    )
      listener(readOfferNotificationState(accountId));
  };
  window.addEventListener(offerPreferenceEvent, onPreference);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(offerPreferenceEvent, onPreference);
    window.removeEventListener("storage", onStorage);
  };
}

export function readOfferNotificationState(
  accountId: string,
): OfferNotificationState {
  return readStoredState(accountId) ?? emptyNotificationState();
}

export function saveOfferNotificationState(
  accountId: string,
  state: OfferNotificationState,
) {
  persistState(accountId, state);
}

export function acceptOfferSnapshot(
  state: OfferNotificationState,
  offers: FreeGameOffer[],
) {
  const normalized = normalizeState(state);
  if (!normalized.enabled)
    return { state: normalized, newOffers: [] as FreeGameOffer[] };
  const seen = new Set(normalized.seen);
  const newOffers: FreeGameOffer[] = [];
  for (const offer of offers) {
    if (!Number.isSafeInteger(offer.appId) || offer.appId <= 0) continue;
    if (normalized.baselined && !seen.has(offer.appId)) newOffers.push(offer);
    seen.delete(offer.appId);
    seen.add(offer.appId);
  }
  return {
    state: {
      ...normalized,
      baselined: true,
      seen: [...seen].slice(-seenLimit),
    },
    newOffers,
  };
}

/** Claim newly observed offers across dashboard tabs before displaying any notification. */
export async function commitOfferSnapshot(
  accountId: string,
  fallbackState: OfferNotificationState,
  offers: FreeGameOffer[],
  options: { baseline: boolean; isCurrent: () => boolean },
): Promise<{ state: OfferNotificationState; newOffers: FreeGameOffer[] }> {
  const fallback = normalizeState(fallbackState);
  function commit() {
    if (!options.isCurrent()) return { state: fallback, newOffers: [] };
    // Read after acquiring the lock: a waiting watcher must respect a newer opt-out.
    const stored = readStoredState(accountId);
    const current = stored
      ? { ...stored, seen: normalizeSeen([...fallback.seen, ...stored.seen]) }
      : fallback;
    if (!current.enabled) return { state: current, newOffers: [] };
    const snapshot = acceptOfferSnapshot(
      options.baseline ? { ...current, baselined: false } : current,
      offers,
    );
    if (!options.isCurrent()) return { state: current, newOffers: [] };
    if (persistState(accountId, snapshot.state)) {
      announceOfferPreferenceChange(accountId, snapshot.state);
    }
    return snapshot;
  }

  let locks: LockManager | undefined;
  try {
    locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  } catch {
    // A restricted browser context may expose no usable Web Locks API.
  }
  if (!locks?.request) return commit();
  let acquired = false;
  try {
    return await locks.request(offerNotificationStorageKey(accountId), () => {
      acquired = true;
      return commit();
    });
  } catch (error) {
    if (acquired) throw error;
    // Some embedded browser contexts expose Web Locks but deny access to them.
    return commit();
  }
}
