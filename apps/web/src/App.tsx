import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { Toaster } from "sonner";
import {
  api,
  apiErrorMessage,
  authExpiredEvent,
  isAbortError,
  type Account,
  type Diagnostics,
  type Me,
  type NotificationRule,
  type SteamEvent,
  type SystemStatus,
  setCsrfToken,
} from "./api";
import { Alert } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Select } from "./components/ui/form";
import { useTheme } from "./hooks/useTheme";
import { useI18n } from "./i18n";
import { AccountDetail } from "./features/accounts/AccountDetail";
import { AccountRail } from "./features/accounts/AccountRail";
import { AppShell } from "./features/accounts/AppShell";
import { EmptyWorkspace } from "./features/accounts/EmptyWorkspace";
import { AuthPanel } from "./features/auth/AuthPanel";
import { statusLabel } from "./lib/status";

const AddAccountModal = lazy(() =>
  import("./features/accounts/AddAccountModal").then((module) => ({
    default: module.AddAccountModal,
  })),
);
const AdminDialog = lazy(() =>
  import("./features/admin/AdminDialog").then((module) => ({
    default: module.AdminDialog,
  })),
);

export function App() {
  const { messages: t } = useI18n();
  const o = t.operations;
  const { theme, setTheme } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<SteamEvent[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [notificationRules, setNotificationRules] = useState<
    NotificationRule[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const loadGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const messagesRef = useRef(t);
  const notificationRulesRef = useRef(notificationRules);
  messagesRef.current = t;
  notificationRulesRef.current = notificationRules;

  const handleLoadError = useCallback((loadError: unknown) => {
    if (isAbortError(loadError)) return;
    setError(apiErrorMessage(loadError, messagesRef.current));
  }, []);

  const selected = useMemo(
    () =>
      accounts.find((account) => account.id === selectedId) ??
      accounts[0] ??
      null,
    [accounts, selectedId],
  );

  const load = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const request = { signal: controller.signal } satisfies RequestInit;

    const nextMe = await api<Me>("/api/me", request);
    if (generation !== loadGeneration.current) return;
    setError(null);
    setConnectionError(null);
    setMe(nextMe);
    setCsrfToken(nextMe.csrfToken);

    if (!nextMe.authenticated) {
      setAccounts([]);
      setEvents([]);
      setDiagnostics(null);
      setSystemStatus(null);
      setNotificationRules([]);
      setSelectedId(null);
      return;
    }

    const [nextAccounts, nextEvents, nextDiagnostics, nextSystemStatus] =
      await Promise.all([
        api<Account[]>("/api/accounts", request),
        api<SteamEvent[]>("/api/events/recent", request),
        api<Diagnostics>("/api/diagnostics", request),
        api<SystemStatus>("/api/system/status", request),
      ]);
    const [nextNotificationRules] = await Promise.allSettled([
      api<NotificationRule[]>("/api/notifications/rules", request),
    ]);
    if (generation !== loadGeneration.current) return;
    setAccounts(nextAccounts);
    setEvents(nextEvents);
    setDiagnostics(nextDiagnostics);
    setSystemStatus(nextSystemStatus);
    setNotificationRules(
      nextNotificationRules?.status === "fulfilled"
        ? nextNotificationRules.value
        : [],
    );
    setSelectedId((current) =>
      current && nextAccounts.some((account) => account.id === current)
        ? current
        : (nextAccounts[0]?.id ?? null),
    );
  }, []);

  useEffect(() => {
    void load().catch(handleLoadError);
    return () => loadController.current?.abort();
  }, [handleLoadError, load]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setCsrfToken(null);
      void load().catch(handleLoadError);
    };
    window.addEventListener(authExpiredEvent, handleAuthExpired);
    return () =>
      window.removeEventListener(authExpiredEvent, handleAuthExpired);
  }, [handleLoadError, load]);

  useEffect(() => {
    if (!me?.authenticated) return;
    const source = new EventSource("/api/events", { withCredentials: true });
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void Promise.all([
          api<Account[]>("/api/accounts").then(setAccounts),
          api<SystemStatus>("/api/system/status").then(setSystemStatus),
        ])
          .then(() => setConnectionError(null))
          .catch((refreshError) => {
            if (isAbortError(refreshError)) return;
            setConnectionError(
              apiErrorMessage(refreshError, messagesRef.current),
            );
          });
      }, 150);
    };
    source.addEventListener("event", (message) => {
      let event: SteamEvent;
      try {
        event = JSON.parse((message as MessageEvent).data) as SteamEvent;
      } catch {
        setError(t.errors.INVALID_RESPONSE);
        return;
      }
      setEvents((current) => [event, ...current].slice(0, 100));
      scheduleRefresh();
      const status = event.metadata.status;
      const eventKeys = [
        event.type,
        ...(typeof status === "string" ? [`${event.type}.${status}`] : []),
      ];
      const browserRule = notificationRulesRef.current.some(
        (rule) =>
          rule.enabled &&
          rule.target === "browser" &&
          (rule.eventTypes.includes("*") ||
            eventKeys.some((eventKey) => rule.eventTypes.includes(eventKey))),
      );
      try {
        if (
          browserRule &&
          "Notification" in window &&
          window.Notification.permission === "granted"
        ) {
          new window.Notification("SteamBee", {
            body: event.message,
            tag: `steam-bee-${event.type}`,
          });
        }
      } catch {
        // Notification support can fail independently from a valid SSE event.
      }
    });
    source.addEventListener("status", scheduleRefresh);
    source.onerror = scheduleRefresh;
    return () => {
      source.close();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [me?.authenticated, t.errors.INVALID_RESPONSE]);

  async function logout() {
    await api("/api/logout", { method: "POST" });
    setCsrfToken(null);
    await load();
  }

  if (!me) {
    return (
      <AppShell theme={theme} onThemeChange={setTheme}>
        <main className="mx-auto grid min-h-[calc(100vh-4rem)] w-[min(520px,calc(100vw-2rem))] place-items-center">
          {error ? (
            <div className="grid w-full gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--panel-shadow)]">
              <div>
                <h1 className="text-lg font-semibold">
                  {t.admin.loadFailedTitle}
                </h1>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {t.admin.loadFailedBody}
                </p>
              </div>
              <Alert tone="danger">{error}</Alert>
              <Button
                variant="primary"
                onClick={() => {
                  setError(null);
                  void load().catch(handleLoadError);
                }}
              >
                {o.retry}
              </Button>
            </div>
          ) : (
            <div
              className="grid w-full gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--panel-shadow)]"
              role="status"
              aria-label={t.common.loading}
            >
              <div className="h-6 w-2/3 animate-pulse rounded-full bg-[var(--surface-3)]" />
              <div className="h-3 w-full animate-pulse rounded-full bg-[var(--surface-3)]" />
              <div className="h-3 w-1/2 animate-pulse rounded-full bg-[var(--surface-3)]" />
            </div>
          )}
        </main>
      </AppShell>
    );
  }

  if (!me.setupComplete) {
    return (
      <AppShell theme={theme} onThemeChange={setTheme} chrome="auth">
        <AuthPanel
          title={t.auth.setupTitle}
          description={t.auth.setupDescription}
          submitLabel={t.common.save}
          setupTokenRequired={me.setupTokenRequired}
          onSubmit={async (password, setupToken) => {
            const result = await api<{ csrfToken: string }>("/api/setup", {
              method: "POST",
              body: JSON.stringify({ password, setupToken }),
            });
            setCsrfToken(result.csrfToken);
            await load();
          }}
        />
      </AppShell>
    );
  }

  if (!me.authenticated) {
    return (
      <AppShell theme={theme} onThemeChange={setTheme} chrome="auth">
        <AuthPanel
          title={t.auth.loginTitle}
          description={t.auth.loginDescription}
          submitLabel={t.common.login}
          onSubmit={async (password) => {
            const result = await api<{ csrfToken: string }>("/api/login", {
              method: "POST",
              body: JSON.stringify({ password }),
            });
            setCsrfToken(result.csrfToken);
            await load();
          }}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      theme={theme}
      onThemeChange={setTheme}
      onLogout={() => void logout()}
      systemStatus={systemStatus}
    >
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--surface)",
            color: "var(--ink)",
            border: "1px solid var(--line)",
          },
        }}
      />
      {addAccountOpen && (
        <Suspense fallback={<LazyDialogStatus label={t.common.loading} />}>
          <AddAccountModal
            onClose={() => setAddAccountOpen(false)}
            onDone={load}
          />
        </Suspense>
      )}
      {adminOpen && (
        <Suspense fallback={<LazyDialogStatus label={t.common.loading} />}>
          <AdminDialog onClose={() => setAdminOpen(false)} onChanged={load} />
        </Suspense>
      )}

      <main className="grid gap-4 p-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <AccountRail
          accounts={accounts}
          selected={selected}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((value) => !value)}
          onSelect={setSelectedId}
          onAdd={() => setAddAccountOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)}
        />

        <section className="min-w-0">
          {(error || connectionError) && (
            <Alert tone="danger" className="mb-4">
              {error ?? connectionError}
            </Alert>
          )}

          <MobileAccountPicker
            accounts={accounts}
            selected={selected}
            onSelect={setSelectedId}
            onAdd={() => setAddAccountOpen(true)}
            onOpenAdmin={() => setAdminOpen(true)}
          />

          {selected ? (
            <AccountDetail
              key={selected.id}
              account={selected}
              events={events.filter(
                (event) => !event.accountId || event.accountId === selected.id,
              )}
              diagnostics={diagnostics}
              onReload={load}
            />
          ) : (
            <EmptyWorkspace onAdd={() => setAddAccountOpen(true)} />
          )}
        </section>
      </main>
    </AppShell>
  );
}

function LazyDialogStatus({ label }: { label: string }) {
  return (
    <div role="status" className="sr-only">
      {label}
    </div>
  );
}

function MobileAccountPicker({
  accounts,
  selected,
  onSelect,
  onAdd,
  onOpenAdmin,
}: {
  accounts: Account[];
  selected: Account | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onOpenAdmin: () => void;
}) {
  const { messages: t } = useI18n();

  if (accounts.length === 0) return null;

  return (
    <div className="mb-4 grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--panel-shadow)] lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-[var(--muted-strong)]">
          {t.common.account}
          <Select
            id="mobile-account"
            name="account"
            value={selected?.id ?? ""}
            onChange={(event) => onSelect(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.accountName} · {statusLabel(account.runtimeStatus, t)}
              </option>
            ))}
          </Select>
        </label>
        <Button
          variant="primary"
          size="icon"
          onClick={onAdd}
          aria-label={t.rail.add}
        >
          <Plus size={16} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onOpenAdmin}
          aria-label={t.rail.adminOpen}
          title={t.rail.adminOpen}
        >
          <ShieldCheck size={16} />
        </Button>
      </div>
    </div>
  );
}
