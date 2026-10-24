import { useCallback, useEffect, useRef, useState } from "react";
import type { CardSet } from "@steam-bee/contracts";
import { api, apiErrorMessage, isAbortError } from "../../api";
import { useI18n } from "../../i18n";

export type CardSetState =
  | { status: "loading"; set: null; error: null }
  | { status: "ready"; set: CardSet; error: null }
  | { status: "error"; set: null; error: string };

const CONCURRENCY = 2;

/** Loads badge sets for the games on screen, two at a time, once per game. */
export function useCardSets(accountId: string, appIds: readonly number[]) {
  const { messages } = useI18n();
  const [sets, setSets] = useState<Record<number, CardSetState>>({});
  const requested = useRef(new Set<number>());
  const queue = useRef<number[]>([]);
  const running = useRef(0);
  const controller = useRef(new AbortController());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const appId = queue.current.shift()!;
      running.current += 1;
      const signal = controller.current.signal;
      void api<CardSet>(
        `/api/accounts/${encodeURIComponent(accountId)}/inventory/card-sets/${appId}`,
        { signal },
      )
        .then((set) => {
          if (!signal.aborted)
            setSets((current) => ({
              ...current,
              [appId]: { status: "ready", set, error: null },
            }));
        })
        .catch((error: unknown) => {
          if (signal.aborted || isAbortError(error)) return;
          requested.current.delete(appId);
          setSets((current) => ({
            ...current,
            [appId]: {
              status: "error",
              set: null,
              error: apiErrorMessage(error, messagesRef.current),
            },
          }));
        })
        .finally(() => {
          running.current -= 1;
          if (!signal.aborted) pump();
        });
    }
  }, [accountId]);

  const request = useCallback(
    (ids: readonly number[]) => {
      const fresh = ids.filter((id) => !requested.current.has(id));
      if (!fresh.length) return;
      for (const id of fresh) requested.current.add(id);
      queue.current.push(...fresh);
      setSets((current) => {
        const next = { ...current };
        for (const id of fresh)
          next[id] = { status: "loading", set: null, error: null };
        return next;
      });
      pump();
    },
    [pump],
  );

  const key = appIds.join(",");
  useEffect(() => {
    request(key ? key.split(",").map(Number) : []);
  }, [key, request]);

  useEffect(() => {
    const abort = controller.current;
    return () => abort.abort();
  }, []);

  const retry = useCallback((appId: number) => request([appId]), [request]);
  return { sets, retry };
}
