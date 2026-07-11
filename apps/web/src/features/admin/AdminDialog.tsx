import { useEffect, useState } from "react";
import { Alert } from "../../components/ui/alert";
import { Dialog } from "../../components/ui/dialog";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { useI18n } from "../../i18n";
import { AccountsPanel } from "./AccountsPanel";
import {
  AdminSummary,
  ConfirmDialog,
  EmptyState,
  LoadingState,
} from "./AdminDialogUi";
import { AutomationPanel } from "./AutomationPanel";
import { DataPanel } from "./DataPanel";
import { LogsPanel } from "./LogsPanel";
import { SecurityPanel } from "./SecurityPanel";
import { useAdminActions } from "./useAdminActions";
import { useAdminData } from "./useAdminController";

type AdminTab = "security" | "accounts" | "logs" | "automation" | "data";

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
  const actions = useAdminActions({
    messages: t,
    loadAdmin,
    setError,
    onChanged,
  });
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

  return (
    <>
      <Dialog
        title={t.admin.title}
        description={t.admin.description}
        onClose={onClose}
        className="max-w-6xl"
      >
        <div className="grid gap-4">
          {error && !actions.confirm ? (
            <Alert tone="danger">{error}</Alert>
          ) : null}
          {actions.notice ? (
            <Alert tone="success">{actions.notice}</Alert>
          ) : null}

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
                    busyAction={actions.busyAction}
                    onPasswordChange={actions.changePassword}
                    onRevokeSession={actions.revokeSession}
                    onRevokeOthers={actions.revokeOtherSessions}
                  />
                )}
                {tab === "accounts" && (
                  <AccountsPanel
                    overview={overview}
                    busyAction={actions.busyAction}
                    onCommand={actions.commandAccount}
                    onForget={actions.forgetAccount}
                  />
                )}
                {tab === "logs" && (
                  <LogsPanel
                    overview={overview}
                    busyAction={actions.busyAction}
                    onDeleteEvent={actions.deleteEvent}
                    onCleanup={actions.cleanupEvents}
                  />
                )}
                {tab === "automation" && (
                  <AutomationPanel
                    overview={overview}
                    busyAction={actions.busyAction}
                    onToggleSchedule={actions.toggleSchedule}
                    onDeleteSchedule={actions.deleteSchedule}
                    onDeletePreset={actions.deletePreset}
                  />
                )}
                {tab === "data" && (
                  <DataPanel
                    overview={overview}
                    busyAction={actions.busyAction}
                    onClearLibrary={actions.clearLibrary}
                    onDeleteApp={actions.deleteApp}
                    onClearUnusedApps={actions.clearUnusedApps}
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

      {actions.confirm ? (
        <ConfirmDialog
          state={actions.confirm}
          busy={Boolean(actions.busyAction)}
          error={error}
          onCancel={actions.cancelConfirm}
          onConfirm={actions.confirmAction}
        />
      ) : null}
    </>
  );
}
