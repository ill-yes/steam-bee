import type { ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  CodeXml,
  Loader2,
  LogOut,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import type { SystemStatus } from "../../api";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/form";
import type { ThemePreference } from "../../hooks/useTheme";
import {
  localeOptions,
  useI18n,
  type LocaleCode,
  type Messages,
} from "../../i18n";

const sourceUrl =
  import.meta.env.VITE_SOURCE_URL || "https://github.com/ill-yes/steam-bee";

export function AppShell({
  children,
  theme,
  onThemeChange,
  onLogout,
  systemStatus,
  chrome = "app",
}: {
  children: ReactNode;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onLogout?: () => void;
  systemStatus?: SystemStatus | null;
  chrome?: "app" | "auth";
}) {
  const { locale, messages: t, setLocale } = useI18n();

  return (
    <div className={chrome === "auth" ? "min-h-screen" : "min-h-screen"}>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--topbar)_92%,transparent)] px-4 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 min-w-[104px] shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--brand-line)] bg-[var(--brand)] px-2 text-[var(--brand-fg)] shadow-[var(--button-shadow)]">
            <span className="steambee-wordmark">SteamBee</span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {t.appShell.title}
            </h1>
            <p className="truncate text-xs text-[var(--muted)]">
              {t.appShell.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {chrome === "app" ? <SystemStatusPill status={systemStatus} /> : null}
          <label className="hidden items-center gap-2 text-xs font-semibold text-[var(--muted-strong)] sm:flex">
            <span>{t.appShell.languageLabel}</span>
            <Select
              id="locale-preference"
              name="locale"
              value={locale}
              onChange={(event) => setLocale(event.target.value as LocaleCode)}
              className="h-8 min-h-8 w-[138px] py-0 text-xs"
              aria-label={t.appShell.languageAria}
            >
              {localeOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.nativeLabel}
                </option>
              ))}
            </Select>
          </label>
          <label className="hidden items-center gap-2 text-xs font-semibold text-[var(--muted-strong)] md:flex">
            <span>{t.appShell.themeLabel}</span>
            <Select
              id="theme-preference"
              name="theme"
              value={theme}
              onChange={(event) =>
                onThemeChange(event.target.value as ThemePreference)
              }
              className="h-8 min-h-8 w-[106px] py-0 text-xs"
              aria-label={t.appShell.themeAria}
            >
              <option value="system">{t.common.system}</option>
              <option value="dark">{t.common.dark}</option>
              <option value="light">{t.common.light}</option>
            </Select>
          </label>
          <details className="relative sm:hidden">
            <summary
              className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-md border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-strong)] [&::-webkit-details-marker]:hidden"
              aria-label={t.appShell.mobileSettings}
              title={t.appShell.mobileSettings}
            >
              <Settings2 size={17} />
            </summary>
            <div className="absolute right-0 top-11 z-40 grid w-[min(280px,calc(100vw-2rem))] gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--modal-shadow)] rtl:left-0 rtl:right-auto">
              {chrome === "app" ? (
                <MobileSystemStatus status={systemStatus} />
              ) : null}
              <Preference label={t.appShell.languageLabel}>
                <Select
                  name="mobile-locale"
                  value={locale}
                  onChange={(event) =>
                    setLocale(event.target.value as LocaleCode)
                  }
                  aria-label={t.appShell.languageAria}
                >
                  {localeOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.nativeLabel}
                    </option>
                  ))}
                </Select>
              </Preference>
              <Preference label={t.appShell.themeLabel}>
                <Select
                  name="mobile-theme"
                  value={theme}
                  onChange={(event) =>
                    onThemeChange(event.target.value as ThemePreference)
                  }
                  aria-label={t.appShell.themeAria}
                >
                  <option value="system">{t.common.system}</option>
                  <option value="dark">{t.common.dark}</option>
                  <option value="light">{t.common.light}</option>
                </Select>
              </Preference>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-md px-2.5 text-xs font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <CodeXml size={16} />
                <span>{t.common.sourceCode}</span>
              </a>
            </div>
          </details>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-md border border-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] sm:grid"
            aria-label={t.common.sourceCode}
            title={t.common.sourceCode}
          >
            <CodeXml size={18} />
          </a>
          {onLogout ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.common.logout}
              title={t.common.logout}
              onClick={onLogout}
            >
              <LogOut size={18} />
            </Button>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}

function SystemStatusPill({
  status,
}: {
  status?: SystemStatus | null | undefined;
}) {
  const { messages: t } = useI18n();
  const value = localizeSystemStatus(
    status ??
      ({
        code: "SYSTEM_LOADING",
        label: t.appShell.systemLoading,
        tone: "info",
        detail: t.appShell.systemLoadingDetail,
        pendingMigrations: 0,
        accountErrors: 0,
        recentErrors: 0,
        checkedAt: Date.now(),
      } satisfies SystemStatus),
    t,
  );
  const Icon =
    value.tone === "good"
      ? CheckCircle2
      : value.tone === "danger"
        ? CircleAlert
        : value.tone === "warn"
          ? TriangleAlert
          : Loader2;

  return (
    <span
      className="hidden min-h-8 max-w-[220px] items-center gap-1.5 truncate rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 text-xs font-semibold text-[var(--muted-strong)] sm:inline-flex"
      title={value.detail}
    >
      <Icon
        size={14}
        className={
          value.tone === "good"
            ? "text-[var(--good)]"
            : value.tone === "danger"
              ? "text-[var(--danger)]"
              : value.tone === "warn"
                ? "text-[var(--warn)]"
                : "text-[var(--muted)]"
        }
      />
      <span className="truncate">{value.label}</span>
    </span>
  );
}

function MobileSystemStatus({
  status,
}: {
  status: SystemStatus | null | undefined;
}) {
  const { messages: t } = useI18n();
  const value = localizeSystemStatus(
    status ?? {
      code: "SYSTEM_LOADING",
      label: t.appShell.systemLoading,
      detail: t.appShell.systemLoadingDetail,
      tone: "info",
      pendingMigrations: 0,
      accountErrors: 0,
      recentErrors: 0,
      checkedAt: Date.now(),
    },
    t,
  );
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
      <strong className="block text-xs">{value.label}</strong>
      <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
        {value.detail}
      </span>
    </div>
  );
}

function Preference({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-[var(--muted-strong)]">
      {label}
      {children}
    </label>
  );
}

function localizeSystemStatus(status: SystemStatus, t: Messages): SystemStatus {
  if (status.code === "SYSTEM_READY") {
    return {
      ...status,
      label: t.appShell.systemReady,
      detail: t.appShell.systemReadyDetail,
    };
  }
  if (status.code === "SYSTEM_ATTENTION_REQUIRED") {
    return {
      ...status,
      label: t.appShell.systemAttention,
      detail: t.appShell.systemAttentionDetail,
    };
  }
  if (status.code === "SYSTEM_MIGRATIONS_PENDING") {
    return {
      ...status,
      label: t.appShell.systemMigrations,
      detail: t.appShell.systemMigrationsDetail,
    };
  }
  return status;
}
