import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ACCOUNT_STATUS_CAPABILITIES,
  gameSelectionLimit,
  type AccountCommand,
} from "@steam-bee/contracts";
import type {
  Account,
  BoostPreset,
  BoostSchedule,
  AccountSafetyPolicy,
  Diagnostics,
  SteamApp,
  SteamEvent,
  PlaytimeGoal,
  SchedulePreview,
} from "../../api";
import { api, apiErrorMessage, isAbortError } from "../../api";
import { Alert } from "../../components/ui/alert";
import { ConfirmationDialog } from "../../components/ui/confirmation-dialog";
import { sameAppIdSelection } from "../../lib/format";
import { getPrimaryCommand, selectionApplyCopy } from "../../lib/status";
import { interpolate, useI18n } from "../../i18n";
import { LogDrawer } from "../events/LogDrawer";
import { GameLibraryPanel } from "../library/GameLibraryPanel";
import { AccountControlPanel } from "./detail/AccountControlPanel";
import { AccountHeader } from "./detail/AccountHeader";
import { AccountProfilePanel } from "./detail/AccountProfilePanel";
import { AccountStatusSummary } from "./detail/AccountStatusSummary";
import { AnalyticsPanel } from "./detail/AnalyticsPanel";
import { BoostToolsPanel, type PlanningTab } from "./detail/BoostToolsPanel";
import { PresetPanel } from "./detail/PresetPanel";
import { SchedulePanel } from "./detail/SchedulePanel";
import { SafetyPanel } from "./detail/SafetyPanel";
import { useAccountResources } from "./useAccountController";

type PendingConfirmation = {
  description: string;
  confirmLabel: string;
  destructive: boolean;
  action: () => Promise<boolean>;
};

export function AccountDetail({
  account,
  events,
  diagnostics,
  onReload,
}: {
  account: Account;
  events: SteamEvent[];
  diagnostics: Diagnostics | null;
  onReload: () => Promise<void>;
}) {
  const { messages: t } = useI18n();
  const o = t.operations;
  const {
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
  } = useAccountResources();
  const [personaState, setPersonaState] = useState(account.personaState);
  const [customTitle, setCustomTitle] = useState(account.customTitle ?? "");
  const [presetName, setPresetName] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleStart, setScheduleStart] = useState("09:00");
  const [scheduleEnd, setScheduleEnd] = useState("23:00");
  const [scheduleWeekdays, setScheduleWeekdays] = useState<number[]>([
    1, 2, 3, 4, 5,
  ]);
  const [planningTab, setPlanningTab] = useState<PlanningTab>("presets");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [draftAppIds, setDraftAppIds] = useState<number[]>(
    account.games.map((game) => game.appId),
  );
  const [gamesApplying, setGamesApplying] = useState(false);
  const [gamesAppliedAt, setGamesAppliedAt] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null,
  );
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const manualAppInputRef = useRef<HTMLInputElement>(null);
  const localTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );

  const appliedAppIds = useMemo(
    () => account.games.map((game) => game.appId),
    [account.games],
  );
  const gameLimit = gameSelectionLimit(customTitle);
  const draftOverLimit = draftAppIds.length > gameLimit;
  const selectionDirty = !sameAppIdSelection(appliedAppIds, draftAppIds);
  const statusCapability = ACCOUNT_STATUS_CAPABILITIES[account.runtimeStatus];
  const canImportLibrary = statusCapability.importable;
  const canPause = statusCapability.canPause;
  const canStop = statusCapability.canStop;
  const primaryCommand = getPrimaryCommand(
    account.runtimeStatus,
    appliedAppIds.length,
    t,
  );

  const selectedGames = useMemo(
    () =>
      draftAppIds.map((appId) => {
        const app = library.find((candidate) => candidate.appId === appId);
        return {
          appId,
          name: app?.name ?? `App ${appId}`,
          ...(app?.playtimeForever !== undefined
            ? { playtimeForever: app.playtimeForever }
            : {}),
        };
      }),
    [draftAppIds, library],
  );

  const selectionApplyState = selectionApplyCopy(
    account.runtimeStatus,
    appliedAppIds.length,
    draftAppIds.length,
    selectionDirty,
    gamesApplying,
    t,
  );

  useEffect(() => {
    setDraftAppIds(account.games.map((game) => game.appId));
    setGamesAppliedAt(null);
    setPersonaState(account.personaState);
    setCustomTitle(account.customTitle ?? "");
    setPresetName("");
    setActionError(null);
    setLibraryError(null);
    void loadAccountData(account.id).catch((loadError) => {
      if (isAbortError(loadError)) return;
      setLibrary([]);
      setPresets([]);
      setSchedules([]);
      setAnalytics(null);
      setSafety(null);
      setSchedulePreview(null);
      setGoals([]);
      setLibraryError(apiErrorMessage(loadError, t));
    });
  }, [account.id]);

  async function reloadAll() {
    await Promise.all([onReload(), loadAccountData(account.id)]);
  }

  async function runBusyAction(
    name: string,
    action: () => Promise<void>,
    successMessage?: string,
  ) {
    setActionError(null);
    setBusyAction(name);
    try {
      await action();
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  function requestConfirmation(nextConfirmation: PendingConfirmation) {
    setActionError(null);
    setConfirmation(nextConfirmation);
  }

  async function accountAction(name: AccountCommand) {
    return runBusyAction(
      name,
      async () => {
        await api(`/api/accounts/${account.id}/${name}`, { method: "POST" });
        await reloadAll();
      },
      t.accountDetail.actionSuccess[name],
    );
  }

  function updateDraftGames(appIds: number[]) {
    setActionError(null);
    setDraftAppIds([...new Set(appIds)]);
  }

  async function applyGameSelection() {
    setActionError(null);
    if (draftOverLimit) {
      setActionError(
        interpolate(t.accountDetail.tooManyGamesWithTitle, {
          limit: gameLimit,
        }),
      );
      return;
    }

    setGamesApplying(true);
    try {
      await api(`/api/accounts/${account.id}/games`, {
        method: "PUT",
        body: JSON.stringify({ appIds: draftAppIds }),
      });
      await reloadAll();
      setDraftAppIds(draftAppIds);
      setGamesAppliedAt(Date.now());
      toast.success(t.accountDetail.selectionApplied);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setGamesApplying(false);
    }
  }

  async function importLibrary() {
    if (!canImportLibrary) {
      const message = t.accountDetail.importRequiresOnline;
      setLibraryError(message);
      toast.error(message);
      return;
    }

    setLibraryError(null);
    setLibraryLoading(true);
    try {
      const imported = await api<SteamApp[]>(
        `/api/accounts/${account.id}/library/import`,
        { method: "POST" },
      );
      setLibrary(imported);
      await loadAccountData(account.id);
      toast.success(
        interpolate(t.accountDetail.gamesImported, { count: imported.length }),
      );
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setLibraryError(message);
      toast.error(message);
    } finally {
      setLibraryLoading(false);
    }
  }

  async function saveSettings() {
    return runBusyAction(
      "settings",
      async () => {
        await api(`/api/accounts/${account.id}/settings`, {
          method: "PUT",
          body: JSON.stringify({
            personaState,
            customTitle: customTitle || null,
          }),
        });
        await reloadAll();
      },
      t.accountDetail.profileSaved,
    );
  }

  async function deleteAccount(confirmed = false) {
    if (!confirmed) {
      requestConfirmation({
        description: t.accountDetail.confirmDeleteAccount,
        confirmLabel: t.common.remove,
        destructive: true,
        action: () => deleteAccount(true),
      });
      return false;
    }
    return runBusyAction(
      "delete",
      async () => {
        await api(`/api/accounts/${account.id}`, { method: "DELETE" });
        await reloadAll();
      },
      t.accountDetail.accountDeleted,
    );
  }

  async function createPreset() {
    const name = presetName.trim();
    if (!name) {
      toast.error(t.accountDetail.presetNameMissing);
      return false;
    }
    if (draftOverLimit) {
      toast.error(interpolate(t.accountDetail.maxGames, { limit: gameLimit }));
      return false;
    }

    return runBusyAction(
      "preset-create",
      async () => {
        await api(`/api/accounts/${account.id}/presets`, {
          method: "POST",
          body: JSON.stringify({
            name,
            appIds: draftAppIds,
            personaState,
            customTitle: customTitle || null,
          }),
        });
        setPresetName("");
        await loadAccountData(account.id);
      },
      t.accountDetail.presetCreated,
    );
  }

  async function applyPreset(preset: BoostPreset, confirmed = false) {
    if (!confirmed) {
      requestConfirmation({
        description: interpolate(t.accountDetail.confirmApplyPreset, {
          name: preset.name,
        }),
        confirmLabel: t.common.apply,
        destructive: false,
        action: () => applyPreset(preset, true),
      });
      return false;
    }

    return runBusyAction(
      `preset-${preset.id}`,
      async () => {
        await api(`/api/accounts/${account.id}/presets/${preset.id}/apply`, {
          method: "POST",
        });
        await reloadAll();
        setDraftAppIds(preset.appIds);
        setPersonaState(preset.personaState);
        setCustomTitle(preset.customTitle ?? "");
      },
      t.accountDetail.presetApplied,
    );
  }

  async function deletePreset(preset: BoostPreset, confirmed = false) {
    if (!confirmed) {
      requestConfirmation({
        description: interpolate(t.accountDetail.confirmDeletePreset, {
          name: preset.name,
        }),
        confirmLabel: t.common.delete,
        destructive: true,
        action: () => deletePreset(preset, true),
      });
      return false;
    }
    return runBusyAction(
      `preset-delete-${preset.id}`,
      async () => {
        await api(`/api/accounts/${account.id}/presets/${preset.id}`, {
          method: "DELETE",
        });
        await loadAccountData(account.id);
      },
      t.accountDetail.presetDeleted,
    );
  }

  async function createSchedule() {
    if (!schedulePresetId) {
      toast.error(t.accountDetail.choosePresetFirst);
      return false;
    }

    const name =
      scheduleName.trim() ||
      interpolate(t.accountDetail.defaultScheduleName, {
        start: scheduleStart,
        end: scheduleEnd,
      });
    return runBusyAction(
      "schedule-create",
      async () => {
        await api(`/api/accounts/${account.id}/schedules`, {
          method: "POST",
          body: JSON.stringify({
            name,
            presetId: schedulePresetId,
            enabled: true,
            weekdays: scheduleWeekdays,
            startTime: scheduleStart,
            endTime: scheduleEnd,
            timezone: localTimezone,
          }),
        });
        setScheduleName("");
        await loadAccountData(account.id);
      },
      t.accountDetail.scheduleCreated,
    );
  }

  async function toggleSchedule(schedule: BoostSchedule) {
    return runBusyAction(`schedule-${schedule.id}`, async () => {
      await api(`/api/accounts/${account.id}/schedules/${schedule.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      await loadAccountData(account.id);
    });
  }

  async function deleteSchedule(schedule: BoostSchedule, confirmed = false) {
    if (!confirmed) {
      requestConfirmation({
        description: interpolate(t.accountDetail.confirmDeleteSchedule, {
          name: schedule.name,
        }),
        confirmLabel: t.common.delete,
        destructive: true,
        action: () => deleteSchedule(schedule, true),
      });
      return false;
    }
    return runBusyAction(
      `schedule-delete-${schedule.id}`,
      async () => {
        await api(`/api/accounts/${account.id}/schedules/${schedule.id}`, {
          method: "DELETE",
        });
        await loadAccountData(account.id);
      },
      t.accountDetail.scheduleDeleted,
    );
  }

  async function refreshSchedulePreview() {
    return runBusyAction("schedule-preview", async () => {
      setSchedulePreview(
        await api<SchedulePreview>(
          `/api/accounts/${account.id}/schedules/preview?days=7`,
        ),
      );
    });
  }

  async function skipNextSchedule(schedule: BoostSchedule) {
    return runBusyAction(
      `schedule-skip-${schedule.id}`,
      async () => {
        await api(
          `/api/accounts/${account.id}/schedules/${schedule.id}/skip-next`,
          { method: "POST" },
        );
        await loadAccountData(account.id);
      },
      o.saved,
    );
  }

  async function saveSafetyPolicy(input: {
    resumePolicy: AccountSafetyPolicy["resumePolicy"];
    resumeDelayMinutes: number;
    maxSessionMinutes: number | null;
    maxDailyMinutes: number | null;
    maxWeeklyMinutes: number | null;
  }) {
    return runBusyAction(
      "safety-save",
      async () => {
        setSafety(
          await api<AccountSafetyPolicy>(`/api/accounts/${account.id}/safety`, {
            method: "PUT",
            body: JSON.stringify(input),
          }),
        );
        await onReload();
      },
      o.saved,
    );
  }

  async function pauseUntil(until: number) {
    return runBusyAction(
      "safety-pause",
      async () => {
        setSafety(
          await api<AccountSafetyPolicy>(
            `/api/accounts/${account.id}/safety/pause-until`,
            { method: "POST", body: JSON.stringify({ until }) },
          ),
        );
        await onReload();
      },
      o.saved,
    );
  }

  async function saveGoal(appId: number, targetMinutes: number) {
    return runBusyAction(
      "goal-save",
      async () => {
        setGoals(
          await api<PlaytimeGoal[]>(`/api/accounts/${account.id}/goals`, {
            method: "PUT",
            body: JSON.stringify({ appId, targetMinutes }),
          }),
        );
      },
      o.saved,
    );
  }

  async function deleteGoal(goal: PlaytimeGoal, confirmed = false) {
    if (!confirmed) {
      requestConfirmation({
        description: interpolate(o.confirmDeleteGoal, {
          name: goal.appName,
        }),
        confirmLabel: t.common.delete,
        destructive: true,
        action: () => deleteGoal(goal, true),
      });
      return false;
    }
    return runBusyAction(
      `goal-delete-${goal.id}`,
      async () => {
        await api(`/api/accounts/${account.id}/goals/${goal.id}`, {
          method: "DELETE",
        });
        setGoals((current) => current.filter((item) => item.id !== goal.id));
      },
      o.saved,
    );
  }

  function toggleWeekday(day: number) {
    setScheduleWeekdays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort(),
    );
  }

  const loadedPlanningPanel =
    planningTab === "presets" ? (
      <PresetPanel
        presets={presets}
        activePresetId={account.activePresetId}
        presetName={presetName}
        busyAction={busyAction}
        selectedCount={draftAppIds.length}
        personaState={personaState}
        customTitle={customTitle}
        onPresetNameChange={setPresetName}
        onCreatePreset={() => void createPreset()}
        onApplyPreset={(preset) => void applyPreset(preset)}
        onDeletePreset={(preset) => void deletePreset(preset)}
      />
    ) : planningTab === "schedule" ? (
      <SchedulePanel
        schedules={schedules}
        presets={presets}
        scheduleName={scheduleName}
        schedulePresetId={schedulePresetId}
        scheduleStart={scheduleStart}
        scheduleEnd={scheduleEnd}
        scheduleWeekdays={scheduleWeekdays}
        timezone={localTimezone}
        busyAction={busyAction}
        onScheduleNameChange={setScheduleName}
        onSchedulePresetChange={setSchedulePresetId}
        onScheduleStartChange={setScheduleStart}
        onScheduleEndChange={setScheduleEnd}
        onToggleWeekday={toggleWeekday}
        onCreateSchedule={() => void createSchedule()}
        onToggleSchedule={(schedule) => void toggleSchedule(schedule)}
        onDeleteSchedule={(schedule) => void deleteSchedule(schedule)}
        preview={schedulePreview}
        previewState={optionalStates.schedulePreview}
        onRefreshPreview={() => void refreshSchedulePreview()}
        onSkipNext={(schedule) => void skipNextSchedule(schedule)}
      />
    ) : planningTab === "analytics" ? (
      <AnalyticsPanel
        analytics={analytics}
        goals={goals}
        library={library}
        busy={Boolean(busyAction)}
        goalsState={optionalStates.goals}
        onSaveGoal={(appId, targetMinutes) =>
          void saveGoal(appId, targetMinutes)
        }
        onDeleteGoal={(goal) => void deleteGoal(goal)}
      />
    ) : (
      <SafetyPanel
        policy={safety}
        loadState={optionalStates.safety}
        busy={Boolean(busyAction)}
        canPauseUntil={account.desiredState === "running"}
        onSave={(input) => void saveSafetyPolicy(input)}
        onPauseUntil={(until) => void pauseUntil(until)}
      />
    );

  const planningPanel =
    loadState === "loading" ? (
      <p role="status" className="text-sm text-[var(--muted)]">
        {t.common.loading}
      </p>
    ) : loadState === "error" ? (
      <Alert tone="danger">{libraryError ?? o.failed}</Alert>
    ) : (
      loadedPlanningPanel
    );

  async function updateLibraryMeta(
    appId: number,
    patch: { favorite?: boolean; hidden?: boolean; tags?: string[] },
  ) {
    try {
      await api(`/api/accounts/${account.id}/library/meta`, {
        method: "PUT",
        body: JSON.stringify({ appId, ...patch }),
      });
      setLibrary((current) =>
        current.map((app) =>
          app.appId === appId
            ? {
                ...app,
                ...(patch.favorite !== undefined
                  ? { favorite: patch.favorite }
                  : {}),
                ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
                ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
              }
            : app,
        ),
      );
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setLibraryError(message);
      toast.error(message);
    }
  }

  return (
    <div className="grid gap-4">
      <AccountHeader
        controls={
          <AccountControlPanel
            busyAction={busyAction}
            canPause={canPause}
            canStop={canStop}
            eventCount={events.length}
            primaryCommand={primaryCommand}
            personaState={personaState}
            customTitle={customTitle}
            onPrimaryAction={() => {
              if (!primaryCommand) return;
              if (primaryCommand.kind === "focus-games") {
                manualAppInputRef.current?.focus();
                return;
              }
              void accountAction(primaryCommand.action);
            }}
            onPause={() => void accountAction("pause")}
            onStop={() => void accountAction("stop")}
            onOpenLogs={() => setLogOpen(true)}
            onDelete={() => void deleteAccount()}
            onPersonaChange={setPersonaState}
            onCustomTitleChange={setCustomTitle}
            onSaveSettings={saveSettings}
          />
        }
        status={
          <AccountStatusSummary
            account={account}
            libraryCount={library.length}
            appliedCount={appliedAppIds.length}
            draftCount={draftAppIds.length}
            gameLimit={gameLimit}
            selectionDirty={selectionDirty}
            events={events}
          />
        }
        profile={<AccountProfilePanel account={account} />}
      />

      {account.lastError && <Alert tone="danger">{account.lastError}</Alert>}
      {actionError && !confirmation ? (
        <Alert tone="danger">{actionError}</Alert>
      ) : null}

      <div className="grid gap-4">
        <GameLibraryPanel
          account={{ id: account.id, runtimeStatus: account.runtimeStatus }}
          library={{
            apps: library,
            loading: libraryLoading || loadState === "loading",
            error: libraryError,
            canImport: canImportLibrary,
            onImport: importLibrary,
            onUpdateMeta: updateLibraryMeta,
          }}
          selection={{
            draftAppIds,
            appliedAppIds,
            selectedGames,
            gameLimit,
            overLimit: draftOverLimit,
            applying: gamesApplying,
            appliedAt: gamesAppliedAt,
            dirty: selectionDirty,
            state: selectionApplyState,
            manualAppInputRef,
            onChange: updateDraftGames,
            onApply: applyGameSelection,
            onRevert: () => setDraftAppIds(appliedAppIds),
          }}
          rightRailExtra={
            <BoostToolsPanel
              activeTab={planningTab}
              onTabChange={setPlanningTab}
              presetCount={presets.length}
              activeScheduleCount={
                schedules.filter((schedule) => schedule.enabled).length
              }
              analyticsLast7DaysMs={analytics?.last7DaysMs ?? 0}
            >
              {planningPanel}
            </BoostToolsPanel>
          }
        />
      </div>

      <LogDrawer
        open={logOpen}
        events={events}
        diagnostics={diagnostics}
        onClose={() => setLogOpen(false)}
      />
      {confirmation ? (
        <ConfirmationDialog
          title={t.common.confirmAction}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={t.common.cancel}
          busyLabel={t.common.pleaseWait}
          busy={confirmationBusy}
          error={actionError}
          destructive={confirmation.destructive}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            setConfirmationBusy(true);
            try {
              if (await confirmation.action()) setConfirmation(null);
            } finally {
              setConfirmationBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
