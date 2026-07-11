import { Trash2 } from "lucide-react";
import type { AdminOverview } from "../../api";
import { Button } from "../../components/ui/button";
import { interpolate, useI18n } from "../../i18n";
import { EmptyState, Section } from "./AdminDialogUi";
import type { AdminAccount, AdminApp } from "./types";

export function DataPanel({
  overview,
  busyAction,
  onClearLibrary,
  onDeleteApp,
  onClearUnusedApps,
}: {
  overview: AdminOverview;
  busyAction: string | null;
  onClearLibrary: (account: AdminAccount) => void;
  onDeleteApp: (app: AdminApp) => void;
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
