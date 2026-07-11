import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Account, SteamEvent } from "../../api";
import { api, apiErrorMessage, isAbortError } from "../../api";
import { interpolate, useI18n } from "../../i18n";
import { busyStates, eventDisplay, importableStates } from "../../lib/status";

const pollDelayMs = 2_000;
const closeDelayMs = 900;

export type LoginMode = "qr" | "credentials";
export type LoginStep = "idle" | "qr" | "connecting" | "importing" | "done";
export type CredentialField = keyof SteamCredentials;

export type SteamCredentials = {
  accountName: string;
  password: string;
  guardCode: string;
};

type QrSession = {
  loginId: string;
  qrUrl: string;
  flowId: number;
};

type ConnectedAccount = {
  id: string;
  flowId: number;
  startedAt: number;
};

type LoginPollState =
  | { status: "pending"; qrUrl?: string; message?: string }
  | {
      status: "authenticated";
      accountId: string;
      accountName: string;
      connectedAt: number;
      message?: string;
    }
  | { status: "error"; message: string };

type CredentialLoginState =
  | {
      status: "authenticated";
      accountId: string;
      connectedAt: number;
      message?: string;
    }
  | { status: "guard_required" | "pending"; message?: string };

export function useAddAccountFlow({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { messages } = useI18n();
  const [mode, setMode] = useState<LoginMode>("qr");
  const modeRef = useRef<LoginMode>("qr");
  const [qr, setQr] = useState<QrSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [credentials, setCredentials] = useState<SteamCredentials>({
    accountName: "",
    password: "",
    guardCode: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginStep, setLoginStep] = useState<LoginStep>("idle");
  const [connectedAccount, setConnectedAccount] =
    useState<ConnectedAccount | null>(null);
  const mountedRef = useRef(false);
  const flowIdRef = useRef(0);
  const startQrControllerRef = useRef<AbortController | null>(null);
  const credentialsControllerRef = useRef<AbortController | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closeScheduledRef = useRef(false);
  const doneNotificationsRef = useRef(new Map<string, Promise<void>>());
  const doneQueueRef = useRef<Promise<void>>(Promise.resolve());
  const messagesRef = useRef(messages);
  const onCloseRef = useRef(onClose);
  const onDoneRef = useRef(onDone);
  messagesRef.current = messages;
  onCloseRef.current = onClose;
  onDoneRef.current = onDone;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startQrControllerRef.current?.abort();
      credentialsControllerRef.current?.abort();
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const isCurrentFlow = useCallback(
    (flowId: number) => mountedRef.current && flowIdRef.current === flowId,
    [],
  );

  const notifyDoneOnce = useCallback(
    (flowId: number, milestone: string) => {
      if (!isCurrentFlow(flowId)) return Promise.resolve();

      const key = `flow:${flowId}:${milestone}`;
      const existing = doneNotificationsRef.current.get(key);
      if (existing) return existing;

      const queuedNotification = doneQueueRef.current.then(async () => {
        if (!isCurrentFlow(flowId)) return;
        await onDoneRef.current();
        if (!isCurrentFlow(flowId)) return;
      });
      let trackedNotification: Promise<void>;
      trackedNotification = queuedNotification.catch((notificationError) => {
        if (doneNotificationsRef.current.get(key) === trackedNotification) {
          doneNotificationsRef.current.delete(key);
        }
        throw notificationError;
      });
      doneNotificationsRef.current.set(key, trackedNotification);
      doneQueueRef.current = trackedNotification.catch(() => undefined);
      return trackedNotification;
    },
    [isCurrentFlow],
  );

  const scheduleCloseOnce = useCallback(() => {
    if (!mountedRef.current || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (mountedRef.current) onCloseRef.current();
    }, closeDelayMs);
  }, []);

  const resetScheduledClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closeScheduledRef.current = false;
  }, []);

  const switchMode = useCallback(
    (nextMode: LoginMode) => {
      const previousMode = modeRef.current;
      if (previousMode === nextMode) return;

      modeRef.current = nextMode;
      flowIdRef.current += 1;
      startQrControllerRef.current?.abort();
      startQrControllerRef.current = null;
      credentialsControllerRef.current?.abort();
      credentialsControllerRef.current = null;
      resetScheduledClose();
      setConnectedAccount(null);
      setQr(null);
      setQrDataUrl(null);
      setQrLoading(false);
      setCredentialsLoading(false);
      setMessage(null);
      setError(null);
      setLoginStep("idle");
      if (previousMode === "credentials") {
        setCredentials((current) => ({
          ...current,
          password: "",
          guardCode: "",
        }));
      }
      setMode(nextMode);
    },
    [resetScheduledClose],
  );

  useEffect(() => {
    if (!qr) return;
    let active = true;
    let stopped = false;
    let timer: number | null = null;
    let pollController: AbortController | null = null;
    const isCurrent = () => active && isCurrentFlow(qr.flowId);

    void QRCode.toDataURL(qr.qrUrl, { width: 196, margin: 1 })
      .then((dataUrl) => {
        if (isCurrent()) setQrDataUrl(dataUrl);
      })
      .catch((qrError: unknown) => {
        if (isCurrent()) {
          setError(apiErrorMessage(qrError, messagesRef.current));
        }
      });

    const schedulePoll = () => {
      if (!isCurrent() || stopped) return;
      timer = window.setTimeout(() => void poll(), pollDelayMs);
    };

    const poll = async () => {
      if (!isCurrent() || stopped) return;
      const controller = new AbortController();
      pollController = controller;
      try {
        const state = await api<LoginPollState>(
          `/api/steam/login/${qr.loginId}`,
          { signal: controller.signal },
        );
        if (!isCurrent() || controller.signal.aborted) return;
        setError(null);

        if (state.status === "authenticated") {
          stopped = true;
          setLoginStep("connecting");
          setMessage(
            state.accountName
              ? interpolate(
                  messagesRef.current.addAccount.accountSavedConnecting,
                  { accountName: state.accountName },
                )
              : messagesRef.current.addAccount.savedConnecting,
          );
          setConnectedAccount({
            id: state.accountId,
            flowId: qr.flowId,
            startedAt: state.connectedAt,
          });
          await notifyDoneOnce(qr.flowId, "authenticated");
          if (!isCurrent()) return;
          return;
        }

        if (state.status === "error") {
          stopped = true;
          setError(messagesRef.current.addAccount.qrLoginFailed);
        }
      } catch (pollError) {
        if (
          isCurrent() &&
          !controller.signal.aborted &&
          !isAbortError(pollError)
        ) {
          setError(apiErrorMessage(pollError, messagesRef.current));
        }
      } finally {
        if (pollController === controller) pollController = null;
        schedulePoll();
      }
    };

    schedulePoll();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      pollController?.abort();
    };
  }, [isCurrentFlow, notifyDoneOnce, qr]);

  useEffect(() => {
    if (!connectedAccount) return;
    const { id: accountId, flowId, startedAt } = connectedAccount;
    let active = true;
    let stopped = false;
    let timer: number | null = null;
    let pollController: AbortController | null = null;
    const isCurrent = () => active && isCurrentFlow(flowId);

    const schedulePoll = () => {
      if (!isCurrent() || stopped) return;
      timer = window.setTimeout(() => void poll(), pollDelayMs);
    };

    const poll = async () => {
      if (!isCurrent() || stopped) return;
      const controller = new AbortController();
      pollController = controller;
      try {
        const request = { signal: controller.signal } satisfies RequestInit;
        const [accounts, recentEvents] = await Promise.all([
          api<Account[]>("/api/accounts", request),
          api<SteamEvent[]>("/api/events/recent", request),
        ]);
        if (!isCurrent() || controller.signal.aborted) return;
        setError(null);

        const account = accounts.find((item) => item.id === accountId);
        if (!account) return;
        const importEvent = recentEvents.find(
          (event) =>
            event.accountId === accountId &&
            event.createdAt >= startedAt &&
            (event.type === "steam.library.import" ||
              event.type === "steam.library.import.error"),
        );

        if (
          !busyStates.has(account.runtimeStatus) &&
          !importableStates.has(account.runtimeStatus)
        ) {
          setMessage(null);
          setError(
            account.lastError ??
              messagesRef.current.addAccount.steamConnectFailed,
          );
          await notifyDoneOnce(flowId, `account-${account.runtimeStatus}`);
          if (!isCurrent()) return;
          stopped = true;
          setConnectedAccount(null);
          return;
        }

        if (busyStates.has(account.runtimeStatus)) {
          setLoginStep("connecting");
          setMessage(messagesRef.current.addAccount.steamConnecting);
        } else if (importableStates.has(account.runtimeStatus)) {
          if (importEvent?.type === "steam.library.import.error") {
            setLoginStep("done");
            setMessage(null);
            setError(
              eventDisplay(importEvent, messagesRef.current).title ??
                messagesRef.current.addAccount.steamConnectFailed,
            );
            await notifyDoneOnce(flowId, "import-error");
            if (!isCurrent()) return;
            stopped = true;
            setConnectedAccount(null);
            return;
          }

          if (importEvent) {
            setLoginStep("done");
            setMessage(
              eventDisplay(importEvent, messagesRef.current).title ??
                messagesRef.current.addAccount.steamOnlineImporting,
            );
            await notifyDoneOnce(flowId, "done");
            if (!isCurrent()) return;
            stopped = true;
            setConnectedAccount(null);
            scheduleCloseOnce();
            return;
          }

          setLoginStep("importing");
          setMessage(messagesRef.current.addAccount.steamOnlineImporting);
          await notifyDoneOnce(flowId, "importing");
          if (!isCurrent()) return;
        }
      } catch (progressError) {
        if (
          isCurrent() &&
          !controller.signal.aborted &&
          !isAbortError(progressError)
        ) {
          setError(apiErrorMessage(progressError, messagesRef.current));
        }
      } finally {
        if (pollController === controller) pollController = null;
        schedulePoll();
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      pollController?.abort();
    };
  }, [connectedAccount, isCurrentFlow, notifyDoneOnce, scheduleCloseOnce]);

  const startQr = useCallback(async () => {
    credentialsControllerRef.current?.abort();
    credentialsControllerRef.current = null;
    startQrControllerRef.current?.abort();
    const controller = new AbortController();
    startQrControllerRef.current = controller;
    const flowId = flowIdRef.current + 1;
    flowIdRef.current = flowId;
    resetScheduledClose();
    setConnectedAccount(null);
    setCredentialsLoading(false);
    setQr(null);
    setQrDataUrl(null);
    setError(null);
    setMessage(null);
    setLoginStep("qr");
    setQrLoading(true);
    try {
      const session = await api<Omit<QrSession, "flowId">>(
        "/api/steam/login/qr/start",
        { method: "POST", signal: controller.signal },
      );
      if (
        !isCurrentFlow(flowId) ||
        controller.signal.aborted ||
        startQrControllerRef.current !== controller
      ) {
        return;
      }
      setQr({ ...session, flowId });
    } catch (startError) {
      if (
        isCurrentFlow(flowId) &&
        !controller.signal.aborted &&
        startQrControllerRef.current === controller &&
        !isAbortError(startError)
      ) {
        setError(apiErrorMessage(startError, messagesRef.current));
      }
    } finally {
      if (
        isCurrentFlow(flowId) &&
        startQrControllerRef.current === controller
      ) {
        startQrControllerRef.current = null;
        setQrLoading(false);
      }
    }
  }, [isCurrentFlow, resetScheduledClose]);

  const submitCredentials = useCallback(async () => {
    startQrControllerRef.current?.abort();
    startQrControllerRef.current = null;
    credentialsControllerRef.current?.abort();
    const controller = new AbortController();
    credentialsControllerRef.current = controller;
    const flowId = flowIdRef.current + 1;
    flowIdRef.current = flowId;
    resetScheduledClose();
    setConnectedAccount(null);
    setQr(null);
    setQrDataUrl(null);
    setQrLoading(false);
    setError(null);
    setMessage(null);
    setCredentialsLoading(true);
    try {
      const result = await api<CredentialLoginState>(
        "/api/steam/login/credentials",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            ...credentials,
            guardCode: credentials.guardCode || undefined,
          }),
        },
      );
      if (
        !isCurrentFlow(flowId) ||
        controller.signal.aborted ||
        credentialsControllerRef.current !== controller
      ) {
        return;
      }

      if (result.status === "authenticated") {
        setLoginStep("connecting");
        setMessage(messagesRef.current.addAccount.savedConnecting);
        setCredentials((current) => ({
          ...current,
          password: "",
          guardCode: "",
        }));
        setConnectedAccount({
          id: result.accountId,
          flowId,
          startedAt: result.connectedAt,
        });
        await notifyDoneOnce(flowId, "authenticated");
        if (!isCurrentFlow(flowId)) return;
      } else {
        setMessage(messagesRef.current.addAccount.guardRequired);
      }
    } catch (submitError) {
      if (
        isCurrentFlow(flowId) &&
        !controller.signal.aborted &&
        credentialsControllerRef.current === controller &&
        !isAbortError(submitError)
      ) {
        setError(apiErrorMessage(submitError, messagesRef.current));
      }
    } finally {
      if (
        isCurrentFlow(flowId) &&
        credentialsControllerRef.current === controller
      ) {
        credentialsControllerRef.current = null;
        setCredentialsLoading(false);
      }
    }
  }, [credentials, isCurrentFlow, notifyDoneOnce, resetScheduledClose]);

  function updateCredential(field: CredentialField, value: string) {
    setCredentials((current) => ({ ...current, [field]: value }));
  }

  return {
    mode,
    switchMode,
    qr,
    qrDataUrl,
    qrLoading,
    startQr,
    credentials,
    credentialsLoading,
    updateCredential,
    submitCredentials,
    message,
    error,
    loginStep,
  };
}
