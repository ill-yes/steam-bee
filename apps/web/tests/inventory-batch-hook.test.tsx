import type { MarketBatchJob, MarketBatchPreview } from "@steam-bee/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api";
import { useBatchMarket } from "../src/features/inventory/useBatchMarket";

vi.mock("../src/api", async (original) => ({
  ...(await original<typeof import("../src/api")>()),
  api: vi.fn(),
}));

const base = "/api/accounts/first/market";
const sale = {
  kind: "sale" as const,
  items: [{ assetId: "card", quantity: 1 }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function job(
  id = "job-a",
  overrides: Partial<MarketBatchJob> = {},
): MarketBatchJob {
  return {
    id,
    kind: "sale",
    status: "waiting",
    createdAt: 100,
    updatedAt: 100,
    nextActionAt: 200,
    items: [
      {
        assetId: "card",
        listingId: null,
        name: "Card",
        quantity: 1,
        status: "queued",
        message: null,
      },
    ],
    completedCount: 0,
    totalCount: 1,
    stopRequested: false,
    ...overrides,
  };
}

function preview(): MarketBatchPreview {
  return {
    token: "preview-token",
    expiresAt: Date.now() + 60_000,
    kind: "sale",
    currency: { id: 1, code: "USD", minorUnit: 2 },
    items: [],
    totalBuyerPays: 0,
    totalSellerReceives: 0,
    delaySeconds: 10,
  };
}

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

async function settle(action?: () => void) {
  await act(async () => {
    action?.();
    await Promise.resolve();
  });
}

describe("batch market operation ordering and recovery", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores initial job A when its response arrives after confirming job B", async () => {
    const restore = deferred<MarketBatchJob | null>();
    const confirmed = job("job-b", { createdAt: 300, updatedAt: 300 });
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active")) return restore.promise;
      if (path.endsWith("/batch-preview")) return preview();
      if (path.endsWith("/batch-confirm")) return confirmed;
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    // Initial restoration does not block the otherwise usable inventory.
    await settle(() => result.current.createPreview(sale));
    expect(result.current.preview?.token).toBe("preview-token");
    await settle(() => result.current.confirm());
    expect(result.current.job?.id).toBe("job-b");
    await settle(() => restore.resolve(job("job-a")));
    expect(result.current.job).toEqual(confirmed);
    expect(result.current.recovering).toBe(false);
  });

  it("ignores an in-flight poll started before an explicit stop", async () => {
    vi.useFakeTimers();
    const poll = deferred<MarketBatchJob>();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active")) return job();
      if (path.endsWith("/stop")) return job("job-a", { stopRequested: true });
      if (path.endsWith("/batches/job-a")) return poll.promise;
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await settle(() => result.current.stop());
    expect(result.current.job?.stopRequested).toBe(true);
    await settle(() => poll.resolve(job()));
    expect(result.current.job?.stopRequested).toBe(true);
    expect(
      vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/stop")),
    ).toHaveLength(1);
  });

  it("preserves a stop acknowledgement against a same-epoch poll with an equal timestamp", async () => {
    vi.useFakeTimers();
    const stop = deferred<MarketBatchJob>();
    const poll = deferred<MarketBatchJob>();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active")) return job();
      if (path.endsWith("/stop")) return stop.promise;
      if (path.endsWith("/batches/job-a")) return poll.promise;
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    await settle(() => result.current.stop());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await settle(() => stop.resolve(job("job-a", { stopRequested: true })));
    await settle(() => poll.resolve(job()));
    expect(result.current.job?.stopRequested).toBe(true);
    expect(result.current.busy).toBe(false);
  });

  it("never rolls back row progress, counts, timestamps, or a terminal state", async () => {
    vi.useFakeTimers();
    const staleRead = deferred<MarketBatchJob | null>();
    let reads = 0;
    let polls = 0;
    const progressed = job("job-a", {
      updatedAt: 200,
      completedCount: 1,
      items: [
        {
          assetId: "card",
          listingId: "listing",
          name: "Card",
          quantity: 1,
          status: "listed",
          message: "Submitted",
        },
      ],
    });
    const completed = {
      ...progressed,
      status: "completed" as const,
      stopRequested: true,
    };
    const onUpdated = vi.fn();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active"))
        return ++reads === 1 ? progressed : staleRead.promise;
      if (path.endsWith("/batches/job-a"))
        return ++polls === 1 ? job() : completed;
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, onUpdated),
    );
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.job).toMatchObject({
      updatedAt: 200,
      completedCount: 1,
    });
    expect(result.current.job?.items[0]).toMatchObject({
      status: "listed",
      listingId: "listing",
    });
    await settle(() => result.current.retryRecovery());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.job?.status).toBe("completed");
    // This active read began in the same epoch and reports the same timestamp.
    await settle(() => staleRead.resolve({ ...job(), updatedAt: 200 }));
    expect(result.current.job).toMatchObject({
      status: "completed",
      stopRequested: true,
      completedCount: 1,
      updatedAt: 200,
      nextActionAt: null,
    });
    expect(result.current.job?.items[0]?.status).toBe("listed");
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("recovers an accepted confirmation after its response is lost without resubmitting", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active"))
        return ++reads === 1 ? null : job("accepted");
      if (path.endsWith("/batch-preview")) return preview();
      if (path.endsWith("/batch-confirm")) throw new Error("Response lost");
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    await settle(() => result.current.createPreview(sale));
    await settle(() => result.current.confirm());
    expect(result.current.job?.id).toBe("accepted");
    expect(result.current.error).toBe("Response lost");
    expect(result.current.preview).toBeNull();
    expect(result.current.recoveryRequired).toBe(false);
    await settle(() => result.current.confirm());
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path.endsWith("/batch-confirm")),
    ).toHaveLength(1);
  });

  it("reports an initial recovery error and retries with a read only", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active")) {
        if (++reads === 1) throw new Error("Recovery unavailable");
        return job();
      }
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    expect(result.current.recoveryError).toBe("Recovery unavailable");
    expect(result.current.recovering).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(result.current.recoveryRequired).toBe(false);
    await settle(() => result.current.retryRecovery());
    expect(result.current.recoveryError).toBe("");
    expect(result.current.job?.id).toBe("job-a");
    expect(
      vi
        .mocked(api)
        .mock.calls.every(
          ([path, init]) => path === `${base}/batches/active` && !init?.method,
        ),
    ).toBe(true);
  });

  it("allows a new preview when only the initial recovery read failed", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active"))
        throw new Error("Recovery unavailable");
      if (path.endsWith("/batch-preview")) return preview();
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    expect(result.current.recoveryRequired).toBe(false);
    await settle(() => result.current.createPreview(sale));
    expect(result.current.preview?.token).toBe("preview-token");
    expect(result.current.busy).toBe(false);
  });

  it("ignores an older uncertain-confirmation recovery after an explicit recovery retry", async () => {
    const staleRecovery = deferred<MarketBatchJob | null>();
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active")) {
        reads++;
        return reads === 1
          ? null
          : reads === 2
            ? staleRecovery.promise
            : job("latest", { createdAt: 300 });
      }
      if (path.endsWith("/batch-preview")) return preview();
      if (path.endsWith("/batch-confirm")) throw new Error("Response lost");
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    await settle(() => result.current.createPreview(sale));
    await settle(() => result.current.confirm());
    expect(result.current.recovering).toBe(true);
    await settle(() => result.current.retryRecovery());
    expect(result.current.job?.id).toBe("latest");
    await settle(() => staleRecovery.resolve(job("older")));
    expect(result.current.job?.id).toBe("latest");
    expect(result.current.recoveryRequired).toBe(false);
  });

  it("requires a successful read after an uncertain confirmation recovery fails", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active")) {
        reads++;
        if (reads === 1) return null;
        if (reads === 2) throw new Error("Recovery unavailable");
        return job("accepted");
      }
      if (path.endsWith("/batch-preview")) return preview();
      if (path.endsWith("/batch-confirm")) throw new Error("Response lost");
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    await settle(() => result.current.createPreview(sale));
    await settle(() => result.current.confirm());
    expect(result.current.recoveryRequired).toBe(true);
    expect(result.current.recoveryError).toBe("Recovery unavailable");
    await settle(() => result.current.createPreview(sale));
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path.endsWith("/batch-preview")),
    ).toHaveLength(1);
    await settle(() => result.current.retryRecovery());
    expect(result.current.job?.id).toBe("accepted");
    expect(result.current.recoveryRequired).toBe(false);
  });

  it("recovers a conflicting preview with GET rather than retrying a mutation", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active")) return ++reads === 1 ? null : job();
      if (path.endsWith("/batch-preview"))
        throw new ApiError("Batch already active", "CONFLICT", 409);
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    await settle(() => result.current.createPreview(sale));
    expect(result.current.job?.id).toBe("job-a");
    expect(result.current.error).toBe("Batch already active");
    expect(
      vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("rejects an older job ID returned by an explicit recovery read", async () => {
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/batches/active"))
        return ++reads === 1 ? null : job("older", { createdAt: 99 });
      if (path.endsWith("/batch-preview")) return preview();
      if (path.endsWith("/batch-confirm"))
        return job("confirmed", { createdAt: 100 });
      throw new Error(`Unexpected ${path}`);
    });
    const { result } = renderHook(() =>
      useBatchMarket("first", errorMessage, vi.fn()),
    );
    await settle();
    await settle(() => result.current.createPreview(sale));
    await settle(() => result.current.confirm());
    await settle(() => result.current.retryRecovery());
    expect(result.current.job?.id).toBe("confirmed");
  });

  it("isolates account lifetimes from late restore responses", async () => {
    const first = deferred<MarketBatchJob | null>();
    vi.mocked(api).mockImplementation(async (path) =>
      path.includes("/first/") ? first.promise : job("second"),
    );
    const { result, rerender } = renderHook(
      ({ accountId }) => useBatchMarket(accountId, errorMessage, vi.fn()),
      { initialProps: { accountId: "first" } },
    );
    await settle(() => rerender({ accountId: "second" }));
    expect(result.current.job?.id).toBe("second");
    await settle(() => first.resolve(job("first")));
    expect(result.current.job?.id).toBe("second");
  });
});
