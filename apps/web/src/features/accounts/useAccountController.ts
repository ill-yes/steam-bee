import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type BoostAnalytics,
  type BoostPreset,
  type BoostSchedule,
  type AccountSafetyPolicy,
  type PlaytimeGoal,
  type SchedulePreview,
  type SteamApp,
} from "../../api";

export type ResourceLoadState = "loading" | "ready" | "error";

type OptionalResourceStates = {
  safety: ResourceLoadState;
  schedulePreview: ResourceLoadState;
  goals: ResourceLoadState;
};

export function useAccountResources() {
  const [library, setLibrary] = useState<SteamApp[]>([]);
  const [presets, setPresets] = useState<BoostPreset[]>([]);
  const [schedules, setSchedules] = useState<BoostSchedule[]>([]);
  const [analytics, setAnalytics] = useState<BoostAnalytics | null>(null);
  const [safety, setSafety] = useState<AccountSafetyPolicy | null>(null);
  const [schedulePreview, setSchedulePreview] =
    useState<SchedulePreview | null>(null);
  const [goals, setGoals] = useState<PlaytimeGoal[]>([]);
  const [schedulePresetId, setSchedulePresetId] = useState("");
  const [loadState, setLoadState] = useState<ResourceLoadState>("loading");
  const [optionalStates, setOptionalStates] = useState<OptionalResourceStates>({
    safety: "loading",
    schedulePreview: "loading",
    goals: "loading",
  });
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const loadAccountData = useCallback(async (accountId: string) => {
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const request = { signal: nextController.signal } satisfies RequestInit;
    setLoadState("loading");
    setOptionalStates({
      safety: "loading",
      schedulePreview: "loading",
      goals: "loading",
    });
    try {
      const [nextLibrary, nextPresets, nextSchedules, nextAnalytics] =
        await Promise.all([
          api<SteamApp[]>(`/api/accounts/${accountId}/library`, request),
          api<BoostPreset[]>(`/api/accounts/${accountId}/presets`, request),
          api<BoostSchedule[]>(`/api/accounts/${accountId}/schedules`, request),
          api<BoostAnalytics>(`/api/accounts/${accountId}/analytics`, request),
        ]);
      const [nextSafety, nextPreview, nextGoals] = await Promise.allSettled([
        api<AccountSafetyPolicy>(`/api/accounts/${accountId}/safety`, request),
        api<SchedulePreview>(
          `/api/accounts/${accountId}/schedules/preview?days=7`,
          request,
        ),
        api<PlaytimeGoal[]>(`/api/accounts/${accountId}/goals`, request),
      ]);
      if (nextGeneration !== generation.current) return;

      setLibrary(nextLibrary);
      setPresets(nextPresets);
      setSchedules(nextSchedules);
      setAnalytics(nextAnalytics);
      setSafety(nextSafety.status === "fulfilled" ? nextSafety.value : null);
      setSchedulePreview(
        nextPreview.status === "fulfilled" ? nextPreview.value : null,
      );
      setGoals(nextGoals.status === "fulfilled" ? nextGoals.value : []);
      setOptionalStates({
        safety: nextSafety.status === "fulfilled" ? "ready" : "error",
        schedulePreview: nextPreview.status === "fulfilled" ? "ready" : "error",
        goals: nextGoals.status === "fulfilled" ? "ready" : "error",
      });
      setLoadState("ready");
      setSchedulePresetId((current) =>
        current && nextPresets.some((preset) => preset.id === current)
          ? current
          : (nextPresets[0]?.id ?? ""),
      );
      return { presets: nextPresets };
    } catch (error) {
      if (nextGeneration === generation.current) {
        setLibrary([]);
        setPresets([]);
        setSchedules([]);
        setAnalytics(null);
        setSafety(null);
        setSchedulePreview(null);
        setGoals([]);
        setLoadState("error");
        setOptionalStates({
          safety: "error",
          schedulePreview: "error",
          goals: "error",
        });
      }
      throw error;
    }
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
    },
    [],
  );

  return {
    library,
    setLibrary,
    presets,
    setPresets,
    schedules,
    setSchedules,
    analytics,
    setAnalytics,
    safety,
    setSafety,
    schedulePreview,
    setSchedulePreview,
    goals,
    setGoals,
    schedulePresetId,
    setSchedulePresetId,
    loadState,
    optionalStates,
    loadAccountData,
  };
}
