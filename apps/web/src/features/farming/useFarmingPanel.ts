import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_FARMING_CONFIG,
  type AccountStatus,
  type FarmingSnapshot,
} from "@steam-bee/contracts";
import { api, apiErrorMessage, isAbortError } from "../../api";
import { useI18n } from "../../i18n";
import { farmingCopy } from "./copy";
import {
  clearFarmingDraft,
  configDraft,
  parseDraftIds,
  readFarmingDraft,
  writeFarmingDraft,
  type FarmingDraft,
} from "./drafts";

type Action = "scan" | "start" | "refresh" | "config";
type FieldErrors = Partial<
  Record<"maxConcurrentGames" | "whitelist" | "blacklist", string>
>;

export function useFarmingPanel(
  accountId: string,
  accountStatus?: AccountStatus,
  activityMode?: "idle" | "manual" | "farming",
) {
  const { locale, localeInfo, messages } = useI18n();
  const t = farmingCopy(locale);
  const [snapshot, setSnapshot] = useState<FarmingSnapshot | null>(null);
  const [draft, setDraft] = useState<FarmingDraft>(() =>
    configDraft(DEFAULT_FARMING_CONFIG),
  );
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [loading, setLoading] = useState(true);
  const epoch = useRef(0);
  const busyRef = useRef<Action | null>(null);
  const dirtyRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const availabilityKey = JSON.stringify([accountStatus, activityMode]);
  const observedAvailability = useRef({ accountId, key: availabilityKey });
  const currentSnapshot = snapshot?.accountId === accountId ? snapshot : null;
  const active =
    currentSnapshot !== null &&
    ["scanning", "warming", "farming"].includes(currentSnapshot.phase);

  function accept(result: FarmingSnapshot) {
    if (result.accountId !== accountId) return;
    setSnapshot(result);
    if (!dirtyRef.current) setDraft(configDraft(result.config));
  }

  useEffect(() => {
    const requestEpoch = ++epoch.current;
    const controller = new AbortController();
    const stored = readFarmingDraft(accountId);
    dirtyRef.current = Boolean(stored);
    busyRef.current = null;
    setLoading(true);
    setSnapshot(null);
    setError(null);
    setRefreshError(null);
    setNotice(null);
    setErrors({});
    setBusy(null);
    setDirty(Boolean(stored));
    setDraft(stored ?? configDraft(DEFAULT_FARMING_CONFIG));
    void api<FarmingSnapshot>(`/api/accounts/${accountId}/farming`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (requestEpoch === epoch.current && !controller.signal.aborted)
          accept(result);
      })
      .catch((failure) => {
        if (requestEpoch === epoch.current && !isAbortError(failure))
          setError(apiErrorMessage(failure, messagesRef.current));
      })
      .finally(() => {
        if (requestEpoch === epoch.current) setLoading(false);
      });
    return () => {
      controller.abort();
      epoch.current += 1;
    };
  }, [accountId]);

  useEffect(() => {
    if (observedAvailability.current.accountId !== accountId) {
      observedAvailability.current = { accountId, key: availabilityKey };
      return;
    }
    if (observedAvailability.current.key === availabilityKey || loading || busy)
      return;
    observedAvailability.current = { accountId, key: availabilityKey };
    // Global start/resume/pause controls change availability while this panel
    // stays open. Refresh it without resetting a user's unsaved settings.
    void action("refresh");
  }, [accountId, availabilityKey, loading, busy]);

  useEffect(() => {
    if (!active || busy) return;
    const controller = new AbortController();
    const requestEpoch = epoch.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<FarmingSnapshot>(
          `/api/accounts/${accountId}/farming`,
          { signal: controller.signal },
        );
        if (!disposed && requestEpoch === epoch.current) {
          accept(result);
          setRefreshError(null);
        }
      } catch (failure) {
        if (
          !disposed &&
          requestEpoch === epoch.current &&
          !isAbortError(failure)
        )
          setRefreshError(apiErrorMessage(failure, messagesRef.current));
      } finally {
        // Schedule the next read only after this one settles; slow requests cannot overlap.
        if (!disposed && requestEpoch === epoch.current)
          timer = setTimeout(() => void poll(), 5_000);
      }
    };
    timer = setTimeout(() => void poll(), 5_000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountId, active, busy]);

  function edit(change: Partial<FarmingDraft>) {
    if (busyRef.current || active) return;
    const next = { ...draft, ...change };
    setDraft(next);
    dirtyRef.current = true;
    setDirty(true);
    setNotice(null);
    setErrors({});
    writeFarmingDraft(accountId, next);
  }

  function discard() {
    if (!currentSnapshot || busyRef.current || active) return;
    clearFarmingDraft(accountId);
    dirtyRef.current = false;
    setDirty(false);
    setErrors({});
    setDraft(configDraft(currentSnapshot.config));
    setNotice(t.discarded);
  }

  async function action(name: Action) {
    if (busyRef.current) return;
    if ((name === "scan" || name === "start") && dirtyRef.current) return;
    if (name === "config" && !dirtyRef.current) return;
    const max = Number(draft.maxConcurrentGames);
    const whitelist = parseDraftIds(draft.whitelist);
    const blacklist = parseDraftIds(draft.blacklist);
    if (name === "config") {
      const validation: FieldErrors = {};
      if (!Number.isInteger(max) || max < 1 || max > 32)
        validation.maxConcurrentGames = t.invalidLimit;
      if (whitelist === null) validation.whitelist = t.invalidIds;
      if (blacklist === null) validation.blacklist = t.invalidIds;
      setErrors(validation);
      if (Object.keys(validation).length > 0) return;
    }
    const requestEpoch = ++epoch.current;
    busyRef.current = name;
    setBusy(name);
    setError(null);
    setRefreshError(null);
    setNotice(null);
    try {
      if (name === "refresh") {
        const result = await api<FarmingSnapshot>(
          `/api/accounts/${accountId}/farming`,
        );
        if (requestEpoch !== epoch.current) return;
        accept(result);
        setNotice(t.updated);
      } else {
        const result = await api<FarmingSnapshot>(
          `/api/accounts/${accountId}/farming/${name}`,
          name === "config"
            ? {
                method: "PUT",
                body: JSON.stringify({
                  maxConcurrentGames: max,
                  skipRefundable: draft.skipRefundable,
                  whitelist: whitelist!,
                  blacklist: blacklist!,
                  autoResume: draft.autoResume,
                }),
              }
            : { method: "POST" },
        );
        if (requestEpoch !== epoch.current) return;
        if (name === "config") {
          clearFarmingDraft(accountId);
          dirtyRef.current = false;
          setDirty(false);
          setErrors({});
        }
        // The command response is authoritative even when the following status read fails.
        accept(
          name === "config" || name === "scan"
            ? {
                ...result,
                // These endpoints report badge/config state. Keep the last
                // observed account availability until the GET confirms it.
                canStart: currentSnapshot?.canStart ?? result.canStart,
                gameLimit: currentSnapshot?.gameLimit ?? result.gameLimit,
              }
            : result,
        );
        if (result.phase !== "error") setNotice(t.success[name]);
        try {
          const latest = await api<FarmingSnapshot>(
            `/api/accounts/${accountId}/farming`,
          );
          if (requestEpoch === epoch.current) accept(latest);
        } catch (failure) {
          if (requestEpoch === epoch.current && !isAbortError(failure))
            setRefreshError(apiErrorMessage(failure, messagesRef.current));
        }
      }
    } catch (failure) {
      if (requestEpoch === epoch.current && !isAbortError(failure))
        setError(apiErrorMessage(failure, messagesRef.current));
    } finally {
      if (requestEpoch === epoch.current) {
        busyRef.current = null;
        setBusy(null);
      }
    }
  }

  return {
    t,
    localeInfo,
    snapshot: currentSnapshot,
    active,
    draft,
    dirty,
    errors,
    error,
    refreshError,
    notice,
    busy,
    loading,
    edit,
    discard,
    action,
  };
}
