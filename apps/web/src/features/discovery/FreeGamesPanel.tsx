import type { FreeGamesResponse } from "@steam-bee/contracts";
import {
  Bell,
  BellOff,
  ChevronDown,
  ExternalLink,
  Gift,
  Globe2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, apiErrorMessage, isAbortError } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  ToolPageHeader,
  ToolRefreshButton,
} from "../../components/ui/tool-page-header";
import { useI18n } from "../../i18n";
import { SteamAppArtwork } from "../library/SteamAppArtwork";
import { discoveryCopy } from "./copy";
import {
  acceptOfferSnapshot,
  announceOfferPreferenceChange,
  observeOfferPreference,
  readOfferNotificationState,
  saveOfferNotificationState,
} from "./notification-state";

type BrowserPermission = NotificationPermission | "unsupported";
function browserPermission(): BrowserPermission {
  return typeof Notification !== "undefined" &&
    typeof Notification.requestPermission === "function"
    ? Notification.permission
    : "unsupported";
}

export function FreeGamesPanel({ accountId }: { accountId: string }) {
  return <AccountFreeGamesPanel key={accountId} accountId={accountId} />;
}

function AccountFreeGamesPanel({ accountId }: { accountId: string }) {
  const { locale, localeInfo, messages } = useI18n();
  const copy = discoveryCopy(locale);
  const titleId = useId();
  const notificationHelpId = useId();
  const notificationTitleId = useId();
  const [data, setData] = useState<FreeGamesResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState(browserPermission);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const preference = useRef(readOfferNotificationState(accountId));
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    preference.current.enabled,
  );
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const preferenceRevision = useRef(0);
  const permissionPending = useRef(false);
  const hasLibrary = data !== null && data.libraryImportedAt !== null;

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await api<FreeGamesResponse>(
        `/api/accounts/${encodeURIComponent(accountId)}/free-games`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setData(response);
    } catch (cause) {
      if (!controller.signal.aborted && !isAbortError(cause))
        setError(apiErrorMessage(cause, messages));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [accountId, messages]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      preferenceRevision.current++;
    };
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 5 * 60_000);
    return () => {
      window.clearInterval(interval);
      activeRequest.current?.abort();
    };
  }, [load]);

  useEffect(
    () =>
      observeOfferPreference(accountId, (state) => {
        preferenceRevision.current++;
        preference.current = state;
        setNotificationsEnabled(state.enabled);
      }),
    [accountId],
  );

  useEffect(() => {
    const refreshPermission = () => setPermission(browserPermission());
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, []);

  function persistPreference(state: typeof preference.current) {
    preference.current = state;
    setNotificationsEnabled(state.enabled);
    saveOfferNotificationState(accountId, state);
    announceOfferPreferenceChange(accountId, state);
  }

  async function enableNotifications(browserOnly = false) {
    if (permissionPending.current) return;
    permissionPending.current = true;
    const revision = ++preferenceRevision.current;
    setNotificationBusy(true);
    try {
      let nextPermission = browserPermission();
      if (nextPermission === "default") {
        try {
          nextPermission = await Notification.requestPermission();
        } catch {
          nextPermission = "unsupported";
        }
      }
      // Permission prompts can outlive this account or an opt-out in another tab.
      if (!mounted.current || revision !== preferenceRevision.current) return;
      setPermission(nextPermission);
      if (browserOnly) return;
      const initial = {
        ...preference.current,
        enabled: true,
        baselined: false,
      };
      persistPreference(
        data && !data.stale && hasLibrary
          ? acceptOfferSnapshot(initial, data.offers).state
          : initial,
      );
    } finally {
      permissionPending.current = false;
      if (mounted.current) setNotificationBusy(false);
    }
  }

  function toggleNotifications() {
    if (preference.current.enabled) {
      preferenceRevision.current++;
      persistPreference({ ...preference.current, enabled: false });
      return;
    }
    void enableNotifications();
  }

  const formatDate = (time: number) =>
    new Intl.DateTimeFormat(localeInfo.dateLocale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(time);
  const permissionMessage =
    permission === "granted"
      ? copy.browserEnabled
      : permission === "denied"
        ? copy.denied
        : permission === "unsupported"
          ? copy.unsupported
          : copy.dismissed;

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      className="grid min-w-0 gap-4"
    >
      <ToolPageHeader
        icon={Gift}
        title={copy.title}
        titleId={titleId}
        description={copy.description}
        actions={
          <ToolRefreshButton
            label={copy.refresh}
            busy={busy}
            onClick={() => void load()}
          />
        }
      />
      <ol
        aria-label={copy.howTitle}
        className="grid min-w-0 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-3"
      >
        {[copy.howCheck, copy.howOwned, copy.howClaim].map((step, index) => (
          <li key={step} className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-xs font-bold text-[var(--primary-fg)]"
            >
              {index + 1}
            </span>
            <span className="text-xs leading-5 text-[var(--muted-strong)]">
              {step}
            </span>
          </li>
        ))}
      </ol>
      <div className="order-last flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs leading-5 text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ink)]">
          <Globe2 size={14} aria-hidden="true" />
          {copy.regionLabel}
        </span>
        {data ? (
          <>
            <span>
              {copy.checked}:{" "}
              <time dateTime={new Date(data.checkedAt).toISOString()}>
                {formatDate(data.checkedAt)}
              </time>
            </span>
            {data.libraryImportedAt !== null ? (
              <span>
                {copy.excluded}: {data.excludedOwnedCount}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      {error && !data && <Alert tone="danger">{error}</Alert>}
      {data && (error || data.stale) && (
        <Alert tone="warning">
          <span className="block">
            {data.stale ? copy.stale : copy.refreshFailed}
          </span>
          {error && (
            <span className="mt-1 block text-xs font-normal">{error}</span>
          )}
        </Alert>
      )}
      {data?.truncated && <Alert tone="warning">{copy.truncated}</Alert>}
      {data && !hasLibrary && <Alert>{copy.noLibrary}</Alert>}
      {busy && (
        <p role="status" className="text-sm text-[var(--muted)]">
          {data ? copy.refreshing : copy.loading}
        </p>
      )}
      {data && data.offers.length === 0 && (
        <div
          role="status"
          className="grid justify-items-center gap-3 rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] px-5 py-10 text-center"
        >
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface)] text-[var(--muted)]">
            <Gift size={24} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold">{copy.emptyTitle}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
              {data.stale || error ? copy.staleEmpty : copy.empty}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {copy.checkAgain}
            </Button>
            <a
              href={`#${notificationTitleId}`}
              className="inline-flex min-h-11 items-center rounded text-sm font-semibold text-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              {copy.notificationSetup}
            </a>
          </div>
        </div>
      )}
      {data && data.offers.length > 0 && (
        <ul className="grid min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          {data.offers.map((offer) => (
            <li
              key={offer.appId}
              className="flex min-w-0 flex-wrap items-center gap-4 border-t border-[var(--line)] p-3 first:border-t-0"
            >
              <SteamAppArtwork
                appId={offer.appId}
                name={offer.name}
                size="row"
              />
              <div className="min-w-0 flex-[1_1_200px]">
                <h3 className="break-words text-base font-semibold leading-6">
                  {offer.name}
                </h3>
                <p className="text-xs font-semibold text-[var(--good)]">
                  {copy.offerLabel}
                </p>
              </div>
              <a
                href={offer.storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${copy.openStore}: ${offer.name}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--primary)] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                {copy.openStore}
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
      <details className="group min-w-0 text-xs text-[var(--muted)]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="shrink-0 transition-transform group-open:rotate-180"
          />
          {copy.offerDetails}
        </summary>
        <div className="grid gap-2 border-s-2 border-[var(--line)] py-1 ps-4 leading-5">
          <p>{copy.region}</p>
          {data?.libraryImportedAt !== null &&
          data?.libraryImportedAt !== undefined ? (
            <>
              <p>
                {copy.ownership}{" "}
                <time dateTime={new Date(data.libraryImportedAt).toISOString()}>
                  {formatDate(data.libraryImportedAt)}
                </time>
              </p>
              <p>{copy.ownershipHelp}</p>
            </>
          ) : null}
        </div>
      </details>
      <aside
        aria-labelledby={notificationTitleId}
        className="grid min-w-0 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Bell
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-[var(--muted)]"
            />
            <div className="min-w-0">
              <h3 id={notificationTitleId} className="text-sm font-semibold">
                {copy.notificationTitle}
              </h3>
              <p
                id={notificationHelpId}
                className="mt-1 text-xs leading-5 text-[var(--muted)]"
              >
                {copy.notificationSummary}
              </p>
            </div>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="max-w-full whitespace-normal py-2 text-center"
              variant={notificationsEnabled ? "primary" : "secondary"}
              aria-pressed={notificationsEnabled}
              aria-describedby={notificationHelpId}
              disabled={
                notificationBusy || (!notificationsEnabled && !hasLibrary)
              }
              onClick={toggleNotifications}
            >
              {notificationsEnabled ? (
                <BellOff size={14} aria-hidden="true" />
              ) : (
                <Bell size={14} aria-hidden="true" />
              )}
              {notificationBusy
                ? copy.notificationBusy
                : notificationsEnabled
                  ? copy.stopNotifications
                  : copy.notifications}
            </Button>
            {notificationsEnabled && permission === "default" && (
              <Button
                size="sm"
                variant="outline"
                className="max-w-full whitespace-normal py-2 text-center"
                disabled={notificationBusy}
                onClick={() => void enableNotifications(true)}
              >
                {copy.allowBrowser}
              </Button>
            )}
          </div>
        </div>
        {notificationsEnabled && (
          <div
            role="status"
            className="grid max-w-2xl gap-1 text-xs leading-5 text-[var(--muted)]"
          >
            <p>
              {hasLibrary ? copy.dashboardEnabled : copy.notificationsPaused}
            </p>
            <p>{permissionMessage}</p>
          </div>
        )}
        <details className="group min-w-0 text-xs text-[var(--muted)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
            <ChevronDown
              size={14}
              aria-hidden="true"
              className="shrink-0 transition-transform group-open:rotate-180"
            />
            {copy.notificationDetails}
          </summary>
          <p className="max-w-2xl leading-5">{copy.notificationHelp}</p>
        </details>
      </aside>
    </section>
  );
}
