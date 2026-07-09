import { useEffect, useState } from "react";
import { Clock3, KeyRound, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import type { Account, SteamEvent } from "../../api";
import { api, apiErrorMessage } from "../../api";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/form";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { busyStates, eventDisplay, importableStates } from "../../lib/status";
import { interpolate, useI18n } from "../../i18n";

type LoginStep = "idle" | "qr" | "connecting" | "importing" | "done";

export function AddAccountModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { messages: t } = useI18n();
  const [mode, setMode] = useState<"qr" | "credentials">("qr");
  const [qr, setQr] = useState<{ loginId: string; qrUrl: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [credentials, setCredentials] = useState({
    accountName: "",
    password: "",
    guardCode: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginStep, setLoginStep] = useState<LoginStep>("idle");
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!qr) return;
    void QRCode.toDataURL(qr.qrUrl, { width: 196, margin: 1 }).then(
      setQrDataUrl,
    );
    const interval = window.setInterval(() => {
      void api<{
        status: string;
        accountId?: string;
        accountName?: string;
        message?: string;
      }>(`/api/steam/login/${qr.loginId}`)
        .then(async (state) => {
          if (state.status === "authenticated") {
            setLoginStep("connecting");
            setMessage(
              state.accountName
                ? interpolate(t.addAccount.accountSavedConnecting, {
                    accountName: state.accountName,
                  })
                : t.addAccount.savedConnecting,
            );
            window.clearInterval(interval);
            if (state.accountId) setConnectedAccountId(state.accountId);
            await onDone();
          } else if (state.status === "error") {
            setError(t.addAccount.qrLoginFailed);
            window.clearInterval(interval);
          }
        })
        .catch((pollError) => setError(apiErrorMessage(pollError, t)));
    }, 2000);
    return () => window.clearInterval(interval);
  }, [qr, onDone]);

  useEffect(() => {
    if (!connectedAccountId) return;
    let closed = false;

    async function pollAccountProgress() {
      try {
        const [accounts, recentEvents] = await Promise.all([
          api<Account[]>("/api/accounts"),
          api<SteamEvent[]>("/api/events/recent"),
        ]);
        if (closed) return;

        const account = accounts.find((item) => item.id === connectedAccountId);
        if (!account) return;

        const importEvent = recentEvents.find(
          (event) =>
            event.accountId === connectedAccountId &&
            (event.type === "steam.library.import" ||
              event.type === "steam.library.import.error"),
        );

        if (account.runtimeStatus === "error") {
          setError(account.lastError ?? t.addAccount.steamConnectFailed);
          setConnectedAccountId(null);
          await onDone();
          return;
        }

        if (busyStates.has(account.runtimeStatus)) {
          setLoginStep("connecting");
          setMessage(t.addAccount.steamConnecting);
        } else if (importableStates.has(account.runtimeStatus)) {
          if (importEvent?.type === "steam.library.import.error") {
            setLoginStep("done");
            setError(
              eventDisplay(importEvent, t).title ??
                t.addAccount.steamConnectFailed,
            );
            setConnectedAccountId(null);
          } else if (importEvent) {
            setLoginStep("done");
            setMessage(
              eventDisplay(importEvent, t).title ??
                t.addAccount.steamOnlineImporting,
            );
            setConnectedAccountId(null);
            window.setTimeout(onClose, 900);
          } else {
            setLoginStep("importing");
            setMessage(t.addAccount.steamOnlineImporting);
          }
          await onDone();
        }
      } catch (progressError) {
        if (!closed) setError(apiErrorMessage(progressError, t));
      }
    }

    void pollAccountProgress();
    const interval = window.setInterval(() => void pollAccountProgress(), 2000);
    return () => {
      closed = true;
      window.clearInterval(interval);
    };
  }, [connectedAccountId, onClose, onDone]);

  async function startQr() {
    setError(null);
    setMessage(null);
    setLoginStep("qr");
    setQrLoading(true);
    try {
      setQr(await api("/api/steam/login/qr/start", { method: "POST" }));
    } catch (startError) {
      setError(apiErrorMessage(startError, t));
    } finally {
      setQrLoading(false);
    }
  }

  return (
    <Dialog
      title={t.addAccount.title}
      description={t.addAccount.description}
      onClose={onClose}
    >
      <div className="grid gap-4">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          ariaLabel={t.addAccount.loginMode}
          className="w-full grid-cols-2"
          options={[
            { label: t.addAccount.qrLogin, value: "qr" },
            { label: t.addAccount.fallback, value: "credentials" },
          ]}
        />

        <LoginProgress step={loginStep} />

        {mode === "qr" ? (
          <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]">
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <h3 className="text-sm font-semibold">{t.common.scanQr}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {t.addAccount.qrIntro}
              </p>
              <Button
                className="mt-4"
                variant="primary"
                onClick={startQr}
                disabled={qrLoading}
              >
                <RefreshCw size={16} />
                {qrLoading ? t.addAccount.qrStarting : t.addAccount.qrStart}
              </Button>
            </div>
            <div className="grid min-h-[230px] place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
              {qr ? (
                <div className="grid justify-items-center gap-3">
                  {qrDataUrl ? (
                    <img
                      alt="Steam QR"
                      src={qrDataUrl}
                      className="rounded-md bg-white p-2"
                    />
                  ) : (
                    <div className="h-[196px] w-[196px] animate-pulse rounded-md bg-[var(--surface-3)]" />
                  )}
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-strong)]">
                    <Clock3 size={15} />
                    {t.addAccount.qrWaiting}
                  </span>
                </div>
              ) : (
                <div className="grid justify-items-center gap-2 text-center text-sm text-[var(--muted)]">
                  <KeyRound size={24} />
                  <span>{t.addAccount.qrNotStarted}</span>
                </div>
              )}
            </div>
          </section>
        ) : (
          <form
            className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              setMessage(null);
              setCredentialsLoading(true);
              try {
                const result = await api<{
                  status: string;
                  accountId?: string;
                  message?: string;
                }>("/api/steam/login/credentials", {
                  method: "POST",
                  body: JSON.stringify({
                    ...credentials,
                    guardCode: credentials.guardCode || undefined,
                  }),
                });
                if (result.status === "authenticated") {
                  setLoginStep("connecting");
                  setMessage(t.addAccount.savedConnecting);
                  await onDone();
                  if (result.accountId) setConnectedAccountId(result.accountId);
                } else {
                  setMessage(t.addAccount.guardRequired);
                }
              } catch (submitError) {
                setError(apiErrorMessage(submitError, t));
              } finally {
                setCredentialsLoading(false);
              }
            }}
          >
            <div className="flex items-start gap-3">
              <KeyRound
                size={18}
                className="mt-1 shrink-0 text-[var(--info)]"
              />
              <div>
                <h3 className="text-sm font-semibold">
                  {t.common.credentialFallback}
                </h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {t.addAccount.credentialsOnlyIfQrFails}
                </p>
              </div>
            </div>
            <Label htmlFor="steam-account-name">
              {t.common.accountName}
              <Input
                id="steam-account-name"
                name="accountName"
                autoComplete="username"
                value={credentials.accountName}
                onChange={(event) =>
                  setCredentials({
                    ...credentials,
                    accountName: event.target.value,
                  })
                }
                required
              />
            </Label>
            <Label htmlFor="steam-password">
              {t.common.password}
              <Input
                id="steam-password"
                name="steam-password"
                type="password"
                autoComplete="current-password"
                value={credentials.password}
                onChange={(event) =>
                  setCredentials({
                    ...credentials,
                    password: event.target.value,
                  })
                }
                required
              />
            </Label>
            <Label htmlFor="steam-guard-code">
              {t.common.steamGuardCode}
              <Input
                id="steam-guard-code"
                name="steamGuardCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={credentials.guardCode}
                onChange={(event) =>
                  setCredentials({
                    ...credentials,
                    guardCode: event.target.value,
                  })
                }
              />
            </Label>
            <p className="text-xs text-[var(--muted)]">
              {t.addAccount.credentialsNotPersisted}
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={
                credentialsLoading ||
                !credentials.accountName ||
                !credentials.password
              }
            >
              {credentialsLoading
                ? t.addAccount.credentialsConnecting
                : t.addAccount.credentialsConnect}
            </Button>
          </form>
        )}

        {message && <Alert tone="success">{message}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}

function LoginProgress({ step }: { step: LoginStep }) {
  const { messages: t } = useI18n();
  const steps: Array<{ id: Exclude<LoginStep, "idle">; label: string }> = [
    { id: "qr", label: t.addAccount.progress.qr },
    { id: "connecting", label: t.addAccount.progress.connecting },
    { id: "importing", label: t.addAccount.progress.importing },
    { id: "done", label: t.addAccount.progress.done },
  ];
  const activeIndex = Math.max(
    0,
    steps.findIndex((item) => item.id === step),
  );

  return (
    <div
      className="grid gap-2 sm:grid-cols-4"
      aria-label={t.addAccount.progressAria}
    >
      {steps.map((item, index) => {
        const done =
          step !== "idle" && (index < activeIndex || step === "done");
        const active = step !== "idle" && index === activeIndex && !done;
        return (
          <span
            key={item.id}
            className={`flex min-h-9 min-w-0 items-center gap-2 rounded-md border px-2 text-xs font-semibold ${
              done
                ? "border-[var(--good-line)] bg-[var(--good-soft)] text-[var(--good)]"
                : active
                  ? "border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]"
                  : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[11px]">
              {index + 1}
            </span>
            <span className="truncate">{item.label}</span>
          </span>
        );
      })}
    </div>
  );
}
