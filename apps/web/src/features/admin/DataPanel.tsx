import { useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import type { AdminOverview } from "../../api";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/form";
import { interpolate, useI18n } from "../../i18n";
import { EmptyState, Section } from "./AdminDialogUi";
import type { AdminAccount, AdminApp } from "./types";

const appCachePageSize = 25;

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
  const [appQuery, setAppQuery] = useState("");
  const [appPage, setAppPage] = useState(0);
  const filteredApps = useMemo(() => {
    const query = appQuery.trim().toLocaleLowerCase();
    if (!query) return overview.apps;
    return overview.apps.filter(
      (app) =>
        app.name.toLocaleLowerCase().includes(query) ||
        String(app.appId).includes(query),
    );
  }, [appQuery, overview.apps]);
  const appPageCount = Math.max(
    1,
    Math.ceil(filteredApps.length / appCachePageSize),
  );
  const currentAppPage = Math.min(appPage, appPageCount - 1);
  useEffect(() => {
    setAppPage((page) => Math.min(page, appPageCount - 1));
  }, [appPageCount]);
  const visibleApps = filteredApps.slice(
    currentAppPage * appCachePageSize,
    (currentAppPage + 1) * appCachePageSize,
  );
  const firstVisibleApp =
    filteredApps.length === 0 ? 0 : currentAppPage * appCachePageSize + 1;
  const lastVisibleApp = Math.min(
    filteredApps.length,
    (currentAppPage + 1) * appCachePageSize,
  );

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
        <div className="grid gap-3">
          <Label>
            {t.admin.data.appCacheSearch}
            <span className="relative block">
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
              />
              <Input
                type="search"
                value={appQuery}
                onChange={(event) => {
                  setAppQuery(event.target.value);
                  setAppPage(0);
                }}
                placeholder={t.admin.data.appCacheSearchPlaceholder}
                className="pl-9"
              />
            </span>
          </Label>
          <p className="text-xs text-[var(--muted)]">
            {interpolate(t.admin.data.appCacheLoadedStatus, {
              loaded: overview.apps.length,
              total: overview.totals.appCache,
            })}
          </p>
          <div className="grid max-h-[430px] gap-2 overflow-auto pr-1">
            {overview.apps.length === 0 ? (
              <EmptyState title={t.admin.data.noAppDataTitle}>
                {t.admin.data.noAppDataBody}
              </EmptyState>
            ) : filteredApps.length === 0 ? (
              <EmptyState title={t.admin.data.appCacheNoResultsTitle}>
                {t.admin.data.appCacheNoResultsBody}
              </EmptyState>
            ) : (
              visibleApps.map((app) => (
                <div
                  key={app.appId}
                  className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">
                      {app.name}
                    </strong>
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
                    aria-label={`${t.common.delete}: ${app.name}`}
                  >
                    <Trash2 size={14} />
                    {t.common.delete}
                  </Button>
                </div>
              ))
            )}
          </div>
          {filteredApps.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span role="status" className="text-xs text-[var(--muted)]">
                {interpolate(t.admin.data.appCachePageStatus, {
                  from: firstVisibleApp,
                  to: lastVisibleApp,
                  total: filteredApps.length,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentAppPage === 0}
                  onClick={() => setAppPage(Math.max(0, currentAppPage - 1))}
                >
                  {t.admin.data.previousPage}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentAppPage >= appPageCount - 1}
                  onClick={() =>
                    setAppPage(Math.min(appPageCount - 1, currentAppPage + 1))
                  }
                >
                  {t.admin.data.nextPage}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
