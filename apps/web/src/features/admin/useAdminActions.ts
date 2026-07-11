import { useState } from "react";
import type { AccountCommand } from "@steam-bee/contracts";
import { api, apiErrorMessage, type SteamEvent } from "../../api";
import { interpolate, type Messages } from "../../i18n";
import type {
  AdminAccount,
  AdminApp,
  AdminPreset,
  AdminSchedule,
  ConfirmState,
} from "./types";

type Mutation = {
  busy: string;
  success: string;
  refreshApp?: boolean;
  action: () => Promise<void>;
};

type ConfirmationCopy = Pick<ConfirmState, "title" | "body" | "confirmLabel">;

export function useAdminActions({
  messages,
  loadAdmin,
  setError,
  onChanged,
}: {
  messages: Messages;
  loadAdmin: () => Promise<void>;
  setError: (error: string | null) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  async function runMutation({
    busy,
    success,
    refreshApp = false,
    action,
  }: Mutation) {
    setBusyAction(busy);
    setError(null);
    setNotice(null);
    try {
      await action();
      await loadAdmin();
      if (refreshApp) await onChanged();
      setNotice(success);
      return true;
    } catch (mutationError) {
      setError(apiErrorMessage(mutationError, messages));
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  function requestConfirmation(copy: ConfirmationCopy, mutation: Mutation) {
    setError(null);
    setNotice(null);
    setConfirm({
      ...copy,
      action: () => runMutation(mutation),
    });
  }

  async function confirmAction() {
    if (!confirm) return;
    if (await confirm.action()) setConfirm(null);
  }

  return {
    busyAction,
    notice,
    confirm,
    cancelConfirm: () => setConfirm(null),
    confirmAction,

    changePassword: (currentPassword: string, newPassword: string) =>
      runMutation({
        busy: "password",
        success: messages.admin.passwordChanged,
        action: async () => {
          await api("/api/admin/password", {
            method: "PUT",
            body: JSON.stringify({ currentPassword, newPassword }),
          });
        },
      }),

    revokeSession: (sessionId: string) =>
      requestConfirmation(
        {
          title: messages.admin.sessionLogoutTitle,
          body: messages.admin.sessionLogoutBody,
          confirmLabel: messages.admin.sessionLogoutConfirm,
        },
        {
          busy: `session-${sessionId}`,
          success: messages.admin.sessionLoggedOut,
          action: async () => {
            await api(`/api/admin/sessions/${sessionId}`, {
              method: "DELETE",
            });
          },
        },
      ),

    revokeOtherSessions: () =>
      requestConfirmation(
        {
          title: messages.admin.logoutOthersTitle,
          body: messages.admin.logoutOthersBody,
          confirmLabel: messages.admin.logoutOthersConfirm,
        },
        {
          busy: "sessions-others",
          success: messages.admin.logoutOthersSuccess,
          action: async () => {
            await api("/api/admin/sessions/others", { method: "DELETE" });
          },
        },
      ),

    commandAccount: (accountId: string, command: AccountCommand) =>
      runMutation({
        busy: `${command}-${accountId}`,
        success: messages.admin.accountActionSuccess,
        refreshApp: true,
        action: async () => {
          await api(`/api/accounts/${accountId}/${command}`, {
            method: "POST",
          });
        },
      }),

    forgetAccount: (account: AdminAccount) =>
      requestConfirmation(
        {
          title: messages.admin.forgetAccountTitle,
          body: interpolate(messages.admin.forgetAccountBody, {
            accountName: account.accountName,
          }),
          confirmLabel: messages.admin.forgetAccountConfirm,
        },
        {
          busy: `forget-${account.id}`,
          success: messages.admin.forgetAccountSuccess,
          refreshApp: true,
          action: async () => {
            await api(`/api/accounts/${account.id}`, { method: "DELETE" });
          },
        },
      ),

    deleteEvent: (event: SteamEvent) =>
      requestConfirmation(
        {
          title: messages.admin.deleteLogTitle,
          body: interpolate(messages.admin.deleteLogBody, {
            message: event.message,
          }),
          confirmLabel: messages.admin.deleteLogConfirm,
        },
        {
          busy: `event-${event.id}`,
          success: messages.admin.deleteLogSuccess,
          refreshApp: true,
          action: async () => {
            await api(`/api/admin/events/${event.id}`, { method: "DELETE" });
          },
        },
      ),

    cleanupEvents: (query: string, label: string) =>
      requestConfirmation(
        {
          title: messages.admin.cleanupLogsTitle,
          body: label,
          confirmLabel: messages.admin.cleanupLogsConfirm,
        },
        {
          busy: "events-cleanup",
          success: messages.admin.cleanupLogsSuccess,
          refreshApp: true,
          action: async () => {
            await api(`/api/admin/events?${query}`, { method: "DELETE" });
          },
        },
      ),

    toggleSchedule: (schedule: AdminSchedule) =>
      runMutation({
        busy: `schedule-toggle-${schedule.id}`,
        success: schedule.enabled
          ? messages.admin.scheduleDisabled
          : messages.admin.scheduleEnabled,
        refreshApp: true,
        action: async () => {
          await api(
            `/api/accounts/${schedule.accountId}/schedules/${schedule.id}`,
            {
              method: "PUT",
              body: JSON.stringify({ enabled: !schedule.enabled }),
            },
          );
        },
      }),

    deleteSchedule: (schedule: AdminSchedule) =>
      requestConfirmation(
        {
          title: messages.admin.deleteScheduleTitle,
          body: interpolate(messages.admin.deleteScheduleBody, {
            name: schedule.name,
          }),
          confirmLabel: messages.admin.deleteScheduleConfirm,
        },
        {
          busy: `schedule-delete-${schedule.id}`,
          success: messages.admin.deleteScheduleSuccess,
          refreshApp: true,
          action: async () => {
            await api(
              `/api/accounts/${schedule.accountId}/schedules/${schedule.id}`,
              { method: "DELETE" },
            );
          },
        },
      ),

    deletePreset: (preset: AdminPreset) =>
      requestConfirmation(
        {
          title: messages.admin.deletePresetTitle,
          body: interpolate(messages.admin.deletePresetBody, {
            name: preset.name,
          }),
          confirmLabel: messages.admin.deletePresetConfirm,
        },
        {
          busy: `preset-delete-${preset.id}`,
          success: messages.admin.deletePresetSuccess,
          refreshApp: true,
          action: async () => {
            await api(
              `/api/accounts/${preset.accountId}/presets/${preset.id}`,
              { method: "DELETE" },
            );
          },
        },
      ),

    clearLibrary: (account: AdminAccount) =>
      requestConfirmation(
        {
          title: messages.admin.clearLibraryTitle,
          body: interpolate(messages.admin.clearLibraryBody, {
            accountName: account.accountName,
          }),
          confirmLabel: messages.admin.clearLibraryConfirm,
        },
        {
          busy: `library-${account.id}`,
          success: messages.admin.clearLibrarySuccess,
          refreshApp: true,
          action: async () => {
            await api(`/api/admin/accounts/${account.id}/library`, {
              method: "DELETE",
            });
          },
        },
      ),

    deleteApp: (app: AdminApp) =>
      requestConfirmation(
        {
          title: messages.admin.deleteAppTitle,
          body: interpolate(messages.admin.deleteAppBody, {
            appName: app.name,
          }),
          confirmLabel: messages.admin.deleteAppConfirm,
        },
        {
          busy: `app-${app.appId}`,
          success: messages.admin.deleteAppSuccess,
          refreshApp: true,
          action: async () => {
            await api(`/api/admin/app-cache/${app.appId}`, {
              method: "DELETE",
            });
          },
        },
      ),

    clearUnusedApps: () =>
      requestConfirmation(
        {
          title: messages.admin.cleanupAppsTitle,
          body: messages.admin.cleanupAppsBody,
          confirmLabel: messages.admin.cleanupAppsConfirm,
        },
        {
          busy: "apps-unused",
          success: messages.admin.cleanupAppsSuccess,
          refreshApp: true,
          action: async () => {
            await api("/api/admin/app-cache?unused=true", {
              method: "DELETE",
            });
          },
        },
      ),
  };
}
