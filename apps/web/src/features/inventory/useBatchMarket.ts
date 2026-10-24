import type { MarketBatchJob, MarketBatchPreview } from "@steam-bee/contracts";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, isAbortError } from "../../api";

function isRunning(job: MarketBatchJob | null) {
  return job?.status === "running" || job?.status === "waiting";
}

function isFinished(job: MarketBatchJob) {
  return job.status === "completed" || job.status === "stopped";
}

/** Server rows keep their order for the lifetime of a job. Equal timestamps are possible. */
function mergeJob(
  previous: MarketBatchJob,
  incoming: MarketBatchJob,
): MarketBatchJob {
  const latest = incoming.updatedAt >= previous.updatedAt ? incoming : previous;
  const items = Array.from(
    { length: Math.max(previous.items.length, incoming.items.length) },
    (_, index) => {
      const before = previous.items[index];
      const after = incoming.items[index];
      if (!before) return after!;
      if (!after) return before;
      const beforeFinished =
        before.status !== "queued" && before.status !== "running";
      const afterFinished =
        after.status !== "queued" && after.status !== "running";
      const progressed = beforeFinished
        ? before
        : afterFinished ||
            (before.status === "queued" && after.status === "running")
          ? after
          : before.status === "running" && after.status === "queued"
            ? before
            : incoming.updatedAt >= previous.updatedAt
              ? after
              : before;
      return {
        ...progressed,
        listingId: progressed.listingId ?? before.listingId ?? after.listingId,
      };
    },
  );
  const status = isFinished(previous)
    ? previous.status
    : isFinished(incoming)
      ? incoming.status
      : latest.status;
  return {
    ...latest,
    items,
    status,
    updatedAt: Math.max(previous.updatedAt, incoming.updatedAt),
    completedCount: Math.max(previous.completedCount, incoming.completedCount),
    totalCount: Math.max(previous.totalCount, incoming.totalCount),
    stopRequested: previous.stopRequested || incoming.stopRequested,
    nextActionAt:
      status === "completed" || status === "stopped"
        ? null
        : latest.nextActionAt,
  };
}

export function useBatchMarket(
  accountId: string,
  errorMessage: (error: unknown) => string,
  onUpdated: () => void,
) {
  const [preview, setPreview] = useState<MarketBatchPreview | null>(null);
  const [job, setJob] = useState<MarketBatchJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const active = useRef(false);
  const lock = useRef<number | null>(null);
  const epoch = useRef(0);
  const currentJob = useRef<MarketBatchJob | null>(null);
  const needsRecovery = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const formatError = useRef(errorMessage);
  formatError.current = errorMessage;
  const updated = useRef(onUpdated);
  updated.current = onUpdated;
  const base = `/api/accounts/${encodeURIComponent(accountId)}/market`;
  const running = isRunning(job);

  function isCurrent(operation: number) {
    return active.current && epoch.current === operation;
  }

  function updateJob(
    value: MarketBatchJob,
    operation: number,
    confirmed = false,
  ) {
    if (!isCurrent(operation)) return;
    const previous = currentJob.current;
    // A delayed read must never restore an older job over the current confirmation.
    if (
      previous &&
      previous.id !== value.id &&
      !confirmed &&
      value.createdAt <= previous.createdAt
    )
      return;
    const next = previous?.id === value.id ? mergeJob(previous, value) : value;
    currentJob.current = next;
    setJob(next);
    setPollError(false);
    if (isFinished(next) && (previous?.id !== next.id || !isFinished(previous)))
      updated.current();
  }

  async function recoverActive(operation: number) {
    if (!isCurrent(operation)) return;
    setRecovering(true);
    setRecoveryError("");
    try {
      const value = await api<MarketBatchJob | null>(`${base}/batches/active`, {
        signal: controller.current?.signal ?? null,
      });
      if (!isCurrent(operation)) return;
      if (value) updateJob(value, operation);
      needsRecovery.current = false;
      setRecoveryRequired(false);
      setRecoveryError("");
    } catch (cause) {
      if (isCurrent(operation) && !isAbortError(cause))
        setRecoveryError(formatError.current(cause));
    } finally {
      if (isCurrent(operation)) setRecovering(false);
    }
  }

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    active.current = true;
    const operation = ++epoch.current;
    lock.current = null;
    currentJob.current = null;
    needsRecovery.current = false;
    setJob(null);
    setPreview(null);
    setBusy(false);
    setError("");
    setPollError(false);
    setRecoveryRequired(false);
    // Restores a running server job without storing account details or job state in the browser.
    void recoverActive(operation);
    return () => {
      active.current = false;
      epoch.current++;
      abort.abort();
    };
  }, [accountId]);

  useEffect(() => {
    if (!job || !running) return;
    const jobId = job.id;
    let pending = false;
    let cancelled = false;
    const abort = new AbortController();
    async function poll() {
      if (pending) return;
      const operation = epoch.current;
      pending = true;
      try {
        const value = await api<MarketBatchJob>(
          `${base}/batches/${encodeURIComponent(jobId)}`,
          { signal: abort.signal },
        );
        if (
          !cancelled &&
          currentJob.current?.id === jobId &&
          value.id === jobId
        )
          updateJob(value, operation);
      } catch (cause) {
        if (!cancelled && isCurrent(operation) && !isAbortError(cause))
          setPollError(true);
      } finally {
        pending = false;
      }
    }
    const interval = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      abort.abort();
      window.clearInterval(interval);
    };
  }, [accountId, job?.id, running]);

  async function perform(
    action: (operation: number) => Promise<void>,
    kind: "preview" | "confirm" | "stop",
  ) {
    if (lock.current !== null || !active.current) return;
    const operation = ++epoch.current;
    lock.current = operation;
    setBusy(true);
    setError("");
    setRecovering(false);
    try {
      await action(operation);
    } catch (cause) {
      if (isCurrent(operation) && !isAbortError(cause)) {
        if (kind === "confirm") setPreview(null);
        setError(formatError.current(cause));
        if (
          kind === "confirm" ||
          (kind === "preview" &&
            cause instanceof ApiError &&
            cause.status === 409)
        ) {
          // A lost confirmation response can still have started a server job. Recover it; never resubmit.
          needsRecovery.current = true;
          setRecoveryRequired(true);
          void recoverActive(operation);
        }
      }
    } finally {
      if (lock.current === operation) lock.current = null;
      if (isCurrent(operation)) setBusy(false);
    }
  }

  function createPreview(
    body:
      | { kind: "sale"; items: { assetId: string; quantity: number }[] }
      | { kind: "cancel"; listingIds: string[] },
  ) {
    if (isRunning(currentJob.current) || needsRecovery.current) return;
    void perform(async (operation) => {
      const value = await api<MarketBatchPreview>(`${base}/batch-preview`, {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.current?.signal ?? null,
      });
      if (isCurrent(operation)) setPreview(value);
    }, "preview");
  }

  function confirm() {
    if (
      !preview ||
      preview.expiresAt <= Date.now() ||
      isRunning(currentJob.current) ||
      needsRecovery.current
    )
      return;
    const token = preview.token;
    void perform(async (operation) => {
      const value = await api<MarketBatchJob>(`${base}/batch-confirm`, {
        method: "POST",
        body: JSON.stringify({ token }),
        signal: controller.current?.signal ?? null,
      });
      if (!isCurrent(operation)) return;
      setPreview(null);
      setRecoveryError("");
      updateJob(value, operation, true);
    }, "confirm");
  }

  function stop() {
    const current = currentJob.current;
    if (!current || !isRunning(current) || current.stopRequested) return;
    const id = current.id;
    void perform(
      async (operation) =>
        updateJob(
          await api<MarketBatchJob>(
            `${base}/batches/${encodeURIComponent(id)}/stop`,
            { method: "POST", signal: controller.current?.signal ?? null },
          ),
          operation,
        ),
      "stop",
    );
  }

  function retryRecovery() {
    if (lock.current !== null || !active.current) return;
    void recoverActive(++epoch.current);
  }

  return {
    preview,
    job,
    busy,
    error,
    pollError,
    recoveryError,
    recovering,
    recoveryRequired,
    running,
    createPreview,
    confirm,
    stop,
    retryRecovery,
    closePreview: () => {
      if (lock.current === null) {
        setPreview(null);
        setError("");
      }
    },
    dismiss: () => {
      if (
        !isRunning(currentJob.current) &&
        !needsRecovery.current &&
        lock.current === null
      ) {
        epoch.current++;
        currentJob.current = null;
        setJob(null);
        setPollError(false);
        setError("");
        setRecovering(false);
      }
    },
  };
}
