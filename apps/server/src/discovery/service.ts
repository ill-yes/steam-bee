import { ERROR_CODES } from "@steam-bee/contracts";
import { appError } from "../http/errors.js";
import { fetchFreeGameOffers, type StoreOffers } from "./steam-store.js";

const cacheTtlMs = 10 * 60_000;
const maxStaleMs = 6 * 60 * 60_000;
const retryDelayMs = 60_000;

/** Shared across accounts: importing/filtering ownership never makes additional store requests. */
export function createFreeGamesService(
  load: () => Promise<StoreOffers> = fetchFreeGameOffers,
  now: () => number = Date.now,
) {
  let cache: (StoreOffers & { checkedAt: number }) | null = null;
  let pending: Promise<StoreOffers & { checkedAt: number }> | null = null;
  let retryAt = 0;

  return {
    async getOffers() {
      if (cache && now() - cache.checkedAt < cacheTtlMs)
        return { ...cache, stale: false };
      if (now() >= retryAt) {
        pending ??= load()
          .then((result) => {
            cache = { ...result, checkedAt: now() };
            retryAt = 0;
            return cache;
          })
          .catch((error: unknown) => {
            retryAt = now() + retryDelayMs;
            throw error;
          })
          .finally(() => {
            pending = null;
          });
        try {
          return { ...(await pending), stale: false };
        } catch {
          // A recent successful snapshot is useful, but its age remains explicit to callers.
        }
      }
      if (cache && now() - cache.checkedAt <= maxStaleMs)
        return { ...cache, stale: true };
      throw appError(
        "Steam store offers are temporarily unavailable. Please try again later.",
        502,
        ERROR_CODES.internal,
      );
    },
  };
}

export const freeGamesService = createFreeGamesService();
