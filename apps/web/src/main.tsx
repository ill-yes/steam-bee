import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
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
  type SteamEvent,
  type SystemStatus,
  setCsrfToken,
} from "./api";
import { Alert } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Select } from "./components/ui/form";
import { useTheme } from "./hooks/useTheme";
import { I18nProvider, useI18n } from "./i18n";
import { AccountDetail } from "./features/accounts/AccountDetail";
import { AccountRail } from "./features/accounts/AccountRail";
import { AddAccountModal } from "./features/accounts/AddAccountModal";
import { AppShell } from "./features/accounts/AppShell";
import { EmptyWorkspace } from "./features/accounts/EmptyWorkspace";
import { AdminDialog } from "./features/admin/AdminDialog";
import { AuthPanel } from "./features/auth/AuthPanel";
import { statusLabel } from "./lib/status";
import "./styles.css";

function App() {
  const { messages: t } = useI18n();
  const { theme, setTheme } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<SteamEvent[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const loadGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const messagesRef = useRef(t);
  messagesRef.current = t;

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
    setMe(nextMe);
    setCsrfToken(nextMe.csrfToken);

    if (!nextMe.authenticated) {
      setAccounts([]);
      setEvents([]);
      setDiagnostics(null);
      setSystemStatus(null);
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
    if (generation !== loadGeneration.current) return;
    setAccounts(nextAccounts);
    setEvents(nextEvents);
    setDiagnostics(nextDiagnostics);
    setSystemStatus(nextSystemStatus);
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
        ]).catch(() => undefined);
      }, 150);
    };
    source.addEventListener("event", (message) => {
      try {
        const event = JSON.parse((message as MessageEvent).data) as SteamEvent;
        setEvents((current) => [event, ...current].slice(0, 100));
        scheduleRefresh();
      } catch {
        setError(t.errors.INVALID_RESPONSE);
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
          <div className="grid w-full gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--panel-shadow)]">
            <div className="h-6 w-2/3 animate-pulse rounded-full bg-[var(--surface-3)]" />
            <div className="h-3 w-full animate-pulse rounded-full bg-[var(--surface-3)]" />
            <div className="h-3 w-1/2 animate-pulse rounded-full bg-[var(--surface-3)]" />
          </div>
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
        <AddAccountModal
          onClose={() => setAddAccountOpen(false)}
          onDone={load}
        />
      )}
      {adminOpen && (
        <AdminDialog onClose={() => setAdminOpen(false)} onChanged={load} />
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
          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
