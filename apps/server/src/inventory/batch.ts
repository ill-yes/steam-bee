import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "@steam-bee/contracts";
import type {
  MarketActionResult,
  MarketBatchJob,
  MarketBatchPreview,
  MarketCurrency,
} from "@steam-bee/contracts";
import { appError } from "../http/errors.js";

type Row = MarketBatchPreview["items"][number];
export type BatchCommand = {
  row: Row;
  execute:
    ((shouldContinue: () => boolean) => Promise<MarketActionResult>) | null;
};
type Prepared = {
  accountId: string;
  actor: string;
  preview: MarketBatchPreview;
  commands: BatchCommand[];
};
type Job = {
  accountId: string;
  actor: string;
  value: MarketBatchJob;
  controller: AbortController;
  finishedAt: number | null;
};
type Dependencies = {
  now: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};
export function stoppedBeforeSubmission() {
  return Object.assign(
    appError("Market batch stopped before submission.", 409),
    { notSubmitted: true, stopBatch: true },
  );
}
export function uncertainSubmission() {
  return Object.assign(
    appError(
      "Steam did not confirm the submission result. Check Steam's listings and confirmations. No automatic retry will be made.",
      409,
    ),
    { stopBatch: true },
  );
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(stoppedBeforeSubmission());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    timer.unref?.();
    const abort = () => {
      clearTimeout(timer);
      reject(stoppedBeforeSubmission());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function copy(job: Job): MarketBatchJob {
  return structuredClone(job.value);
}

/** A confirmed batch is a bounded sequence; delays never occupy an account operation lock. */
export class MarketBatchQueue {
  private readonly previews = new Map<string, Prepared>();
  private readonly jobs = new Map<string, Job>();
  private readonly active = new Map<string, string>();
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  constructor(private readonly dependencies: Dependencies) {
    this.wait = dependencies.wait ?? delay;
  }

  private prune() {
    for (const [token, entry] of this.previews)
      if (entry.preview.expiresAt <= this.dependencies.now())
        this.previews.delete(token);
    for (const [id, job] of this.jobs)
      if (
        job.finishedAt !== null &&
        this.dependencies.now() - job.finishedAt >= 60 * 60_000
      )
        this.jobs.delete(id);
    if (this.previews.size >= 200 || this.jobs.size >= 200)
      throw appError(
        "Too many market batches. Wait before creating another batch.",
        429,
        ERROR_CODES.rateLimited,
      );
  }
  assertIdle(accountId: string) {
    if (this.active.has(accountId))
      throw appError(
        "A market batch is already running for this account. Stop it before starting another action.",
        409,
      );
  }
  create(
    accountId: string,
    actor: string,
    kind: "sale" | "cancel",
    currency: MarketCurrency | null,
    commands: BatchCommand[],
    delaySeconds: number,
  ): MarketBatchPreview {
    this.assertIdle(accountId);
    this.prune();
    if (!commands.length || commands.length > 50)
      throw appError(
        "Choose between one and 50 distinct items.",
        400,
        ERROR_CODES.validation,
      );
    for (const [token, entry] of this.previews)
      if (entry.accountId === accountId && entry.actor === actor)
        this.previews.delete(token);
    const preview: MarketBatchPreview = {
      token: randomUUID(),
      expiresAt: this.dependencies.now() + 2 * 60_000,
      kind,
      currency,
      items: commands.map((command) => command.row),
      delaySeconds,
      totalBuyerPays: commands.reduce(
        (sum, command) => sum + (command.row.buyerPays ?? 0),
        0,
      ),
      totalSellerReceives: commands.reduce(
        (sum, command) => sum + (command.row.sellerReceives ?? 0),
        0,
      ),
    };
    this.previews.set(preview.token, { accountId, actor, preview, commands });
    return structuredClone(preview);
  }
  confirm(accountId: string, actor: string, token: string): MarketBatchJob {
    const entry = this.previews.get(token);
    if (!entry || entry.accountId !== accountId || entry.actor !== actor)
      throw appError("Batch preview is invalid. Create a new preview.", 409);
    this.previews.delete(token);
    if (entry.preview.expiresAt <= this.dependencies.now())
      throw appError(
        "Batch preview expired. Review a fresh batch before confirming.",
        409,
      );
    if (!entry.commands.some((command) => command.execute))
      throw appError(
        "No eligible items are available for this batch. Review its item messages and price settings.",
        409,
      );
    this.assertIdle(accountId);
    this.prune();
    const value: MarketBatchJob = {
      id: randomUUID(),
      kind: entry.preview.kind,
      status: "running",
      createdAt: this.dependencies.now(),
      updatedAt: this.dependencies.now(),
      nextActionAt: null,
      items: entry.commands.map((command) => ({
        assetId: command.row.assetId,
        ...(command.row.variantId ? { variantId: command.row.variantId } : {}),
        listingId: command.row.listingId,
        name: command.row.name,
        quantity: command.row.quantity,
        status: command.execute ? "queued" : "skipped",
        message: command.row.message,
      })),
      completedCount: entry.commands.filter((command) => !command.execute)
        .length,
      totalCount: entry.commands.length,
      stopRequested: false,
    };
    const job: Job = {
      accountId,
      actor,
      value,
      controller: new AbortController(),
      finishedAt: null,
    };
    this.jobs.set(value.id, job);
    this.active.set(accountId, value.id);
    // Explicit confirmation is the only entry point that schedules actions.
    void this.run(job, entry).catch(() => {
      value.stopRequested = true;
      this.finish(job);
    });
    return copy(job);
  }
  private async run(job: Job, entry: Prepared) {
    const value = job.value;
    const deadline = this.dependencies.now() + 60 * 60_000;
    const shouldContinue = () =>
      !value.stopRequested &&
      !job.controller.signal.aborted &&
      this.dependencies.now() < deadline;
    let submitted = false;
    try {
      for (let index = 0; index < entry.commands.length; index++) {
        const command = entry.commands[index]!;
        const item = value.items[index]!;
        if (!command.execute) continue;
        if (!shouldContinue()) {
          value.stopRequested = true;
          break;
        }
        if (submitted) {
          value.status = "waiting";
          value.nextActionAt =
            this.dependencies.now() + entry.preview.delaySeconds * 1000;
          value.updatedAt = this.dependencies.now();
          try {
            await this.wait(
              entry.preview.delaySeconds * 1000,
              job.controller.signal,
            );
          } catch {
            value.stopRequested = true;
            break;
          }
          if (!shouldContinue()) {
            value.stopRequested = true;
            break;
          }
        }
        item.status = "running";
        value.status = "running";
        value.nextActionAt = null;
        value.updatedAt = this.dependencies.now();
        try {
          const result = await command.execute(shouldContinue);
          item.listingId = result.listingId ?? item.listingId;
          item.status = !result.ok
            ? "failed"
            : value.kind === "cancel"
              ? "cancelled"
              : result.pendingConfirmation
                ? "pending_confirmation"
                : "listed";
          item.message = result.message;
          submitted = true;
        } catch (error) {
          const detail = error as {
            message?: unknown;
            notSubmitted?: unknown;
            stopBatch?: unknown;
            statusCode?: unknown;
          };
          item.status = detail.notSubmitted === true ? "skipped" : "failed";
          item.message =
            typeof detail.message === "string"
              ? detail.message.slice(0, 500)
              : "This market item could not be processed.";
          submitted = detail.notSubmitted !== true;
          if (detail.stopBatch === true || detail.statusCode === 429)
            value.stopRequested = true;
        }
        value.completedCount++;
        value.updatedAt = this.dependencies.now();
        if (value.stopRequested) break;
      }
    } finally {
      this.finish(job);
    }
  }
  private finish(job: Job) {
    const value = job.value;
    for (const item of value.items)
      if (item.status === "queued" || item.status === "running") {
        item.status = "skipped";
        item.message = "Stopped before this item was submitted.";
      }
    value.completedCount = value.items.filter(
      (item) => item.status !== "queued" && item.status !== "running",
    ).length;
    value.status = value.stopRequested ? "stopped" : "completed";
    value.nextActionAt = null;
    value.updatedAt = this.dependencies.now();
    job.finishedAt = this.dependencies.now();
    if (this.active.get(job.accountId) === value.id)
      this.active.delete(job.accountId);
  }
  get(accountId: string, actor: string, jobId: string): MarketBatchJob {
    const job = this.jobs.get(jobId);
    if (
      !job ||
      job.accountId !== accountId ||
      job.actor !== actor ||
      (job.finishedAt !== null &&
        this.dependencies.now() - job.finishedAt >= 60 * 60_000)
    )
      throw appError("Market batch was not found.", 404, ERROR_CODES.notFound);
    return copy(job);
  }
  current(accountId: string, actor: string): MarketBatchJob | null {
    const id = this.active.get(accountId);
    const job = id ? this.jobs.get(id) : undefined;
    return job?.actor === actor ? copy(job) : null;
  }
  stop(accountId: string, actor: string, jobId: string): MarketBatchJob {
    this.get(accountId, actor, jobId);
    const job = this.jobs.get(jobId)!;
    if (job.finishedAt === null) {
      job.value.stopRequested = true;
      job.value.updatedAt = this.dependencies.now();
      job.controller.abort();
    }
    return copy(job);
  }
  stopAccount(accountId: string) {
    // Invalidate unconfirmed previews too: a later confirm must not resurrect a stopped account.
    for (const [token, entry] of this.previews)
      if (entry.accountId === accountId) this.previews.delete(token);
    const jobId = this.active.get(accountId);
    const job = jobId ? this.jobs.get(jobId) : undefined;
    if (job) {
      job.value.stopRequested = true;
      job.value.updatedAt = this.dependencies.now();
      job.controller.abort();
    }
  }
  shutdown() {
    for (const accountId of this.active.keys()) this.stopAccount(accountId);
    this.previews.clear();
  }
}
