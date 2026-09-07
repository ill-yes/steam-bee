import { describe, expect, it, vi } from "vitest";
import {
  buildWithLeaseCleanup,
  closeWithLeaseCleanup,
  createRuntimeShutdown,
  ShutdownTimeoutError,
  IncompleteListenCleanupError,
  IncompleteStartupCleanupError,
  listenWithLeaseCleanup,
} from "../src/startup.js";
import { buildApp } from "../src/app.js";
import { notificationDispatcher } from "../src/notifications/dispatcher.js";
import { steamManager } from "../src/steam/manager.js";

describe("server startup", () => {
  it("uses one bounded close and retains the lease after timeout, including late completion", async () => {
    vi.useFakeTimers();
    let finishClose = () => {};
    const app = {
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishClose = resolve;
          }),
      ),
    };
    const lease = { release: vi.fn() };
    try {
      const closing = closeWithLeaseCleanup(app, lease);
      expect(closeWithLeaseCleanup(app, lease)).toBe(closing);
      const rejection =
        expect(closing).rejects.toBeInstanceOf(ShutdownTimeoutError);
      await vi.advanceTimersByTimeAsync(25_000);
      await rejection;
      finishClose();
      await Promise.resolve();
      expect(lease.release).not.toHaveBeenCalled();
      expect(app.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares repeated signal shutdown and exits unsuccessfully on a deadline", async () => {
    vi.useFakeTimers();
    const app = { close: vi.fn(() => new Promise<void>(() => {})) };
    const lease = { release: vi.fn() };
    const reportFailure = vi.fn();
    const exit = vi.fn();
    const begin = vi.fn();
    const close = createRuntimeShutdown(app, lease, reportFailure, exit, begin);
    try {
      const closing = close();
      expect(close()).toBe(closing);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(begin.mock.invocationCallOrder[0]).toBeLessThan(
        app.close.mock.invocationCallOrder[0]!,
      );
      await vi.advanceTimersByTimeAsync(25_000);
      await closing;
      expect(reportFailure).toHaveBeenCalledWith(
        expect.any(ShutdownTimeoutError),
      );
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(lease.release).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shuts down partial Steam initialization before releasing the data lease", async () => {
    const failure = new Error("later account initialization failed");
    const order: string[] = [];
    const initSpy = vi
      .spyOn(steamManager, "init")
      .mockImplementation(async () => {
        order.push("worker-started");
        throw failure;
      });
    const shutdownSpy = vi
      .spyOn(steamManager, "shutdown")
      .mockImplementation(async () => {
        order.push("worker-shutdown");
      });
    const lease = {
      release: vi.fn(() => order.push("lease-released")),
    };

    try {
      await expect(buildWithLeaseCleanup(() => buildApp(), lease)).rejects.toBe(
        failure,
      );
      expect(order).toEqual([
        "worker-started",
        "worker-shutdown",
        "lease-released",
      ]);
    } finally {
      initSpy.mockRestore();
      shutdownSpy.mockRestore();
    }
  });

  it("retains the data lease when partial initialization cleanup fails", async () => {
    const failure = new IncompleteStartupCleanupError(
      new Error("initialization failed"),
      new Error("cleanup failed"),
    );
    const lease = { release: vi.fn() };

    await expect(
      buildWithLeaseCleanup(async () => {
        throw failure;
      }, lease),
    ).rejects.toBe(failure);
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("closes the app and releases the data lease when listen fails", async () => {
    const failure = new Error("address already in use");
    const app = {
      listen: vi.fn(async () => {
        throw failure;
      }),
      close: vi.fn(async () => undefined),
    };
    const lease = { release: vi.fn() };

    await expect(
      listenWithLeaseCleanup(app, lease, { host: "127.0.0.1", port: 3000 }),
    ).rejects.toBe(failure);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it("keeps the lease while the server is listening", async () => {
    const app = {
      listen: vi.fn(async () => "http://127.0.0.1:3000"),
      close: vi.fn(async () => undefined),
    };
    const lease = { release: vi.fn() };

    await expect(
      listenWithLeaseCleanup(app, lease, { host: "127.0.0.1", port: 3000 }),
    ).resolves.toBe("http://127.0.0.1:3000");
    expect(app.close).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("reports both listen and cleanup failures while retaining the lease", async () => {
    const listenFailure = new Error("address already in use");
    const cleanupFailure = new Error("worker shutdown failed");
    const app = {
      listen: vi.fn(async () => {
        throw listenFailure;
      }),
      close: vi.fn(async () => {
        throw cleanupFailure;
      }),
    };
    const lease = { release: vi.fn() };

    let failure: unknown;
    try {
      await listenWithLeaseCleanup(app, lease, {
        host: "127.0.0.1",
        port: 3000,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(IncompleteListenCleanupError);
    expect(failure).toMatchObject({
      listenError: listenFailure,
      cleanupError: cleanupFailure,
    });
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("releases the data lease only after runtime shutdown completes", async () => {
    let finishClose: (() => void) | undefined;
    const order: string[] = [];
    const app = {
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishClose = () => {
              order.push("runtime-closed");
              resolve();
            };
          }),
      ),
    };
    const lease = {
      release: vi.fn(() => order.push("lease-released")),
    };

    const closing = closeWithLeaseCleanup(app, lease);
    expect(lease.release).not.toHaveBeenCalled();
    finishClose?.();
    await closing;

    expect(order).toEqual(["runtime-closed", "lease-released"]);
  });

  it("retains the data lease when runtime shutdown fails", async () => {
    const failure = new Error("runtime shutdown failed");
    const app = {
      close: vi.fn(async () => {
        throw failure;
      }),
    };
    const lease = { release: vi.fn() };

    await expect(closeWithLeaseCleanup(app, lease)).rejects.toBe(failure);
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("propagates Steam worker shutdown failures through Fastify close", async () => {
    const failure = new AggregateError(
      [new Error("worker shutdown failed")],
      "One or more Steam workers failed to shut down cleanly.",
    );
    const initSpy = vi.spyOn(steamManager, "init").mockResolvedValue(undefined);
    const shutdownSpy = vi
      .spyOn(steamManager, "shutdown")
      .mockRejectedValue(failure);
    const lease = { release: vi.fn() };

    try {
      const app = await buildApp();
      await expect(closeWithLeaseCleanup(app, lease)).rejects.toBe(failure);
      expect(shutdownSpy).toHaveBeenCalledTimes(1);
      expect(lease.release).not.toHaveBeenCalled();
    } finally {
      initSpy.mockRestore();
      shutdownSpy.mockRestore();
    }
  });

  it("waits for notification reconciliation before application close completes", async () => {
    let releaseReconciliation = () => {};
    let markReconciliationStarted = () => {};
    const reconciliationStarted = new Promise<void>((resolve) => {
      markReconciliationStarted = resolve;
    });
    const reconciliationGate = new Promise<void>((resolve) => {
      releaseReconciliation = resolve;
    });
    const dispatcherInternals = notificationDispatcher as unknown as {
      reconcileNow(): Promise<void>;
    };
    const reconcileSpy = vi
      .spyOn(dispatcherInternals, "reconcileNow")
      .mockImplementation(async () => {
        markReconciliationStarted();
        await reconciliationGate;
      });
    const app = await buildApp({ initSteam: false });

    try {
      await reconciliationStarted;
      let closed = false;
      const closing = app.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);

      releaseReconciliation();
      await closing;
      expect(closed).toBe(true);
    } finally {
      releaseReconciliation();
      await app.close().catch(() => undefined);
      reconcileSpy.mockRestore();
    }
  });
});
