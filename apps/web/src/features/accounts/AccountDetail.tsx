import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CirclePlay,
  Copy,
  ListChecks,
  Pause,
  PlaySquare,
  Save,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Account,
  BoostAnalytics,
  BoostPreset,
  BoostSchedule,
  Diagnostics,
  SteamApp,
  SteamEvent,
} from "../../api";
import { api, apiErrorMessage, isAbortError } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmationDialog } from "../../components/ui/confirmation-dialog";
import { Label, Select, Input } from "../../components/ui/form";
import {
  formatEventDate,
  formatEventTime,
  formatTokenDate,
  sameAppIdSelection,
} from "../../lib/format";
import {
  busyStates,
  desiredLabel,
  eventDisplay,
  getPrimaryCommand,
  importableStates,
  nextStepMessage,
  pausedStates,
  personaLabel,
  personaOptions,
  selectionApplyCopy,
  statusSummary,
} from "../../lib/status";
import { cn } from "../../lib/utils";
import { interpolate, useI18n, type Messages } from "../../i18n";
import { LogDrawer } from "../events/LogDrawer";
import { GameLibraryPanel } from "../library/GameLibraryPanel";
import { AccountAvatar } from "./AccountAvatar";
import { StatusBadge } from "./StatusIndicators";
import { useAccountResources } from "./useAccountController";

type PendingConfirmation = {
  description: string;
  confirmLabel: string;
  destructive: boolean;
  action: () => Promise<void>;
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
  const {
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
  const [planningTab, setPlanningTab] = useState<
    "presets" | "schedule" | "analytics"
  >("presets");
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
  const gameLimit = customTitle.trim() ? 31 : 32;
  const draftOverLimit = draftAppIds.length > gameLimit;
  const selectionDirty = !sameAppIdSelection(appliedAppIds, draftAppIds);
  const isBusy = busyStates.has(account.runtimeStatus);
  const isPaused = pausedStates.has(account.runtimeStatus);
  const canImportLibrary = importableStates.has(account.runtimeStatus);
  const canPause =
    !isBusy &&
    !isPaused &&
    (account.runtimeStatus === "online" ||
      account.runtimeStatus === "boosting");
  const canStop = account.runtimeStatus !== "disconnected" && !isBusy;
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
      setLibraryError(apiErrorMessage(loadError, t));
    });
  }, [account.id]);

  async function reloadAll() {
    await Promise.all([onReload(), loadAccountData(account.id)]);
  }

  async function accountAction(name: "start" | "pause" | "resume" | "stop") {
    setActionError(null);
    setBusyAction(name);
    try {
      await api(`/api/accounts/${account.id}/${name}`, { method: "POST" });
      await reloadAll();
      toast.success(t.accountDetail.actionSuccess[name]);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
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
    setActionError(null);
    setBusyAction("settings");
    try {
      await api(`/api/accounts/${account.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          personaState,
          customTitle: customTitle || null,
        }),
      });
      await reloadAll();
      toast.success(t.accountDetail.profileSaved);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteAccount(confirmed = false) {
    if (!confirmed) {
      setConfirmation({
        description: t.accountDetail.confirmDeleteAccount,
        confirmLabel: t.common.remove,
        destructive: true,
        action: () => deleteAccount(true),
      });
      return;
    }
    setBusyAction("delete");
    try {
      await api(`/api/accounts/${account.id}`, { method: "DELETE" });
      await reloadAll();
      toast.success(t.accountDetail.accountDeleted);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function createPreset() {
    const name = presetName.trim();
    if (!name) {
      toast.error(t.accountDetail.presetNameMissing);
      return;
    }
    if (draftOverLimit) {
      toast.error(interpolate(t.accountDetail.maxGames, { limit: gameLimit }));
      return;
    }

    setBusyAction("preset-create");
    try {
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
      toast.success(t.accountDetail.presetCreated);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function applyPreset(preset: BoostPreset, confirmed = false) {
    if (!confirmed) {
      setConfirmation({
        description: interpolate(t.accountDetail.confirmApplyPreset, {
          name: preset.name,
        }),
        confirmLabel: t.common.apply,
        destructive: false,
        action: () => applyPreset(preset, true),
      });
      return;
    }

    setBusyAction(`preset-${preset.id}`);
    try {
      await api(`/api/accounts/${account.id}/presets/${preset.id}/apply`, {
        method: "POST",
      });
      await reloadAll();
      setDraftAppIds(preset.appIds);
      setPersonaState(preset.personaState);
      setCustomTitle(preset.customTitle ?? "");
      toast.success(t.accountDetail.presetApplied);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function deletePreset(preset: BoostPreset, confirmed = false) {
    if (!confirmed) {
      setConfirmation({
        description: interpolate(t.accountDetail.confirmDeletePreset, {
          name: preset.name,
        }),
        confirmLabel: t.common.delete,
        destructive: true,
        action: () => deletePreset(preset, true),
      });
      return;
    }
    setBusyAction(`preset-delete-${preset.id}`);
    try {
      await api(`/api/accounts/${account.id}/presets/${preset.id}`, {
        method: "DELETE",
      });
      await loadAccountData(account.id);
      toast.success(t.accountDetail.presetDeleted);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function createSchedule() {
    if (!schedulePresetId) {
      toast.error(t.accountDetail.choosePresetFirst);
      return;
    }

    const name =
      scheduleName.trim() ||
      interpolate(t.accountDetail.defaultScheduleName, {
        start: scheduleStart,
        end: scheduleEnd,
      });
    setBusyAction("schedule-create");
    try {
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
      toast.success(t.accountDetail.scheduleCreated);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleSchedule(schedule: BoostSchedule) {
    setBusyAction(`schedule-${schedule.id}`);
    try {
      await api(`/api/accounts/${account.id}/schedules/${schedule.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      await loadAccountData(account.id);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteSchedule(schedule: BoostSchedule, confirmed = false) {
    if (!confirmed) {
      setConfirmation({
        description: interpolate(t.accountDetail.confirmDeleteSchedule, {
          name: schedule.name,
        }),
        confirmLabel: t.common.delete,
        destructive: true,
        action: () => deleteSchedule(schedule, true),
      });
      return;
    }
    setBusyAction(`schedule-delete-${schedule.id}`);
    try {
      await api(`/api/accounts/${account.id}/schedules/${schedule.id}`, {
        method: "DELETE",
      });
      await loadAccountData(account.id);
      toast.success(t.accountDetail.scheduleDeleted);
    } catch (requestError) {
      const message = apiErrorMessage(requestError, t);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  }

  function toggleWeekday(day: number) {
    setScheduleWeekdays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort(),
    );
  }

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
      <header className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-[var(--panel-shadow)]">
        <div className="grid gap-4 p-4 xl:grid-cols-[380px_minmax(0,1fr)_360px] xl:items-stretch">
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

          <AccountStatusSummary
            account={account}
            libraryCount={library.length}
            appliedCount={appliedAppIds.length}
            draftCount={draftAppIds.length}
            gameLimit={gameLimit}
            selectionDirty={selectionDirty}
            events={events}
          />

          <AccountProfilePanel account={account} />
        </div>
      </header>

      {account.lastError && <Alert tone="danger">{account.lastError}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <div className="grid gap-4">
        <GameLibraryPanel
          accountId={account.id}
          runtimeStatus={account.runtimeStatus}
          library={library}
          libraryLoading={libraryLoading}
          libraryError={libraryError}
          canImportLibrary={canImportLibrary}
          onImport={importLibrary}
          draftAppIds={draftAppIds}
          appliedAppIds={appliedAppIds}
          selectedGames={selectedGames}
          gameLimit={gameLimit}
          draftOverLimit={draftOverLimit}
          gamesApplying={gamesApplying}
          gamesAppliedAt={gamesAppliedAt}
          selectionDirty={selectionDirty}
          selectionState={selectionApplyState}
          manualAppInputRef={manualAppInputRef}
          onDraftChange={updateDraftGames}
          onUpdateLibraryMeta={updateLibraryMeta}
          onApply={applyGameSelection}
          onRevert={() => setDraftAppIds(appliedAppIds)}
          rightRailExtra={
            <BoostToolsPanel
              activeTab={planningTab}
              onTabChange={setPlanningTab}
              presets={presets}
              schedules={schedules}
              analytics={analytics}
              activePresetId={account.activePresetId}
              presetName={presetName}
              busyAction={busyAction}
              selectedCount={draftAppIds.length}
              personaState={personaState}
              customTitle={customTitle}
              scheduleName={scheduleName}
              schedulePresetId={schedulePresetId}
              scheduleStart={scheduleStart}
              scheduleEnd={scheduleEnd}
              scheduleWeekdays={scheduleWeekdays}
              timezone={localTimezone}
              onPresetNameChange={setPresetName}
              onCreatePreset={() => void createPreset()}
              onApplyPreset={(preset) => void applyPreset(preset)}
              onDeletePreset={(preset) => void deletePreset(preset)}
              onScheduleNameChange={setScheduleName}
              onSchedulePresetChange={setSchedulePresetId}
              onScheduleStartChange={setScheduleStart}
              onScheduleEndChange={setScheduleEnd}
              onToggleWeekday={toggleWeekday}
              onCreateSchedule={() => void createSchedule()}
              onToggleSchedule={(schedule) => void toggleSchedule(schedule)}
              onDeleteSchedule={(schedule) => void deleteSchedule(schedule)}
            />
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
          destructive={confirmation.destructive}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            setConfirmationBusy(true);
            try {
              await confirmation.action();
              setConfirmation(null);
            } finally {
              setConfirmationBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function AccountProfilePanel({ account }: { account: Account }) {
  const { messages: t, localeInfo } = useI18n();

  return (
    <section className="grid min-w-0 gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--muted)]">
            {t.accountDetail.profileTitle}
          </p>
          <h2 className="mt-1 truncate text-3xl font-semibold">
            {account.accountName}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={account.runtimeStatus} />
            <Badge tone="neutral">
              {formatTokenDate(account.tokenExpiresAt, t, localeInfo)}
            </Badge>
          </div>
        </div>
        <AccountAvatar account={account} size="hero" />
      </div>

      <dl className="grid gap-3 border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
        <div>
          <dt className="font-semibold text-[var(--muted-strong)]">SteamID:</dt>
          <dd className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <input
              id="steam-id-copy"
              readOnly
              value={account.steamId ?? t.accountDetail.steamIdUnknown}
              className="min-w-0 truncate bg-transparent px-2.5 py-2 text-xs font-mono text-[var(--muted-strong)] outline-none"
              aria-label="SteamID"
              title={account.steamId ?? t.accountDetail.steamIdUnknown}
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={!account.steamId}
              onClick={() => void copySteamId(account.steamId, t)}
              aria-label={t.accountDetail.copySteamId}
              title={t.accountDetail.copySteamId}
              className="h-8 w-8 rounded-none border-l border-[var(--line)]"
            >
              <Copy size={14} />
            </Button>
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted-strong)]">
            {t.accountDetail.autostart}
          </dt>
          <dd className="mt-1 leading-5">
            {autostartCopy(account.desiredState, t)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function AccountStatusSummary({
  account,
  libraryCount,
  appliedCount,
  draftCount,
  gameLimit,
  selectionDirty,
  events,
}: {
  account: Account;
  libraryCount: number;
  appliedCount: number;
  draftCount: number;
  gameLimit: number;
  selectionDirty: boolean;
  events: SteamEvent[];
}) {
  const { messages: t, localeInfo } = useI18n();

  return (
    <section className="flex h-full min-w-0 flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <div>
        <p className="text-xs font-semibold text-[var(--muted)]">
          {t.accountDetail.boostStatus}
        </p>
        <strong className="mt-1 block text-base">
          {statusSummary(account.runtimeStatus, appliedCount, t)}
        </strong>
        <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
          {nextStepMessage(
            account.runtimeStatus,
            libraryCount,
            appliedCount,
            t,
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatusFact
          label={t.accountDetail.activeGames}
          value={interpolate(t.accountDetail.ofLimit, {
            count: appliedCount,
            limit: gameLimit,
          })}
          detail={
            selectionDirty
              ? interpolate(t.accountDetail.draftGames, { count: draftCount })
              : t.accountDetail.reportedToSteam
          }
          tone={selectionDirty ? "warn" : appliedCount > 0 ? "good" : "neutral"}
        />
        <StatusFact
          label={t.accountDetail.visibility}
          value={personaLabel(account.personaState, t)}
          detail={t.accountDetail.steamStatus}
          tone="neutral"
        />
        <StatusFact
          label={t.accountDetail.boostingSince}
          value={formatBoostRunningSince(
            account.latestBoostStartedAt,
            t,
            localeInfo.dateLocale,
          )}
          detail={
            account.latestBoostStartedAt
              ? t.accountDetail.running
              : t.accountDetail.notStarted
          }
          tone={account.runtimeStatus === "boosting" ? "good" : "neutral"}
        />
      </div>

      <RecentLogList events={events} />
    </section>
  );
}

function StatusFact({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border bg-[var(--surface)] px-3 py-2",
        tone === "neutral" && "border-[var(--line)]",
        tone === "good" && "border-[var(--good-line)]",
        tone === "warn" && "border-[var(--warn-line)]",
      )}
    >
      <span className="block truncate text-xs font-semibold text-[var(--muted)]">
        {label}
      </span>
      <strong className="mt-0.5 block break-words text-sm leading-5">
        {value}
      </strong>
      <small className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
        {detail}
      </small>
    </div>
  );
}

function AccountControlPanel({
  busyAction,
  canPause,
  canStop,
  eventCount,
  primaryCommand,
  personaState,
  customTitle,
  onPrimaryAction,
  onPause,
  onStop,
  onOpenLogs,
  onDelete,
  onPersonaChange,
  onCustomTitleChange,
  onSaveSettings,
}: {
  busyAction: string | null;
  canPause: boolean;
  canStop: boolean;
  eventCount: number;
  primaryCommand: ReturnType<typeof getPrimaryCommand>;
  personaState: number;
  customTitle: string;
  onPrimaryAction: () => void;
  onPause: () => void;
  onStop: () => void;
  onOpenLogs: () => void;
  onDelete: () => void;
  onPersonaChange: (value: number) => void;
  onCustomTitleChange: (value: string) => void;
  onSaveSettings: () => Promise<void>;
}) {
  const { messages: t } = useI18n();

  return (
    <aside className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div>
        <h3 className="text-sm font-semibold">{t.accountDetail.control}</h3>
      </div>

      <ControlGroup title={t.accountDetail.boosting}>
        <div className="grid grid-cols-2 gap-2">
          {primaryCommand && (
            <Button
              variant="primary"
              size="sm"
              onClick={onPrimaryAction}
              disabled={primaryCommand.disabled || Boolean(busyAction)}
              className="w-full"
            >
              <CirclePlay size={16} />
              {busyAction === primaryCommand.action
                ? t.common.pleaseWait
                : primaryCommand.label}
            </Button>
          )}
          {canPause && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onPause}
              disabled={Boolean(busyAction)}
              className="w-full"
            >
              <Pause size={16} />
              {t.common.pause}
            </Button>
          )}
          {canStop && (
            <Button
              variant="danger"
              size="sm"
              onClick={onStop}
              disabled={Boolean(busyAction)}
              className="w-full"
            >
              <Square size={16} />
              {t.common.stop}
            </Button>
          )}
        </div>
      </ControlGroup>

      <ControlGroup title={t.accountDetail.diagnosisAccount}>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenLogs}
            className="w-full"
          >
            <ListChecks size={16} />
            {t.accountDetail.viewLogs}
            <span className="rounded-full bg-[var(--surface)] px-1.5 text-xs">
              {eventCount}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={Boolean(busyAction)}
            className="w-full text-[var(--danger)]"
          >
            <Trash2 size={16} />
            {t.accountDetail.removeAccount}
          </Button>
        </div>
      </ControlGroup>

      <ControlGroup title={t.accountDetail.steamProfile}>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)] sm:items-end">
          <Label htmlFor="persona-state" className="min-w-0">
            {t.accountDetail.visibility}
            <Select
              id="persona-state"
              name="personaState"
              value={personaState}
              onChange={(event) => onPersonaChange(Number(event.target.value))}
            >
              {personaOptions(t).map((persona) => (
                <option key={persona.value} value={persona.value}>
                  {persona.label}
                </option>
              ))}
            </Select>
          </Label>
          <Label htmlFor="custom-title" className="min-w-0">
            {t.accountDetail.steamTitle}
            <Input
              id="custom-title"
              name="customTitle"
              value={customTitle}
              maxLength={80}
              onChange={(event) => onCustomTitleChange(event.target.value)}
              placeholder={t.common.optional}
            />
          </Label>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onSaveSettings()}
            disabled={busyAction === "settings"}
            className="w-full sm:col-span-2"
          >
            <Save size={16} />
            {busyAction === "settings"
              ? t.common.saving
              : t.accountDetail.saveDisplay}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-[var(--muted)]">
          {t.accountDetail.titleSlotHint}
        </p>
      </ControlGroup>
    </aside>
  );
}

function BoostToolsPanel({
  activeTab,
  onTabChange,
  presets,
  schedules,
  analytics,
  activePresetId,
  presetName,
  busyAction,
  selectedCount,
  personaState,
  customTitle,
  scheduleName,
  schedulePresetId,
  scheduleStart,
  scheduleEnd,
  scheduleWeekdays,
  timezone,
  onPresetNameChange,
  onCreatePreset,
  onApplyPreset,
  onDeletePreset,
  onScheduleNameChange,
  onSchedulePresetChange,
  onScheduleStartChange,
  onScheduleEndChange,
  onToggleWeekday,
  onCreateSchedule,
  onToggleSchedule,
  onDeleteSchedule,
}: {
  activeTab: "presets" | "schedule" | "analytics";
  onTabChange: (tab: "presets" | "schedule" | "analytics") => void;
  presets: BoostPreset[];
  schedules: BoostSchedule[];
  analytics: BoostAnalytics | null;
  activePresetId: string | null;
  presetName: string;
  busyAction: string | null;
  selectedCount: number;
  personaState: number;
  customTitle: string;
  scheduleName: string;
  schedulePresetId: string;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleWeekdays: number[];
  timezone: string;
  onPresetNameChange: (value: string) => void;
  onCreatePreset: () => void;
  onApplyPreset: (preset: BoostPreset) => void;
  onDeletePreset: (preset: BoostPreset) => void;
  onScheduleNameChange: (value: string) => void;
  onSchedulePresetChange: (value: string) => void;
  onScheduleStartChange: (value: string) => void;
  onScheduleEndChange: (value: string) => void;
  onToggleWeekday: (day: number) => void;
  onCreateSchedule: () => void;
  onToggleSchedule: (schedule: BoostSchedule) => void;
  onDeleteSchedule: (schedule: BoostSchedule) => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const tabs = [
    { id: "presets" as const, label: t.tools.presets, meta: presets.length },
    {
      id: "schedule" as const,
      label: t.tools.schedule,
      meta: schedules.filter((schedule) => schedule.enabled).length,
    },
    {
      id: "analytics" as const,
      label: t.tools.analytics,
      meta: formatDurationMs(
        analytics?.last7DaysMs ?? 0,
        t,
        localeInfo.dateLocale,
      ),
    },
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{t.tools.title}</h3>
            <p className="truncate text-xs text-[var(--muted)]">
              {t.tools.description}
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-[var(--surface-2)] p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "min-w-0 rounded px-2 py-1.5 text-left text-xs transition",
                activeTab === tab.id
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm"
                  : "text-[var(--muted-strong)] hover:bg-[var(--surface-3)]",
              )}
            >
              <span className="block truncate font-semibold">{tab.label}</span>
              <span className="block truncate text-[10px] text-[var(--muted)]">
                {tab.meta}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {activeTab === "presets" ? (
          <PresetPanel
            presets={presets}
            activePresetId={activePresetId}
            presetName={presetName}
            busyAction={busyAction}
            selectedCount={selectedCount}
            personaState={personaState}
            customTitle={customTitle}
            onPresetNameChange={onPresetNameChange}
            onCreatePreset={onCreatePreset}
            onApplyPreset={onApplyPreset}
            onDeletePreset={onDeletePreset}
          />
        ) : null}
        {activeTab === "schedule" ? (
          <SchedulePanel
            schedules={schedules}
            presets={presets}
            scheduleName={scheduleName}
            schedulePresetId={schedulePresetId}
            scheduleStart={scheduleStart}
            scheduleEnd={scheduleEnd}
            scheduleWeekdays={scheduleWeekdays}
            timezone={timezone}
            busyAction={busyAction}
            onScheduleNameChange={onScheduleNameChange}
            onSchedulePresetChange={onSchedulePresetChange}
            onScheduleStartChange={onScheduleStartChange}
            onScheduleEndChange={onScheduleEndChange}
            onToggleWeekday={onToggleWeekday}
            onCreateSchedule={onCreateSchedule}
            onToggleSchedule={onToggleSchedule}
            onDeleteSchedule={onDeleteSchedule}
          />
        ) : null}
        {activeTab === "analytics" ? (
          <AnalyticsPanel analytics={analytics} />
        ) : null}
      </div>
    </section>
  );
}

function PresetPanel({
  presets,
  activePresetId,
  presetName,
  busyAction,
  selectedCount,
  personaState,
  customTitle,
  onPresetNameChange,
  onCreatePreset,
  onApplyPreset,
  onDeletePreset,
}: {
  presets: BoostPreset[];
  activePresetId: string | null;
  presetName: string;
  busyAction: string | null;
  selectedCount: number;
  personaState: number;
  customTitle: string;
  onPresetNameChange: (value: string) => void;
  onCreatePreset: () => void;
  onApplyPreset: (preset: BoostPreset) => void;
  onDeletePreset: (preset: BoostPreset) => void;
}) {
  const { messages: t } = useI18n();

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{t.tools.boostPresets}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {t.tools.presetsDescription}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          value={presetName}
          onChange={(event) => onPresetNameChange(event.target.value)}
          placeholder={t.tools.presetPlaceholder}
          aria-label={t.tools.presetNameAria}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={Boolean(busyAction) || selectedCount === 0}
          onClick={onCreatePreset}
        >
          <Star size={15} />
          {t.tools.savePreset}
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-[var(--muted)]">
        {interpolate(t.tools.current, {
          count: selectedCount,
          persona: personaLabel(personaState, t),
          titleActive: customTitle.trim() ? t.tools.withSteamTitle : "",
        })}
      </p>
      <div className="grid max-h-56 gap-2 overflow-auto pr-1">
        {presets.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
            {t.tools.noPresets}
          </div>
        ) : (
          presets.map((preset) => (
            <div
              key={preset.id}
              className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {preset.name}
                  </strong>
                  <span className="text-xs text-[var(--muted)]">
                    {preset.appIds.length} {t.common.games} ·{" "}
                    {personaLabel(preset.personaState, t)}
                    {preset.customTitle ? t.tools.titleActive : ""}
                  </span>
                </div>
                {preset.id === activePresetId ? (
                  <Badge tone="good">{t.tools.active}</Badge>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  disabled={Boolean(busyAction)}
                  onClick={() => onApplyPreset(preset)}
                >
                  <PlaySquare size={15} />
                  {t.tools.apply}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={Boolean(busyAction)}
                  onClick={() => onDeletePreset(preset)}
                  aria-label={`${preset.name} ${t.tools.deletePreset}`}
                  title={t.tools.deletePreset}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function SchedulePanel({
  schedules,
  presets,
  scheduleName,
  schedulePresetId,
  scheduleStart,
  scheduleEnd,
  scheduleWeekdays,
  timezone,
  busyAction,
  onScheduleNameChange,
  onSchedulePresetChange,
  onScheduleStartChange,
  onScheduleEndChange,
  onToggleWeekday,
  onCreateSchedule,
  onToggleSchedule,
  onDeleteSchedule,
}: {
  schedules: BoostSchedule[];
  presets: BoostPreset[];
  scheduleName: string;
  schedulePresetId: string;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleWeekdays: number[];
  timezone: string;
  busyAction: string | null;
  onScheduleNameChange: (value: string) => void;
  onSchedulePresetChange: (value: string) => void;
  onScheduleStartChange: (value: string) => void;
  onScheduleEndChange: (value: string) => void;
  onToggleWeekday: (day: number) => void;
  onCreateSchedule: () => void;
  onToggleSchedule: (schedule: BoostSchedule) => void;
  onDeleteSchedule: (schedule: BoostSchedule) => void;
}) {
  const { messages: t, localeInfo } = useI18n();

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{t.tools.schedules}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {t.tools.schedulesDescription}
        </p>
      </div>
      <div className="grid gap-2">
        <Input
          value={scheduleName}
          onChange={(event) => onScheduleNameChange(event.target.value)}
          placeholder={t.tools.scheduleNamePlaceholder}
          aria-label={t.tools.scheduleNameAria}
        />
        <Select
          value={schedulePresetId}
          onChange={(event) => onSchedulePresetChange(event.target.value)}
          aria-label={t.tools.schedulePresetAria}
        >
          <option value="">{t.tools.choosePreset}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="time"
            value={scheduleStart}
            onChange={(event) => onScheduleStartChange(event.target.value)}
            aria-label={t.tools.startTime}
          />
          <Input
            type="time"
            value={scheduleEnd}
            onChange={(event) => onScheduleEndChange(event.target.value)}
            aria-label={t.tools.endTime}
          />
        </div>
        <div className="flex flex-wrap gap-1" aria-label={t.tools.weekdaysAria}>
          {weekdayLabels(localeInfo.dateLocale).map((day) => (
            <button
              key={day.value}
              type="button"
              onClick={() => onToggleWeekday(day.value)}
              className={cn(
                "h-7 min-w-8 rounded-md border px-2 text-xs font-semibold",
                scheduleWeekdays.includes(day.value)
                  ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-strong)]",
              )}
            >
              {day.label}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={
            Boolean(busyAction) ||
            !schedulePresetId ||
            scheduleWeekdays.length === 0
          }
          onClick={onCreateSchedule}
        >
          <CalendarClock size={15} />
          {t.tools.createSchedule}
        </Button>
        <p className="text-[11px] text-[var(--muted)]">{timezone}</p>
      </div>
      <div className="grid max-h-44 gap-2 overflow-auto pr-1">
        {schedules.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
            {t.tools.noSchedules}
          </div>
        ) : (
          schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {schedule.name}
                  </strong>
                  <span className="text-xs text-[var(--muted)]">
                    {schedule.startTime}-{schedule.endTime} ·{" "}
                    {schedule.presetName ?? t.tools.preset} ·{" "}
                    {schedule.enabled ? t.common.active : t.common.off}
                  </span>
                </div>
                <Badge tone={schedule.enabled ? "good" : "neutral"}>
                  {schedule.enabled ? t.common.on : t.common.off}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  disabled={Boolean(busyAction)}
                  onClick={() => onToggleSchedule(schedule)}
                >
                  {schedule.enabled ? t.tools.disable : t.tools.enable}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={Boolean(busyAction)}
                  onClick={() => onDeleteSchedule(schedule)}
                  aria-label={`${schedule.name} ${t.tools.deleteSchedule}`}
                  title={t.tools.deleteSchedule}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AnalyticsPanel({ analytics }: { analytics: BoostAnalytics | null }) {
  const { messages: t, localeInfo } = useI18n();
  const topGames = Array.isArray(analytics?.topGames) ? analytics.topGames : [];
  const recentSessions = Array.isArray(analytics?.recentSessions)
    ? analytics.recentSessions
    : [];
  const totalSessions =
    typeof analytics?.totalSessions === "number" ? analytics.totalSessions : 0;

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{t.tools.analytics}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {t.tools.analyticsDescription}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatusFact
          label={t.tools.today}
          value={formatDurationMs(
            analytics?.todayMs ?? 0,
            t,
            localeInfo.dateLocale,
          )}
          detail={t.tools.boostTime}
          tone="neutral"
        />
        <StatusFact
          label={t.tools.sevenDays}
          value={formatDurationMs(
            analytics?.last7DaysMs ?? 0,
            t,
            localeInfo.dateLocale,
          )}
          detail={interpolate(t.tools.sessions, { count: totalSessions })}
          tone="neutral"
        />
      </div>
      <div className="grid gap-2">
        <strong className="text-xs text-[var(--muted-strong)]">
          {t.tools.topGames}
        </strong>
        {topGames.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--muted)]">
            {t.tools.noAnalytics}
          </div>
        ) : (
          <div className="grid max-h-32 gap-1 overflow-auto pr-1">
            {topGames.map((game) => (
              <div
                key={game.appId}
                className="flex items-center justify-between gap-2 rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-xs"
              >
                <span className="truncate">{game.name}</span>
                <span className="shrink-0 text-[var(--muted)]">
                  {formatDurationMs(game.durationMs, t, localeInfo.dateLocale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-2">
        <strong className="text-xs text-[var(--muted-strong)]">
          {t.tools.recentSessions}
        </strong>
        <div className="grid max-h-32 gap-1 overflow-auto pr-1">
          {recentSessions.slice(0, 5).map((session) => (
            <div
              key={session.id}
              className="rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-xs"
            >
              <div className="flex justify-between gap-2">
                <span className="truncate">
                  {session.presetName ??
                    `${session.appIds.length} ${t.common.games}`}
                </span>
                <span className="shrink-0 text-[var(--muted)]">
                  {formatDurationMs(
                    session.durationMs,
                    t,
                    localeInfo.dateLocale,
                  )}
                </span>
              </div>
              <time className="text-[var(--muted)]">
                {formatDateTime(session.startedAt, localeInfo.dateLocale)}
              </time>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ControlGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 border-t border-[var(--line)] pt-2 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-semibold text-[var(--muted-strong)]">
        {title}
      </h4>
      {children}
    </section>
  );
}

function RecentLogList({ events }: { events: SteamEvent[] }) {
  const { messages: t, localeInfo } = useI18n();
  const recentEvents = events.slice(0, 10);

  return (
    <div className="min-h-0 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <strong className="text-xs font-semibold text-[var(--muted-strong)]">
          {t.accountDetail.recentLogs}
        </strong>
        <span className="text-xs text-[var(--muted)]">
          {recentEvents.length}/{events.length}
        </span>
      </div>
      <div className="max-h-32 overflow-auto">
        {recentEvents.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--muted)]">
            {t.eventsPanel.noLogs}
          </div>
        ) : (
          recentEvents.map((event) => {
            const display = eventDisplay(event, t);
            return (
              <div
                key={event.id}
                className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 border-b border-[var(--line)] px-3 py-1.5 text-xs last:border-b-0"
              >
                <time className="whitespace-nowrap text-[var(--muted)]">
                  {formatEventDate(event.createdAt, localeInfo)}{" "}
                  {formatEventTime(event.createdAt, localeInfo)}
                </time>
                <span
                  className={cn(
                    "truncate",
                    event.level === "error"
                      ? "text-[var(--danger)]"
                      : event.level === "warn"
                        ? "text-[var(--warn)]"
                        : "text-[var(--muted-strong)]",
                  )}
                  title={display.title}
                >
                  {display.title}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function autostartCopy(desiredState: string, messages: Messages) {
  const copy: Record<string, string> = messages.status.desiredDescription;
  return copy[desiredState] ?? desiredLabel(desiredState, messages);
}

async function copySteamId(steamId: string | null, messages: Messages) {
  if (!steamId) return;
  const copy = messages.accountDetail;
  const field = document.querySelector<HTMLInputElement>("#steam-id-copy");
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable");
    }
    await navigator.clipboard.writeText(steamId);
    toast.success(copy.copiedSteamId);
  } catch {
    try {
      const input = document.createElement("textarea");
      input.value = steamId;
      input.setAttribute("readonly", "true");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("execCommand copy failed");
      toast.success(copy.copiedSteamId);
    } catch {
      if (field) {
        field.focus();
        field.select();
        toast.info(copy.selectedSteamId);
        return;
      }
      toast.error(copy.copySteamIdFailed);
    }
  }
}

function formatBoostRunningSince(
  value: number | null,
  messages: Messages,
  dateLocale: string,
) {
  if (!value) return messages.format.notActive;
  return new Date(value).toLocaleString(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDurationMs(value: number, messages: Messages, locale: string) {
  if (!value) return messages.format.zeroHours;
  const hours = value / 3_600_000;
  if (hours < 1) {
    return interpolate(messages.format.minutes, {
      count: Math.round(value / 60_000).toLocaleString(locale),
    });
  }
  return interpolate(messages.format.hours, {
    count: hours.toLocaleString(locale, {
      maximumFractionDigits: hours < 10 ? 1 : 0,
    }),
  });
}

function formatDateTime(value: number, dateLocale: string) {
  return new Date(value).toLocaleString(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function weekdayLabels(dateLocale: string) {
  const formatter = new Intl.DateTimeFormat(dateLocale, {
    weekday: "short",
  });
  const sunday = new Date(Date.UTC(2024, 0, 7));
  return [1, 2, 3, 4, 5, 6, 0].map((value) => {
    const date = new Date(sunday);
    date.setUTCDate(sunday.getUTCDate() + value);
    return {
      value,
      label: formatter.format(date).replace(/\.$/, ""),
    };
  });
}
