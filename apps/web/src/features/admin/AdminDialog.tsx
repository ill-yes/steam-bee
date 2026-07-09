import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CalendarClock,
  Database,
  KeyRound,
  Pause,
  Play,
  Power,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import {
  api,
  apiErrorMessage,
  type AdminOverview,
  type AdminSession,
  type SteamEvent,
} from "../../api";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { ConfirmationDialog } from "../../components/ui/confirmation-dialog";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Select } from "../../components/ui/form";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { formatEventTime } from "../../lib/format";
import { eventDisplay, statusLabel } from "../../lib/status";
import { cn } from "../../lib/utils";
import { interpolate, useI18n, type Messages } from "../../i18n";
import { useAdminData } from "./useAdminController";

type AdminTab = "security" | "accounts" | "logs" | "automation" | "data";

type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  action: () => Promise<void>;
};

export function AdminDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { messages: t } = useI18n();
  const [tab, setTab] = useState<AdminTab>("security");
  const { overview, sessions, loading, error, setError, loadAdmin } =
    useAdminData(t);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const tabs: Array<{ value: AdminTab; label: string }> = [
    { value: "security", label: t.admin.tabs.security },
    { value: "accounts", label: t.admin.tabs.accounts },
    { value: "logs", label: t.admin.tabs.logs },
    { value: "automation", label: t.admin.tabs.automation },
    { value: "data", label: t.admin.tabs.data },
  ];

  useEffect(() => {
    void loadAdmin();
  }, []);

  async function runMutation({
    busy,
    success,
    refreshApp = false,
    action,
  }: {
    busy: string;
    success: string;
    refreshApp?: boolean;
    action: () => Promise<void>;
  }) {
    setBusyAction(busy);
    setError(null);
    setNotice(null);
    try {
      await action();
      await loadAdmin();
      if (refreshApp) await onChanged();
      setNotice(success);
    } catch (mutationError) {
      setError(apiErrorMessage(mutationError, t));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <Dialog
        title={t.admin.title}
        description={t.admin.description}
        onClose={onClose}
        className="max-w-6xl"
      >
        <div className="grid gap-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}

          <AdminSummary overview={overview} loading={loading} />

          <div className="overflow-x-auto">
            <SegmentedControl
              value={tab}
              onChange={setTab}
              options={tabs}
              ariaLabel={t.admin.title}
              className="min-w-max"
            />
          </div>

          <div className="min-h-[420px]">
            {loading && !overview ? (
              <LoadingState />
            ) : overview ? (
              <>
                {tab === "security" && (
                  <SecurityPanel
                    sessions={sessions}
                    busyAction={busyAction}
                    onPasswordChange={(currentPassword, newPassword) =>
                      runMutation({
                        busy: "password",
                        success: t.admin.passwordChanged,
                        action: async () => {
                          await api("/api/admin/password", {
                            method: "PUT",
                            body: JSON.stringify({
                              currentPassword,
                              newPassword,
                            }),
                          });
                        },
                      })
                    }
                    onRevokeSession={(sessionId) =>
                      setConfirm({
                        title: t.admin.sessionLogoutTitle,
                        body: t.admin.sessionLogoutBody,
                        confirmLabel: t.admin.sessionLogoutConfirm,
                        action: () =>
                          runMutation({
                            busy: `session-${sessionId}`,
                            success: t.admin.sessionLoggedOut,
                            action: async () => {
                              await api(`/api/admin/sessions/${sessionId}`, {
                                method: "DELETE",
                              });
                            },
                          }),
                      })
                    }
                    onRevokeOthers={() =>
                      setConfirm({
                        title: t.admin.logoutOthersTitle,
                        body: t.admin.logoutOthersBody,
                        confirmLabel: t.admin.logoutOthersConfirm,
                        action: () =>
                          runMutation({
                            busy: "sessions-others",
                            success: t.admin.logoutOthersSuccess,
                            action: async () => {
                              await api("/api/admin/sessions/others", {
                                method: "DELETE",
                              });
                            },
                          }),
                      })
                    }
                  />
                )}
                {tab === "accounts" && (
                  <AccountsPanel
                    overview={overview}
                    busyAction={busyAction}
                    onCommand={(accountId, command) =>
                      runMutation({
                        busy: `${command}-${accountId}`,
                        success: t.admin.accountActionSuccess,
                        refreshApp: true,
                        action: async () => {
                          await api(`/api/accounts/${accountId}/${command}`, {
                            method: "POST",
                          });
                        },
                      })
                    }
                    onForget={(account) =>
                      setConfirm({
                        title: t.admin.forgetAccountTitle,
                        body: interpolate(t.admin.forgetAccountBody, {
                          accountName: account.accountName,
                        }),
                        confirmLabel: t.admin.forgetAccountConfirm,
                        action: () =>
                          runMutation({
                            busy: `forget-${account.id}`,
                            success: t.admin.forgetAccountSuccess,
                            refreshApp: true,
                            action: async () => {
                              await api(`/api/accounts/${account.id}`, {
                                method: "DELETE",
                              });
                            },
                          }),
                      })
                    }
                  />
                )}
                {tab === "logs" && (
                  <LogsPanel
                    overview={overview}
                    busyAction={busyAction}
                    onDeleteEvent={(event) =>
                      setConfirm({
                        title: t.admin.deleteLogTitle,
                        body: interpolate(t.admin.deleteLogBody, {
                          message: event.message,
                        }),
                        confirmLabel: t.admin.deleteLogConfirm,
                        action: () =>
                          runMutation({
                            busy: `event-${event.id}`,
                            success: t.admin.deleteLogSuccess,
                            refreshApp: true,
                            action: async () => {
                              await api(`/api/admin/events/${event.id}`, {
                                method: "DELETE",
                              });
                            },
                          }),
                      })
                    }
                    onCleanup={(query, label) =>
                      setConfirm({
                        title: t.admin.cleanupLogsTitle,
                        body: label,
                        confirmLabel: t.admin.cleanupLogsConfirm,
                        action: () =>
                          runMutation({
                            busy: "events-cleanup",
                            success: t.admin.cleanupLogsSuccess,
                            refreshApp: true,
                            action: async () => {
                              await api(`/api/admin/events?${query}`, {
                                method: "DELETE",
                              });
                            },
                          }),
                      })
                    }
                  />
                )}
                {tab === "automation" && (
                  <AutomationPanel
                    overview={overview}
                    busyAction={busyAction}
                    onToggleSchedule={(schedule) =>
                      runMutation({
                        busy: `schedule-toggle-${schedule.id}`,
                        success: schedule.enabled
                          ? t.admin.scheduleDisabled
                          : t.admin.scheduleEnabled,
                        refreshApp: true,
                        action: async () => {
                          await api(
                            `/api/accounts/${schedule.accountId}/schedules/${schedule.id}`,
                            {
                              method: "PUT",
                              body: JSON.stringify({
                                enabled: !schedule.enabled,
                              }),
                            },
                          );
                        },
                      })
                    }
                    onDeleteSchedule={(schedule) =>
                      setConfirm({
                        title: t.admin.deleteScheduleTitle,
                        body: interpolate(t.admin.deleteScheduleBody, {
                          name: schedule.name,
                        }),
                        confirmLabel: t.admin.deleteScheduleConfirm,
                        action: () =>
                          runMutation({
                            busy: `schedule-delete-${schedule.id}`,
                            success: t.admin.deleteScheduleSuccess,
                            refreshApp: true,
                            action: async () => {
                              await api(
                                `/api/accounts/${schedule.accountId}/schedules/${schedule.id}`,
                                { method: "DELETE" },
                              );
                            },
                          }),
                      })
                    }
                    onDeletePreset={(preset) =>
                      setConfirm({
                        title: t.admin.deletePresetTitle,
                        body: interpolate(t.admin.deletePresetBody, {
                          name: preset.name,
                        }),
                        confirmLabel: t.admin.deletePresetConfirm,
                        action: () =>
                          runMutation({
                            busy: `preset-delete-${preset.id}`,
                            success: t.admin.deletePresetSuccess,
                            refreshApp: true,
                            action: async () => {
                              await api(
                                `/api/accounts/${preset.accountId}/presets/${preset.id}`,
                                { method: "DELETE" },
                              );
                            },
                          }),
                      })
                    }
                  />
                )}
                {tab === "data" && (
                  <DataPanel
                    overview={overview}
                    busyAction={busyAction}
                    onClearLibrary={(account) =>
                      setConfirm({
                        title: t.admin.clearLibraryTitle,
                        body: interpolate(t.admin.clearLibraryBody, {
                          accountName: account.accountName,
                        }),
                        confirmLabel: t.admin.clearLibraryConfirm,
                        action: () =>
                          runMutation({
                            busy: `library-${account.id}`,
                            success: t.admin.clearLibrarySuccess,
                            refreshApp: true,
                            action: async () => {
                              await api(
                                `/api/admin/accounts/${account.id}/library`,
                                { method: "DELETE" },
                              );
                            },
                          }),
                      })
                    }
                    onDeleteApp={(app) =>
                      setConfirm({
                        title: t.admin.deleteAppTitle,
                        body: interpolate(t.admin.deleteAppBody, {
                          appName: app.name,
                        }),
                        confirmLabel: t.admin.deleteAppConfirm,
                        action: () =>
                          runMutation({
                            busy: `app-${app.appId}`,
                            success: t.admin.deleteAppSuccess,
                            refreshApp: true,
                            action: async () => {
                              await api(`/api/admin/app-cache/${app.appId}`, {
                                method: "DELETE",
                              });
                            },
                          }),
                      })
                    }
                    onClearUnusedApps={() =>
                      setConfirm({
                        title: t.admin.cleanupAppsTitle,
                        body: t.admin.cleanupAppsBody,
                        confirmLabel: t.admin.cleanupAppsConfirm,
                        action: () =>
                          runMutation({
                            busy: "apps-unused",
                            success: t.admin.cleanupAppsSuccess,
                            refreshApp: true,
                            action: async () => {
                              await api("/api/admin/app-cache?unused=true", {
                                method: "DELETE",
                              });
                            },
                          }),
                      })
                    }
                  />
                )}
              </>
            ) : (
              <EmptyState title={t.admin.loadFailedTitle}>
                {t.admin.loadFailedBody}
              </EmptyState>
            )}
          </div>
        </div>
      </Dialog>

      {confirm ? (
        <ConfirmDialog
          state={confirm}
          busy={Boolean(busyAction)}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.action();
            setConfirm(null);
          }}
        />
      ) : null}
    </>
  );
}

function AdminSummary({
  overview,
  loading,
}: {
  overview: AdminOverview | null;
  loading: boolean;
}) {
  const { messages: t } = useI18n();

  if (loading && !overview) {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-md border border-[var(--line)] bg-[var(--surface-2)]"
          />
        ))}
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <SummaryTile
        label={t.admin.summary.accounts}
        value={overview.totals.accounts}
        detail={interpolate(t.admin.summary.activeGames, {
          count: overview.totals.selectedGames,
        })}
        icon={<ShieldCheck size={16} />}
      />
      <SummaryTile
        label={t.admin.summary.sessions}
        value={overview.totals.sessions}
        detail={t.admin.summary.adminAccess}
        icon={<KeyRound size={16} />}
      />
      <SummaryTile
        label={t.admin.summary.logs}
        value={overview.totals.events}
        detail={t.admin.summary.localEvents}
        icon={<RefreshCw size={16} />}
      />
      <SummaryTile
        label={t.admin.summary.appData}
        value={overview.totals.appCache}
        detail={interpolate(t.admin.summary.libraryEntries, {
          count: overview.totals.libraryEntries,
        })}
        icon={<Database size={16} />}
      />
    </div>
  );
}

function SecurityPanel({
  sessions,
  busyAction,
  onPasswordChange,
  onRevokeSession,
  onRevokeOthers,
}: {
  sessions: AdminSession[];
  busyAction: string | null;
  onPasswordChange: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  onRevokeSession: (sessionId: string) => void;
  onRevokeOthers: () => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (newPassword.length < 12) {
      setFormError(t.admin.security.minPassword);
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError(t.admin.security.mismatch);
      return;
    }
    await onPasswordChange(currentPassword, newPassword);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <Section
        title={t.admin.security.passwordTitle}
        description={t.admin.security.passwordDescription}
      >
        <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Label>
            {t.admin.security.currentPassword}
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Label>
          <Label>
            {t.admin.security.newPassword}
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Label>
          <Label>
            {t.admin.security.repeatPassword}
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Label>
          <Button
            type="submit"
            variant="primary"
            disabled={busyAction === "password"}
          >
            {busyAction === "password"
              ? t.common.saving
              : t.admin.security.changePassword}
          </Button>
        </form>
      </Section>

      <Section
        title={t.admin.security.sessionsTitle}
        description={t.admin.security.sessionsDescription}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={onRevokeOthers}
            disabled={
              sessions.filter((session) => !session.current).length === 0 ||
              busyAction === "sessions-others"
            }
          >
            {t.admin.security.logoutOthers}
          </Button>
        }
      >
        <div className="grid max-h-[360px] gap-2 overflow-auto pr-1">
          {sessions.length === 0 ? (
            <EmptyState title={t.admin.security.noSessionsTitle}>
              {t.admin.security.noSessionsBody}
            </EmptyState>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm">
                      {session.current
                        ? t.admin.security.currentSession
                        : t.admin.security.adminSession}
                    </strong>
                    {session.current ? (
                      <span className="rounded-full bg-[var(--good-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--good)]">
                        {t.common.active}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {interpolate(t.admin.security.lastSeenValidUntil, {
                      lastSeen: formatDateTime(
                        session.lastSeenAt,
                        localeInfo.dateLocale,
                      ),
                      expires: formatDateTime(
                        session.expiresAt,
                        localeInfo.dateLocale,
                      ),
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={
                    session.current || busyAction === `session-${session.id}`
                  }
                  onClick={() => onRevokeSession(session.id)}
                >
                  {t.admin.security.logout}
                </Button>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function AccountsPanel({
  overview,
  busyAction,
  onCommand,
  onForget,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onCommand: (
    accountId: string,
    command: "start" | "pause" | "resume" | "stop",
  ) => void;
  onForget: (account: AdminOverview["accounts"][number]) => void;
}) {
  const { messages: t } = useI18n();

  return (
    <Section
      title={t.admin.accountsPanel.title}
      description={t.admin.accountsPanel.description}
    >
      <div className="grid gap-2">
        {overview.accounts.length === 0 ? (
          <EmptyState title={t.admin.accountsPanel.emptyTitle}>
            {t.admin.accountsPanel.emptyBody}
          </EmptyState>
        ) : (
          overview.accounts.map((account) => {
            const sessionAction = adminSessionAction(account.runtimeStatus, t);
            const SessionIcon = sessionAction.icon;

            return (
              <div
                key={account.id}
                className="grid gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 xl:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm">
                      {account.accountName}
                    </strong>
                    <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-strong)]">
                      {statusLabel(account.runtimeStatus, t)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">
                    {account.steamId ?? t.admin.accountsPanel.noSteamId}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--muted)] md:grid-cols-5">
                    <MiniMetric
                      label={t.admin.accountsPanel.games}
                      value={account.selectedGameCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.library}
                      value={account.libraryAppCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.presets}
                      value={account.presetCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.schedules}
                      value={account.scheduleCount}
                    />
                    <MiniMetric
                      label={t.admin.accountsPanel.logs}
                      value={account.eventCount}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 xl:w-[300px]">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCommand(account.id, sessionAction.command)}
                    disabled={
                      busyAction === `${sessionAction.command}-${account.id}`
                    }
                  >
                    <SessionIcon size={14} />
                    {sessionAction.label}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCommand(account.id, "stop")}
                    disabled={busyAction === `stop-${account.id}`}
                  >
                    <Square size={14} />
                    {t.common.stop}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onForget(account)}
                    disabled={busyAction === `forget-${account.id}`}
                  >
                    <Trash2 size={14} />
                    {t.common.remove}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Section>
  );
}

function adminSessionAction(status: string, messages: Messages) {
  if (status === "paused_manual" || status === "paused_other_session") {
    return {
      command: "resume" as const,
      label: messages.common.resume,
      icon: Play,
    };
  }

  if (
    status === "disconnected" ||
    status === "error" ||
    status === "login_required"
  ) {
    return {
      command: "start" as const,
      label: messages.common.start,
      icon: Power,
    };
  }

  return {
    command: "pause" as const,
    label: messages.common.pause,
    icon: Pause,
  };
}

function logLevelLabel(level: string, t: Messages) {
  if (level === "info") return t.admin.logsPanel.info;
  if (level === "warn") return t.admin.logsPanel.warning;
  if (level === "error") return t.admin.logsPanel.error;
  return level;
}

function LogsPanel({
  overview,
  busyAction,
  onDeleteEvent,
  onCleanup,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onDeleteEvent: (event: SteamEvent) => void;
  onCleanup: (query: string, label: string) => void;
}) {
  const { messages: t, localeInfo } = useI18n();
  const [level, setLevel] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const filteredEvents = useMemo(
    () =>
      overview.events.filter((event) => {
        const levelMatches = level === "all" || event.level === level;
        const accountMatches =
          accountId === "all" || (event.accountId ?? "system") === accountId;
        return levelMatches && accountMatches;
      }),
    [accountId, level, overview.events],
  );
  const olderThan = Date.now() - 7 * 24 * 60 * 60_000;
  const selectedLevelLabel = logLevelLabel(level, t);

  return (
    <Section
      title={t.admin.logsPanel.title}
      description={t.admin.logsPanel.description}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onCleanup(`olderThan=${olderThan}`, t.admin.cleanupOldLogsBody)
            }
            disabled={busyAction === "events-cleanup"}
          >
            {t.admin.logsPanel.deleteOld}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              onCleanup(
                `level=${level}`,
                interpolate(t.admin.cleanupLevelLogsBody, {
                  level: selectedLevelLabel,
                }),
              )
            }
            disabled={level === "all" || busyAction === "events-cleanup"}
          >
            {t.admin.logsPanel.deleteLevel}
          </Button>
        </div>
      }
    >
      <div className="mb-3 grid gap-2 md:grid-cols-2">
        <Label>
          {t.admin.logsPanel.level}
          <Select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            <option value="all">{t.admin.logsPanel.allLevels}</option>
            <option value="info">{t.admin.logsPanel.info}</option>
            <option value="warn">{t.admin.logsPanel.warning}</option>
            <option value="error">{t.admin.logsPanel.error}</option>
          </Select>
        </Label>
        <Label>
          {t.admin.logsPanel.account}
          <Select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="all">{t.admin.logsPanel.allAccounts}</option>
            <option value="system">{t.admin.logsPanel.system}</option>
            {overview.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.accountName}
              </option>
            ))}
          </Select>
        </Label>
      </div>

      <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
        {filteredEvents.length === 0 ? (
          <EmptyState title={t.admin.logsPanel.emptyTitle}>
            {t.admin.logsPanel.emptyBody}
          </EmptyState>
        ) : (
          filteredEvents.map((event) => {
            const display = eventDisplay(event, t);
            return (
              <div
                key={event.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-[92px_minmax(0,1fr)_auto]"
              >
                <time className="text-xs text-[var(--muted)]">
                  {formatEventTime(event.createdAt, localeInfo)}
                </time>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        event.level === "error" &&
                          "bg-[var(--danger-soft)] text-[var(--danger)]",
                        event.level === "warn" &&
                          "bg-[var(--warn-soft)] text-[var(--warn)]",
                        event.level === "info" &&
                          "bg-[var(--info-soft)] text-[var(--info)]",
                      )}
                    >
                      {logLevelLabel(event.level, t)}
                    </span>
                    <strong className="truncate text-sm">
                      {display.title}
                    </strong>
                  </div>
                  {display.body ? (
                    <p className="mt-1 text-sm text-[var(--muted-strong)]">
                      {display.body}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.admin.logsPanel.deleteLog}
                  title={t.admin.logsPanel.deleteLog}
                  onClick={() => onDeleteEvent(event)}
                  disabled={busyAction === `event-${event.id}`}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </Section>
  );
}

function AutomationPanel({
  overview,
  busyAction,
  onToggleSchedule,
  onDeleteSchedule,
  onDeletePreset,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onToggleSchedule: (schedule: AdminOverview["schedules"][number]) => void;
  onDeleteSchedule: (schedule: AdminOverview["schedules"][number]) => void;
  onDeletePreset: (preset: AdminOverview["presets"][number]) => void;
}) {
  const { messages: t, localeInfo } = useI18n();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title={t.tools.presets}
        description={t.admin.automation.presetsDescription}
      >
        <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
          {overview.presets.length === 0 ? (
            <EmptyState title={t.admin.automation.noPresetsTitle}>
              {t.admin.automation.noPresetsBody}
            </EmptyState>
          ) : (
            overview.presets.map((preset) => (
              <div
                key={preset.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {preset.name}
                  </strong>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {preset.accountName ?? t.common.unknownAccount} ·{" "}
                    {preset.appCount} {t.common.games} ·{" "}
                    {t.admin.automation.updated}{" "}
                    {formatDateTime(preset.updatedAt, localeInfo.dateLocale)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onDeletePreset(preset)}
                  disabled={busyAction === `preset-delete-${preset.id}`}
                >
                  <Trash2 size={14} />
                  {t.common.delete}
                </Button>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section
        title={t.tools.schedules}
        description={t.admin.automation.schedulesDescription}
      >
        <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
          {overview.schedules.length === 0 ? (
            <EmptyState title={t.admin.automation.noSchedulesTitle}>
              {t.admin.automation.noSchedulesBody}
            </EmptyState>
          ) : (
            overview.schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm">
                      {schedule.name}
                    </strong>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        schedule.enabled
                          ? "bg-[var(--good-soft)] text-[var(--good)]"
                          : "bg-[var(--surface)] text-[var(--muted)]",
                      )}
                    >
                      {schedule.enabled ? t.common.active : t.common.off}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {schedule.accountName ?? t.common.unknownAccount} ·{" "}
                    {schedule.presetName ?? t.tools.preset} ·{" "}
                    {schedule.startTime}-{schedule.endTime} ·{" "}
                    {formatWeekdays(schedule.weekdays, localeInfo.dateLocale)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleSchedule(schedule)}
                    disabled={busyAction === `schedule-toggle-${schedule.id}`}
                  >
                    <CalendarClock size={14} />
                    {schedule.enabled ? t.tools.disable : t.tools.enable}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onDeleteSchedule(schedule)}
                    disabled={busyAction === `schedule-delete-${schedule.id}`}
                  >
                    <Trash2 size={14} />
                    {t.common.delete}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function DataPanel({
  overview,
  busyAction,
  onClearLibrary,
  onDeleteApp,
  onClearUnusedApps,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onClearLibrary: (account: AdminOverview["accounts"][number]) => void;
  onDeleteApp: (app: AdminOverview["apps"][number]) => void;
  onClearUnusedApps: () => void;
}) {
  const { messages: t } = useI18n();

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Section
        title={t.admin.data.librariesTitle}
        description={t.admin.data.librariesDescription}
      >
        <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
          {overview.accounts.length === 0 ? (
            <EmptyState title={t.admin.accountsPanel.emptyTitle}>
              {t.admin.data.noAccountsBody}
            </EmptyState>
          ) : (
            overview.accounts.map((account) => (
              <div
                key={account.id}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {account.accountName}
                  </strong>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {interpolate(t.admin.data.importedSelected, {
                      imported: account.libraryAppCount,
                      selected: account.selectedGameCount,
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={
                    account.libraryAppCount === 0 ||
                    busyAction === `library-${account.id}`
                  }
                  onClick={() => onClearLibrary(account)}
                >
                  {t.admin.data.clear}
                </Button>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section
        title={t.admin.data.appCacheTitle}
        description={t.admin.data.appCacheDescription}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={onClearUnusedApps}
            disabled={busyAction === "apps-unused"}
          >
            {t.admin.data.cleanupUnused}
          </Button>
        }
      >
        <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
          {overview.apps.length === 0 ? (
            <EmptyState title={t.admin.data.noAppDataTitle}>
              {t.admin.data.noAppDataBody}
            </EmptyState>
          ) : (
            overview.apps.map((app) => (
              <div
                key={app.appId}
                className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm">{app.name}</strong>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {interpolate(t.admin.data.appStats, {
                      appId: app.appId,
                      libraryCount: app.libraryAccountCount,
                      selectedCount: app.selectedAccountCount,
                      presetCount: app.presetCount,
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onDeleteApp(app)}
                  disabled={busyAction === `app-${app.appId}`}
                >
                  <Trash2 size={14} />
                  {t.common.delete}
                </Button>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function ConfirmDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { messages: t } = useI18n();

  return (
    <ConfirmationDialog
      title={state.title}
      description={state.body}
      confirmLabel={state.confirmLabel}
      cancelLabel={t.common.cancel}
      busyLabel={t.admin.deleting}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--muted)]">
        <span>{label}</span>
        <span className="text-[var(--muted-strong)]">{icon}</span>
      </div>
      <strong className="mt-1 block text-2xl leading-none">{value}</strong>
      <p className="mt-1 truncate text-xs text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md bg-[var(--surface)] px-2 py-1">
      <strong className="text-[var(--muted-strong)]">{value}</strong> {label}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-md border border-[var(--line)] bg-[var(--surface-2)]"
        />
      ))}
    </div>
  );
}

function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-4 text-sm text-[var(--muted)]">
      <strong className="block text-[var(--muted-strong)]">{title}</strong>
      <p className="mt-1 leading-5">{children}</p>
    </div>
  );
}

function formatDateTime(value: number, dateLocale: string) {
  return new Date(value).toLocaleString(dateLocale, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatWeekdays(days: number[], dateLocale: string) {
  const formatter = new Intl.DateTimeFormat(dateLocale, {
    weekday: "short",
  });
  const sunday = new Date(Date.UTC(2024, 0, 7));
  return days
    .map((day) => {
      const date = new Date(sunday);
      date.setUTCDate(sunday.getUTCDate() + day);
      return formatter.format(date).replace(/\.$/, "") || String(day);
    })
    .join(", ");
}
