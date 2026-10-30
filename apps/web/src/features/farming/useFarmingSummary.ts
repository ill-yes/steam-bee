import { useCallback, useEffect, useRef, useState } from "react";
import type { FarmingSnapshot } from "@steam-bee/contracts";
import { api, isAbortError } from "../../api";

export type FarmingSummary = {
  remainingDrops: number;
  games: number;
  scannedAt: number | null;
  canStart: boolean;
  active: boolean;
};

const ACTIVE_PHASES = new Set(["scanning", "warming", "farming"]);

export function summarizeFarming(snapshot: FarmingSnapshot): FarmingSummary {
  return {
    remainingDrops: snapshot.remainingDrops,
    games: snapshot.games.filter((game) => game.remainingDrops > 0).length,
    scannedAt: snapshot.scannedAt,
    canStart: snapshot.canStart,
    active: ACTIVE_PHASES.has(snapshot.phase),
  };
}

/** Lightweight farming status for the account header and navigation. */
export function useFarmingSummary(accountId: string, refreshKey: unknown) {
  const [summary, setSummary] = useState<FarmingSummary | null>(null);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const snapshot = await api<FarmingSnapshot>(
        `/api/accounts/${encodeURIComponent(accountId)}/farming`,
        { signal: abort.signal },
      );
      if (!abort.signal.aborted) setSummary(summarizeFarming(snapshot));
    } catch (error) {
      // The header degrades to "not checked" instead of surfacing an error.
      if (!abort.signal.aborted && !isAbortError(error)) setSummary(null);
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 60_000);
    return () => {
      window.clearInterval(timer);
      controller.current?.abort();
    };
  }, [reload, refreshKey]);

  return { summary, reload };
}
