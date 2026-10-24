import { useEffect, useRef, useState } from "react";
import type { SteamApp } from "@steam-bee/contracts";
import { api, apiErrorMessage, isAbortError } from "../../api";
import { useI18n } from "../../i18n";

export function useFarmingLibrary(accountId: string, provided?: SteamApp[]) {
  const { messages } = useI18n();
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [result, setResult] = useState<{
    accountId: string;
    games: SteamApp[];
  } | null>(null);
  const [loading, setLoading] = useState(provided === undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setResult(null);
    if (provided !== undefined) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void api<SteamApp[]>(`/api/accounts/${accountId}/library`, {
      signal: controller.signal,
    })
      .then((games) => {
        if (!controller.signal.aborted) setResult({ accountId, games });
      })
      .catch((failure) => {
        if (!controller.signal.aborted && !isAbortError(failure))
          setError(apiErrorMessage(failure, messagesRef.current));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountId, provided, attempt]);

  return {
    library: provided ?? (result?.accountId === accountId ? result.games : []),
    loading,
    error,
    retry: () => setAttempt((current) => current + 1),
  };
}
