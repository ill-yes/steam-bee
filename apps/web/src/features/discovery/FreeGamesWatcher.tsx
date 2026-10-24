import type { FreeGamesResponse } from "@steam-bee/contracts";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { discoveryCopy } from "./copy";
import {
  commitOfferSnapshot,
  observeOfferPreference,
  readOfferNotificationState,
} from "./notification-state";

/** Mount once per visible account, outside the selected tools panel. No requests before opt-in. */
export function FreeGamesWatcher({ accountId }: { accountId: string }) {
  return <AccountFreeGamesWatcher key={accountId} accountId={accountId} />;
}

function AccountFreeGamesWatcher({ accountId }: { accountId: string }) {
  const { locale } = useI18n();
  const copy = useRef(discoveryCopy(locale));
  copy.current = discoveryCopy(locale);
  const preference = useRef(readOfferNotificationState(accountId));
  const [enabled, setEnabled] = useState(preference.current.enabled);

  useEffect(
    () =>
      observeOfferPreference(accountId, (state) => {
        preference.current = state;
        // Seen updates from another tab must not restart this session's quiet baseline.
        setEnabled(state.enabled);
      }),
    [accountId],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pending = false;
    let baseline = true;
    let request: AbortController | null = null;
    const isCurrent = () => !cancelled && preference.current.enabled;

    async function poll() {
      if (pending || !isCurrent()) return;
      pending = true;
      request = new AbortController();
      try {
        const data = await api<FreeGamesResponse>(
          `/api/accounts/${encodeURIComponent(accountId)}/free-games`,
          { signal: request.signal },
        );
        if (!isCurrent() || data.stale || data.libraryImportedAt === null)
          return;
        // Claim offers against the latest shared state, under a Web Lock where supported.
        const snapshot = await commitOfferSnapshot(
          accountId,
          preference.current,
          data.offers,
          { baseline, isCurrent },
        );
        if (!isCurrent()) return;
        baseline = false;
        preference.current = snapshot.state;
        if (!snapshot.newOffers.length) return;
        const names = snapshot.newOffers
          .slice(0, 3)
          .map((offer) => offer.name)
          .join(", ");
        const t = copy.current;
        toast.info(t.newOffers, { description: names });
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification(t.newOffers, {
              body: `${t.notificationBody}${names}`,
              tag: `steam-bee-free-offers:${accountId}`,
            });
          } catch {
            /* Dashboard notices remain available on browsers requiring a service worker. */
          }
        }
      } catch {
        /* The next poll retries transient failures; stale/error results never notify. */
      } finally {
        pending = false;
      }
    }
    void poll();
    const interval = window.setInterval(() => void poll(), 5 * 60_000);
    return () => {
      cancelled = true;
      request?.abort();
      window.clearInterval(interval);
    };
  }, [accountId, enabled]);

  return null;
}
