import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type BoostAnalytics,
  type BoostPreset,
  type BoostSchedule,
  type SteamApp,
} from "../../api";

export function useAccountResources() {
  const [library, setLibrary] = useState<SteamApp[]>([]);
  const [presets, setPresets] = useState<BoostPreset[]>([]);
  const [schedules, setSchedules] = useState<BoostSchedule[]>([]);
  const [analytics, setAnalytics] = useState<BoostAnalytics | null>(null);
  const [schedulePresetId, setSchedulePresetId] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const loadAccountData = useCallback(async (accountId: string) => {
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const request = { signal: nextController.signal } satisfies RequestInit;
    const [nextLibrary, nextPresets, nextSchedules, nextAnalytics] =
      await Promise.all([
        api<SteamApp[]>(`/api/accounts/${accountId}/library`, request),
        api<BoostPreset[]>(`/api/accounts/${accountId}/presets`, request),
        api<BoostSchedule[]>(`/api/accounts/${accountId}/schedules`, request),
        api<BoostAnalytics>(`/api/accounts/${accountId}/analytics`, request),
      ]);
    if (nextGeneration !== generation.current) return;

    setLibrary(nextLibrary);
    setPresets(nextPresets);
    setSchedules(nextSchedules);
    setAnalytics(nextAnalytics);
    setSchedulePresetId((current) =>
      current && nextPresets.some((preset) => preset.id === current)
        ? current
        : (nextPresets[0]?.id ?? ""),
    );
    return { presets: nextPresets };
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return {
    library,
    setLibrary,
    presets,
    setPresets,
    schedules,
    setSchedules,
    analytics,
    setAnalytics,
    schedulePresetId,
    setSchedulePresetId,
    loadAccountData,
  };
}
