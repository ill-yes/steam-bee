import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const steamMock = vi.hoisted(() => ({
  instances: [],
}));

vi.mock("steam-user", () => {
  class FakeSteamUser {
    static EConnectionProtocol = { WebSocket: 1 };
    private listeners = new Map<string, Function[]>();
    steamID: unknown = { getSteamID64: () => "76561198000000001" };
    gamesPlayed = vi.fn();
    logOff = vi.fn();
    logOn = vi.fn();
    setPersona = vi.fn();
    getUserOwnedApps = vi.fn(async () => ({ apps: [] }));
    steamBeeBeginShutdown = vi.fn();
    steamBeeDrainRefreshTokens = vi.fn(async () => undefined);
    steamBeeLogOffAndDrain = vi.fn(async () => {
      this.logOff();
    });

    constructor() {
      steamMock.instances.push(this);
    }

    on(event: string, callback: Function) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        callback,
      ]);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const callback of this.listeners.get(event) ?? []) callback(...args);
      return true;
    }

    removeAllListeners(event?: string) {
      if (event) this.listeners.delete(event);
      else this.listeners.clear();
      return this;
    }

    listenerCount(event: string) {
      return this.listeners.get(event)?.length ?? 0;
    }
  }

  return { default: FakeSteamUser };
});

import { db, migrate, sqlite } from "../src/db/client.js";
import {
  accountFarmingResume,
  accountHealthState,
  boostPreset,
  boostSchedule,
  boostSession,
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
  steamAppCache,
  steamEvent,
} from "../src/db/schema.js";
import { steamManager } from "../src/steam/manager.js";
import {
  getAccountSafetyPolicy,
  getSafetyHoldOwner,
  setSafetyHold,
  updateSafetyPolicy,
} from "../src/steam/operations-repository.js";
import { SteamWorker } from "../src/steam/worker.js";
import { AccountOperationState } from "../src/steam/account-operation-state.js";
import { decryptSecret, encryptSecret } from "../src/util/crypto.js";
import { closeWithLeaseCleanup, ShutdownTimeoutError } from "../src/startup.js";
import { farmingController } from "../src/farming/service.js";
import { inventoryMarket } from "../src/inventory/runtime.js";

describe("SteamWorker", () => {
  beforeEach(async () => {
    await steamManager.shutdown();
    migrate();
    steamMock.instances.length = 0;
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM steam_account_library;
      DELETE FROM steam_account_game;
      DELETE FROM steam_app_cache;
      DELETE FROM steam_account;
    `);
  });

  it.each(["pause", "stop"] as const)(
    "persists an admitted renewal after %s without restarting Steam",
    async (action) => {
      const account = await credentialAccount();
      const worker = new SteamWorker(account);
      const client = steamMock.instances.at(-1)!;
      const intent = worker[action]();
      client.emit("steamBeeRefreshToken", renewedCredential);
      await intent;
      await flushCredentials(worker);
      expect(storedCredential(account.id)).toBe("renewed-token");
      expect(client.logOn).not.toHaveBeenCalled();
      expect(
        client.gamesPlayed.mock.calls.every(([games]) => games.length === 0),
      ).toBe(true);
      await worker.shutdown();
    },
  );

  it("dates each app by its earliest license and caches package contents", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1)!;
    client.licenses = [
      { package_id: 10, time_created: 1_700_000_000 },
      { package_id: 11, time_created: 1_600_000_000 },
      { package_id: 12, time_created: 1_650_000_000 },
      { package_id: 0, time_created: 1_500_000_000 },
    ];
    client.getProductInfo = vi.fn(async () => ({
      packages: {
        10: { packageinfo: { appids: [440, 570] } },
        11: { packageinfo: { appids: [570] } },
        12: { packageinfo: { appids: [730] } },
      },
    }));
    const times = await worker.acquisitionTimes([440, 570, 999]);
    expect([...times]).toEqual([
      [440, 1_700_000_000_000],
      [570, 1_600_000_000_000],
    ]);
    expect(client.getProductInfo).toHaveBeenCalledWith([], [10, 11, 12], true);
    await worker.acquisitionTimes([730]);
    expect(client.getProductInfo).toHaveBeenCalledTimes(1);
    await worker.shutdown();
  });

  it("does not overwrite a newer QR credential, even between read and update", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1)!;
    const qr = encryptSecret("new-qr-token");
    const originalUpdate = db.update.bind(db);
    const updateSpy = vi.spyOn(db, "update").mockImplementationOnce((table) => {
      sqlite
        .prepare(
          "UPDATE steam_account SET token_ciphertext = ?, token_iv = ?, token_auth_tag = ? WHERE id = ?",
        )
        .run(qr.ciphertext, qr.iv, qr.authTag, account.id);
      return originalUpdate(table);
    });
    try {
      client.emit("steamBeeRefreshToken", renewedCredential);
      await flushCredentials(worker);
      expect(storedCredential(account.id)).toBe("new-qr-token");
    } finally {
      updateSpy.mockRestore();
      await worker.shutdown();
    }
  });

  it("ignores renewed credentials for a deleted account or different Steam identity", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1)!;
    client.emit("steamBeeRefreshToken", {
      ...renewedCredential,
      steamId: "76561198000000002",
    });
    await flushCredentials(worker);
    expect(storedCredential(account.id)).toBe("previous-token");
    await db.delete(steamAccount).where(eq(steamAccount.id, account.id));
    client.emit("steamBeeRefreshToken", renewedCredential);
    await flushCredentials(worker);
    expect(
      db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id))
        .get(),
    ).toBeUndefined();
    await worker.shutdown();
  });

  it("does not cache a failed commit and permits the same renewal to be persisted again", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1)!;
    const updateSpy = vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("synthetic credential commit failure");
    });
    client.emit("steamBeeRefreshToken", renewedCredential);
    await flushCredentials(worker);
    updateSpy.mockRestore();
    await worker.start();
    expect(client.logOn).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshToken: "previous-token" }),
    );
    client.emit("steamBeeRefreshToken", renewedCredential);
    await flushCredentials(worker);
    expect(storedCredential(account.id)).toBe("renewed-token");
    await expect(worker.shutdown()).rejects.toThrow(
      "Could not persist a renewed Steam credential",
    );
  });

  it("drains late credentials before listener removal and rejects work throughout shutdown", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1)!;
    let finishRenewal = () => {};
    client.steamBeeDrainRefreshTokens.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRenewal = () => {
            client.emit("steamBeeRefreshToken", renewedCredential);
            resolve();
          };
        }),
    );
    const shutdown = worker.shutdown();
    expect(worker.shutdown()).toBe(shutdown);
    expect(client.steamBeeBeginShutdown).toHaveBeenCalledTimes(1);
    await expect(worker.start()).rejects.toThrow("shutting down");
    client.emit("loggedOn");
    client.emit("error", new Error("late Steam error"));
    expect(storedCredential(account.id)).toBe("previous-token");
    finishRenewal();
    await shutdown;
    expect(storedCredential(account.id)).toBe("renewed-token");
    expect(client.logOn).not.toHaveBeenCalled();
    client.emit("steamBeeRefreshToken", {
      ...renewedCredential,
      previousRefreshToken: "renewed-token",
      refreshToken: "too-late",
    });
    await flushCredentials(worker);
    expect(storedCredential(account.id)).toBe("renewed-token");
  });

  it("drains manager account operations and renewal persistence without admitting new work", async () => {
    const account = await credentialAccount();
    await steamManager.start(account.id);
    const client = steamMock.instances.at(-1)!;
    let finishRenewal = () => {};
    client.steamBeeDrainRefreshTokens.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRenewal = resolve;
      }),
    );
    const shutdown = steamManager.shutdown();
    await expect(steamManager.start(account.id)).rejects.toThrow(
      "shutting down",
    );
    await expect(
      steamManager.runAccountOperation(account.id, async () => undefined),
    ).rejects.toThrow("shutting down");
    client.emit("steamBeeRefreshToken", renewedCredential);
    finishRenewal();
    await shutdown;
    expect(storedCredential(account.id)).toBe("renewed-token");
    expect(client.logOn).toHaveBeenCalledTimes(1);
  });

  it("retains the lease and listeners until the actual Steam transport is closed", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker({ ...account, status: "online" });
    const client = steamMock.instances.at(-1)!;
    let finishTransport = () => {};
    client.steamBeeLogOffAndDrain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          client.logOff();
          finishTransport = resolve;
        }),
    );
    const lease = { release: vi.fn() };
    const closing = closeWithLeaseCleanup(
      { close: () => worker.shutdown() },
      lease,
    );
    await vi.waitFor(() => expect(client.logOff).toHaveBeenCalledTimes(1));
    expect(lease.release).not.toHaveBeenCalled();
    expect(worker.currentStatus).toBe("online");
    expect(client.listenerCount("steamBeeRefreshToken")).toBe(1);
    finishTransport();
    await closing;
    expect(worker.currentStatus).toBe("disconnected");
    expect(client.listenerCount("steamBeeRefreshToken")).toBe(0);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it("persists a late transport-close credential before status, listeners and lease are finalized", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker({ ...account, status: "online" });
    const client = steamMock.instances.at(-1)!;
    let finishTransport = () => {};
    let finishPersistence = () => {};
    client.steamBeeLogOffAndDrain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishTransport = () => {
            client.emit("steamBeeRefreshToken", renewedCredential);
            client.emit("loggedOn");
            resolve();
          };
        }),
    );
    const statuses: string[] = [];
    worker.on("status", ({ status }) => statuses.push(status));
    const lease = {
      release: vi.fn(() => {
        expect(storedCredential(account.id)).toBe("renewed-token");
      }),
    };
    const closing = closeWithLeaseCleanup(
      { close: () => worker.shutdown() },
      lease,
    );
    await vi.waitFor(() =>
      expect(client.steamBeeLogOffAndDrain).toHaveBeenCalledTimes(1),
    );
    // Hold the new queue snapshot after the initial renewal drain has completed.
    (worker as unknown as { credentialQueue: Promise<void> }).credentialQueue =
      new Promise<void>((resolve) => {
        finishPersistence = resolve;
      });
    try {
      finishTransport();
      for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
      expect(lease.release).not.toHaveBeenCalled();
      expect(worker.currentStatus).toBe("online");
      expect(statuses).toEqual([]);
      expect(client.listenerCount("steamBeeRefreshToken")).toBe(1);
      expect(storedCredential(account.id)).toBe("previous-token");
      finishPersistence();
      await closing;
      expect(storedCredential(account.id)).toBe("renewed-token");
      expect(lease.release).toHaveBeenCalledTimes(1);
      expect(statuses).toEqual(["disconnected"]);
      expect(client.listenerCount("steamBeeRefreshToken")).toBe(0);
      expect(client.logOn).not.toHaveBeenCalled();
      expect(client.setPersona).not.toHaveBeenCalled();
      expect(
        client.gamesPlayed.mock.calls.every(([games]) => games.length === 0),
      ).toBe(true);
    } finally {
      finishPersistence();
      await closing;
    }
  });

  it("does not delete an account or replace its worker before transport closure", async () => {
    const account = await credentialAccount();
    await steamManager.start(account.id);
    const client = steamMock.instances.at(-1)!;
    let finishTransport = () => {};
    client.steamBeeLogOffAndDrain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishTransport = resolve;
        }),
    );
    const deleting = steamManager.deleteAccount(account.id);
    await vi.waitFor(() =>
      expect(client.steamBeeLogOffAndDrain).toHaveBeenCalledTimes(1),
    );
    expect(
      db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id))
        .get(),
    ).toBeDefined();
    expect(steamMock.instances).toHaveLength(1);
    finishTransport();
    await deleting;
    expect(
      db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id))
        .get(),
    ).toBeUndefined();
  });

  it("retains a quiesced worker after forget timeout instead of admitting a replacement", async () => {
    const account = await credentialAccount();
    await steamManager.start(account.id);
    const client = steamMock.instances.at(-1)!;
    let finishTransport = () => {};
    client.steamBeeLogOffAndDrain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishTransport = resolve;
        }),
    );
    vi.useFakeTimers();
    try {
      const forgotten = steamManager.forget(account.id);
      const rejected =
        expect(forgotten).rejects.toBeInstanceOf(ShutdownTimeoutError);
      await vi.advanceTimersByTimeAsync(25_000);
      await rejected;
      await expect(steamManager.start(account.id)).rejects.toThrow(
        "shutting down",
      );
      expect(steamMock.instances).toHaveLength(1);
      expect(
        db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, account.id))
          .get(),
      ).toBeDefined();
      finishTransport();
      await steamManager.shutdown();
    } finally {
      finishTransport();
      vi.useRealTimers();
    }
  });

  it("keeps the shared deadline and lease when a Steam transport never closes", async () => {
    const account = await credentialAccount();
    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1)!;
    let finishTransport = () => {};
    client.steamBeeLogOffAndDrain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishTransport = resolve;
        }),
    );
    const lease = { release: vi.fn() };
    vi.useFakeTimers();
    try {
      const closing = closeWithLeaseCleanup(
        { close: () => worker.shutdown() },
        lease,
      );
      const rejected =
        expect(closing).rejects.toBeInstanceOf(ShutdownTimeoutError);
      await vi.advanceTimersByTimeAsync(25_000);
      await rejected;
      expect(lease.release).not.toHaveBeenCalled();
      expect(client.listenerCount("steamBeeRefreshToken")).toBe(1);
      await expect(worker.start()).rejects.toThrow("shutting down");
      finishTransport();
      await worker.shutdown();
      expect(lease.release).not.toHaveBeenCalled();
    } finally {
      finishTransport();
      vi.useRealTimers();
    }
  });

  it("pauses without forcing another Steam session off", async () => {
    const now = Date.now();
    const account = {
      id: crypto.randomUUID(),
      accountName: `worker-${now}`,
      steamId: null,
      status: "online",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      tokenKeyVersion: 1,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(steamAccount).values(account);
    await db.insert(steamAccountGame).values({
      accountId: account.id,
      appId: 730,
      enabled: true,
      source: "manual",
      createdAt: now,
    });

    const worker = new SteamWorker(account);
    await worker.pause();

    const client = steamMock.instances.at(-1);
    expect(client?.gamesPlayed).toHaveBeenCalledWith([]);
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([], true);
  });

  it("keeps the safety hold and still logs off when clearing games fails", async () => {
    const now = Date.now();
    const account = {
      id: crypto.randomUUID(),
      accountName: `safety-hard-stop-${now}`,
      steamId: null,
      status: "boosting",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      tokenKeyVersion: 1,
      lastError: null,
      latestBoostStartedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(steamAccount).values(account);
    await setSafetyHold(account.id, "session_limit");
    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1);
    client?.gamesPlayed.mockImplementationOnce(() => {
      throw new Error("gamesPlayed failed");
    });

    await expect(
      worker.forceDisconnectForSafety("Safety fallback"),
    ).rejects.toThrow("gamesPlayed failed");

    expect(client?.gamesPlayed).toHaveBeenCalledWith([]);
    expect(client?.logOff).toHaveBeenCalledTimes(1);
    expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
      "session_limit",
    );
    const [updated] = await db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.id, account.id));
    expect(updated).toMatchObject({
      desiredState: "paused",
      status: "paused_manual",
    });
  });

  it("shuts down without changing the desired running state", async () => {
    const now = Date.now();
    const account = {
      id: crypto.randomUUID(),
      accountName: `shutdown-${now}`,
      steamId: null,
      status: "boosting",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      tokenKeyVersion: 1,
      lastError: null,
      latestBoostStartedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(steamAccount).values(account);
    const worker = new SteamWorker(account);
    await worker.shutdown();

    const client = steamMock.instances.at(-1);
    expect(client?.gamesPlayed).toHaveBeenCalledWith([]);
    expect(client?.logOff).toHaveBeenCalled();

    const [updatedAccount] = await db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.id, account.id));
    expect(updatedAccount).toMatchObject({
      status: "disconnected",
      desiredState: "running",
    });
  });

  it("treats parallel starts as idempotent", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `idempotent-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(steamAccount).values(account);

    const worker = new SteamWorker(account);
    await Promise.all([worker.start(), worker.start()]);

    const client = steamMock.instances.at(-1);
    expect(client?.logOn).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it("keeps increasing reconnect backoff until login succeeds", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `backoff-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(steamAccount).values(account);

    const worker = new SteamWorker(account);
    await worker.start();
    const client = steamMock.instances.at(-1);
    client?.emit("error", new Error("first network failure"));
    client?.emit("error", new Error("second network failure"));

    await vi.waitFor(() => {
      const reconnectDelays = timeoutSpy.mock.calls
        .map((call) => Number(call[1]))
        .filter((delay) => delay >= 20_000);
      expect(reconnectDelays).toHaveLength(2);
      expect(reconnectDelays[0]).toBeGreaterThanOrEqual(20_000);
      expect(reconnectDelays[0]).toBeLessThan(22_500);
      expect(reconnectDelays[1]).toBeGreaterThanOrEqual(40_000);
      expect(reconnectDelays[1]).toBeLessThan(42_500);
    });

    await worker.stop();
    timeoutSpy.mockRestore();
  });

  it("does not run an admitted reconnect after an explicit stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 6, 8, 10, 0));
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `stale-reconnect-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    let holdAccountOperations = false;
    let releaseReconnect = () => {};
    let markReconnectAdmitted = () => {};
    const reconnectGate = new Promise<void>((resolve) => {
      releaseReconnect = resolve;
    });
    const reconnectAdmitted = new Promise<void>((resolve) => {
      markReconnectAdmitted = resolve;
    });
    const accountOperations: Promise<unknown>[] = [];
    const runAccountOperation = <T>(operation: () => Promise<T>) => {
      const pending = (async () => {
        if (holdAccountOperations) {
          markReconnectAdmitted();
          await reconnectGate;
        }
        return operation();
      })();
      accountOperations.push(pending);
      return pending;
    };

    try {
      await db.insert(steamAccount).values(account);
      const worker = new SteamWorker(account, { runAccountOperation });
      await worker.start();
      const client = steamMock.instances.at(-1);
      client?.emit("error", new Error("Temporary Steam network failure"));
      await accountOperations[0];

      holdAccountOperations = true;
      await vi.advanceTimersByTimeAsync(20_000);
      await reconnectAdmitted;
      await worker.stop();
      releaseReconnect();
      await accountOperations[1];

      expect(client?.logOn).toHaveBeenCalledTimes(1);
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(updated).toMatchObject({
        desiredState: "stopped",
        status: "disconnected",
      });
      await worker.shutdown();
    } finally {
      releaseReconnect();
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([6, 34, 50])(
    "retries session conflict result %i without changing desired state",
    async (eresult) => {
      const now = Date.now();
      const encrypted = encryptSecret("refresh-token");
      const account = {
        id: crypto.randomUUID(),
        accountName: `session-replaced-${now}`,
        steamId: null,
        status: "disconnected",
        desiredState: "stopped",
        personaState: 7,
        customTitle: null,
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
        tokenExpiresAt: null,
        tokenKeyVersion: encrypted.keyVersion,
        lastError: null,
        latestBoostStartedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(steamAccount).values(account);

      const worker = new SteamWorker(account);
      await worker.start();
      const client = steamMock.instances.at(-1);
      client?.emit(
        "error",
        Object.assign(new Error("Logged in elsewhere"), { eresult }),
      );

      await vi.waitFor(async () => {
        const [updatedAccount] = await db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, account.id));
        const [health] = await db
          .select()
          .from(accountHealthState)
          .where(eq(accountHealthState.accountId, account.id));
        expect(updatedAccount).toMatchObject({
          status: "reconnecting",
          desiredState: "running",
        });
        expect(health).toMatchObject({
          retryAttempt: 1,
          errorClass: "session_replaced",
          errorCode: eresult,
          recoveryAction: "retry",
        });
        expect(health?.nextRetryAt).toBeGreaterThanOrEqual(now + 5 * 60_000);
      });

      expect(client?.logOn).toHaveBeenCalledTimes(1);
      await worker.shutdown();
    },
  );

  it("uses 5m, 5m and 60m conflict retries and deduplicates callbacks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 6, 8, 10, 0));
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `session-cycle-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const conflicts = vi.fn(async () => undefined);
    try {
      await db.insert(steamAccount).values(account);
      const worker = new SteamWorker(account, {
        recordSessionConflict: conflicts,
      });
      await worker.start();
      const client = steamMock.instances.at(-1);

      client?.emit("error", { eresult: 34 });
      client?.emit("disconnected");
      await vi.waitFor(() => expect(conflicts).toHaveBeenCalledTimes(1));
      expect(conflicts).toHaveBeenLastCalledWith(
        expect.objectContaining({ attempt: 1, cooldown: false }),
      );

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(client?.logOn).toHaveBeenCalledTimes(2);
      client?.emit("error", { eresult: 34 });
      await vi.waitFor(() => expect(conflicts).toHaveBeenCalledTimes(2));
      expect(conflicts).toHaveBeenLastCalledWith(
        expect.objectContaining({ attempt: 2, cooldown: false }),
      );

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(client?.logOn).toHaveBeenCalledTimes(3);
      client?.emit("error", { eresult: 34 });
      await vi.waitFor(() => expect(conflicts).toHaveBeenCalledTimes(3));
      expect(conflicts).toHaveBeenLastCalledWith(
        expect.objectContaining({ attempt: 3, cooldown: true }),
      );

      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(client?.logOn).toHaveBeenCalledTimes(4);
      client?.emit("error", { eresult: 34 });
      await vi.waitFor(() => expect(conflicts).toHaveBeenCalledTimes(4));
      expect(conflicts).toHaveBeenLastCalledWith(
        expect.objectContaining({ attempt: 1, cooldown: false }),
      );
      await worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not run an admitted session-conflict retry after pause", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 6, 8, 10, 0));
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `stale-session-conflict-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    let holdAccountOperations = false;
    let releaseRetry = () => {};
    let markRetryAdmitted = () => {};
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const retryAdmitted = new Promise<void>((resolve) => {
      markRetryAdmitted = resolve;
    });
    const operations: Promise<unknown>[] = [];
    const runAccountOperation = <T>(operation: () => Promise<T>) => {
      const pending = (async () => {
        if (holdAccountOperations) {
          markRetryAdmitted();
          await retryGate;
        }
        return operation();
      })();
      operations.push(pending);
      return pending;
    };

    try {
      await db.insert(steamAccount).values(account);
      const worker = new SteamWorker(account, { runAccountOperation });
      await worker.start();
      const client = steamMock.instances.at(-1);
      client?.emit("error", { eresult: 34 });
      await operations[0];

      holdAccountOperations = true;
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await retryAdmitted;
      await worker.pause();
      releaseRetry();
      await operations[1];

      expect(client?.logOn).toHaveBeenCalledTimes(1);
      const [health] = await db
        .select()
        .from(accountHealthState)
        .where(eq(accountHealthState.accountId, account.id));
      expect(health).toMatchObject({
        retryAttempt: 0,
        errorClass: "none",
        recoveryAction: "none",
      });
      await worker.shutdown();
    } finally {
      releaseRetry();
      vi.useRealTimers();
    }
  });

  it("starts a new conflict cycle at attempt one after manager restart", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `session-conflict-restart-${now}`,
      steamId: null,
      status: "reconnecting",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(accountHealthState).values({
        accountId: account.id,
        nextRetryAt: now + 60 * 60_000,
        retryAttempt: 3,
        errorClass: "session_replaced",
        errorCode: 34,
        recoveryAction: "wait",
        updatedAt: now,
      });

      await steamManager.init();
      const client = steamMock.instances.at(-1);
      await vi.waitFor(() => expect(client?.logOn).toHaveBeenCalledTimes(1));
      client?.emit("error", { eresult: 34 });

      await vi.waitFor(async () => {
        const [health] = await db
          .select()
          .from(accountHealthState)
          .where(eq(accountHealthState.accountId, account.id));
        expect(health).toMatchObject({
          retryAttempt: 1,
          errorClass: "session_replaced",
          recoveryAction: "retry",
        });
      });
    } finally {
      await steamManager.shutdown();
    }
  });

  it("requires a fresh login before boosting after a terminal error", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `terminal-resume-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(steamAccount).values(account);
    await db.insert(steamAccountGame).values({
      accountId: account.id,
      appId: 730,
      enabled: true,
      source: "manual",
      createdAt: now,
    });

    const worker = new SteamWorker(account);
    await worker.start();
    const client = steamMock.instances.at(-1);
    client?.emit("loggedOn");
    await vi.waitFor(() =>
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]),
    );
    client?.gamesPlayed.mockClear();

    client?.emit(
      "error",
      Object.assign(new Error("Invalid password"), { eresult: 5 }),
    );
    await vi.waitFor(async () => {
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(updated).toMatchObject({
        desiredState: "paused",
        status: "login_required",
      });
    });

    await worker.resume();
    expect(client?.logOn).toHaveBeenCalledTimes(2);
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([730]);

    client?.emit("loggedOn");
    await vi.waitFor(() =>
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]),
    );
    await worker.shutdown();
  });

  it("keeps terminal recovery when a stale loggedOn event is queued", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `stale-logged-on-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(steamAccount).values(account);
    await db.insert(steamAccountGame).values({
      accountId: account.id,
      appId: 730,
      enabled: true,
      source: "manual",
      createdAt: now,
    });

    const worker = new SteamWorker(account);
    await worker.start();
    const client = steamMock.instances.at(-1);
    client?.emit(
      "error",
      Object.assign(new Error("Invalid password"), { eresult: 5 }),
    );
    client?.emit("loggedOn");

    await vi.waitFor(async () => {
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      const [health] = await db
        .select()
        .from(accountHealthState)
        .where(eq(accountHealthState.accountId, account.id));
      expect(updated).toMatchObject({
        desiredState: "paused",
        status: "login_required",
      });
      expect(health?.recoveryAction).toBe("reauthenticate");
    });
    expect(client?.setPersona).not.toHaveBeenCalled();
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([730]);
    expect(client?.logOn).toHaveBeenCalledTimes(1);
    await worker.shutdown();
  });

  it("keeps terminal recovery paused when a later schedule becomes active", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 6, 8, 9, 30);
    const scheduledAt = Date.UTC(2026, 6, 8, 10, 30);
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `terminal-schedule-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const presetId = crypto.randomUUID();
    const scheduleId = crypto.randomUUID();

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });
      await db.insert(boostPreset).values({
        id: presetId,
        accountId: account.id,
        name: "Terminal recovery preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId: account.id,
        presetId,
        name: "Later schedule",
        enabled: true,
        weekdaysJson: `[${new Date(scheduledAt).getUTCDay()}]`,
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
        createdAt: now,
        updatedAt: now,
      });

      await steamManager.start(account.id);
      const client = steamMock.instances.at(-1);
      client?.emit(
        "error",
        Object.assign(new Error("Invalid password"), { eresult: 5 }),
      );
      await vi.waitFor(async () => {
        const [updated] = await db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, account.id));
        const [health] = await db
          .select()
          .from(accountHealthState)
          .where(eq(accountHealthState.accountId, account.id));
        expect(updated).toMatchObject({
          desiredState: "paused",
          status: "login_required",
        });
        expect(health?.recoveryAction).toBe("reauthenticate");
      });

      vi.setSystemTime(scheduledAt);
      await steamManager.tickSchedules(new Date(scheduledAt));

      expect(client?.logOn).toHaveBeenCalledTimes(1);
      const [schedule] = await db
        .select()
        .from(boostSchedule)
        .where(eq(boostSchedule.id, scheduleId));
      expect(schedule?.lastStartedWindow).toBeNull();
      const [heldAccount] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(heldAccount?.desiredState).toBe("paused");
    } finally {
      await steamManager.shutdown();
      vi.useRealTimers();
    }
  });

  it("serializes a terminal event arriving during scheduled preset application", async () => {
    const activeAt = new Date(Date.UTC(2026, 6, 8, 10, 30));
    const now = activeAt.getTime();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `terminal-schedule-race-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const presetId = crypto.randomUUID();
    const scheduleId = crypto.randomUUID();
    let releasePreset = () => {};
    let tick: Promise<void> | undefined;
    const originalUpdateAccount = SteamWorker.prototype.updateAccount;
    let markPresetBlocked = () => {};
    const presetBlocked = new Promise<void>((resolve) => {
      markPresetBlocked = resolve;
    });
    const presetGate = new Promise<void>((resolve) => {
      releasePreset = resolve;
    });
    const updateSpy = vi
      .spyOn(SteamWorker.prototype, "updateAccount")
      .mockImplementation(async function (updatedAccount) {
        markPresetBlocked();
        await presetGate;
        return originalUpdateAccount.call(this, updatedAccount);
      });

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(boostPreset).values({
        id: presetId,
        accountId: account.id,
        name: "Terminal race preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId: account.id,
        presetId,
        name: "Terminal race schedule",
        enabled: true,
        weekdaysJson: `[${activeAt.getUTCDay()}]`,
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
        createdAt: now,
        updatedAt: now,
      });

      await steamManager.start(account.id);
      const client = steamMock.instances.at(-1);
      tick = steamManager.tickSchedules(activeAt);
      await presetBlocked;

      client?.emit(
        "error",
        Object.assign(new Error("Invalid password"), { eresult: 5 }),
      );
      await Promise.resolve();
      const [healthWhileBlocked] = await db
        .select()
        .from(accountHealthState)
        .where(eq(accountHealthState.accountId, account.id));
      expect(healthWhileBlocked?.recoveryAction).toBe("none");

      releasePreset();
      await tick;
      await vi.waitFor(async () => {
        const [updated] = await db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, account.id));
        const [health] = await db
          .select()
          .from(accountHealthState)
          .where(eq(accountHealthState.accountId, account.id));
        expect(updated).toMatchObject({
          desiredState: "paused",
          status: "login_required",
        });
        expect(health?.recoveryAction).toBe("reauthenticate");
      });

      const logOnCalls = client?.logOn.mock.calls.length ?? 0;
      await steamManager.tickSchedules(activeAt);
      expect(client?.logOn).toHaveBeenCalledTimes(logOnCalls);
      const [held] = await db
        .select()
        .from(accountHealthState)
        .where(eq(accountHealthState.accountId, account.id));
      expect(held?.recoveryAction).toBe("reauthenticate");
    } finally {
      releasePreset();
      await tick?.catch(() => undefined);
      updateSpy.mockRestore();
      await steamManager.shutdown();
    }
  });

  it("resumes an unscheduled account when pause-until expires", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `pause-until-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });
      await steamManager.start(account.id);
      const client = steamMock.instances.at(-1);
      client?.emit("loggedOn");
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]),
      );

      await steamManager.pauseUntil(account.id, now + 60_000);
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]);

      await vi.advanceTimersByTimeAsync(60_001);
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]),
      );
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(updated?.desiredState).toBe("running");
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBeNull();
    } finally {
      await steamManager.shutdown();
      vi.useRealTimers();
    }
  });

  it("restores pause-until expiry after a manager restart", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `pause-until-restart-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.insert(steamAccount).values(account);
      await steamManager.start(account.id);
      const originalClient = steamMock.instances.at(-1);
      originalClient?.emit("loggedOn");
      await vi.waitFor(() =>
        expect(originalClient?.logOn).toHaveBeenCalledTimes(1),
      );
      await steamManager.pauseUntil(account.id, now + 60_000);
      await steamManager.shutdown();

      await steamManager.init();
      const restartedClient = steamMock.instances.at(-1);
      expect(restartedClient).not.toBe(originalClient);
      expect(restartedClient?.logOn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_001);
      await vi.waitFor(() =>
        expect(restartedClient?.logOn).toHaveBeenCalledTimes(1),
      );
    } finally {
      await steamManager.shutdown();
      vi.useRealTimers();
    }
  });

  it("reconciles an expired schedule window before startup auto-login", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 6, 9, 12, 0);
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `expired-startup-window-${now}`,
      steamId: null,
      status: "boosting",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: now - 60_000,
      createdAt: now,
      updatedAt: now,
    };
    const presetId = crypto.randomUUID();
    const scheduleId = crypto.randomUUID();
    const expiredWindow = `${scheduleId}:2026-07-08:10:00-11:00`;

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(boostPreset).values({
        id: presetId,
        accountId: account.id,
        name: "Expired startup preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId: account.id,
        presetId,
        name: "Expired startup schedule",
        enabled: true,
        weekdaysJson: `[${new Date(now - 24 * 60 * 60_000).getUTCDay()}]`,
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
        lastStartedWindow: expiredWindow,
        lastStoppedWindow: null,
        createdAt: now,
        updatedAt: now,
      });

      await steamManager.init();

      const client = steamMock.instances.at(-1);
      expect(client?.logOn).not.toHaveBeenCalled();
      expect(client?.gamesPlayed).toHaveBeenCalledWith([]);
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      const [schedule] = await db
        .select()
        .from(boostSchedule)
        .where(eq(boostSchedule.id, scheduleId));
      expect(updated).toMatchObject({
        desiredState: "paused",
        status: "paused_manual",
      });
      expect(schedule?.lastStoppedWindow).toBe(expiredWindow);
    } finally {
      await steamManager.shutdown();
      vi.useRealTimers();
    }
  });

  it("persists attention and blocks restart when both safety stops fail", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `safety-double-failure-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.insert(steamAccount).values(account);
      await steamManager.start(account.id);
      const client = steamMock.instances.at(-1);
      client?.gamesPlayed.mockImplementation(() => {
        throw new Error("gamesPlayed failed");
      });
      client?.logOff.mockImplementation(() => {
        throw new Error("logOff failed");
      });

      await expect(
        steamManager.pauseUntil(account.id, now + 60_000),
      ).rejects.toThrow("gamesPlayed failed");

      expect(client?.gamesPlayed).toHaveBeenCalledWith([]);
      expect(client?.logOff).toHaveBeenCalledTimes(1);
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
        "safety_failure",
      );
      const [health] = await db
        .select()
        .from(accountHealthState)
        .where(eq(accountHealthState.accountId, account.id));
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      const failureEvents = await db
        .select()
        .from(steamEvent)
        .where(eq(steamEvent.type, "steam.safety.failure"));
      expect(health?.recoveryAction).toBe("attention");
      expect(updated).toMatchObject({
        desiredState: "paused",
        status: "error",
      });
      expect(failureEvents).toHaveLength(1);

      client?.gamesPlayed.mockImplementation(() => undefined);
      client?.logOff.mockImplementation(() => undefined);
      await steamManager.shutdown();
      await steamManager.init();
      const restartedClient = steamMock.instances.at(-1);
      expect(restartedClient).not.toBe(client);
      expect(restartedClient?.logOn).not.toHaveBeenCalled();
    } finally {
      await steamManager.shutdown();
    }
  });

  it("uses the loaded worker for the safety fallback when a second lookup fails", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `safety-loaded-worker-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const managerInternals = steamManager as unknown as {
      getWorkerForAccount(accountId: string): Promise<SteamWorker>;
    };
    await db.insert(steamAccount).values(account);
    await steamManager.start(account.id);
    const originalGetWorker =
      managerInternals.getWorkerForAccount.bind(steamManager);
    const workerLookup = vi
      .spyOn(managerInternals, "getWorkerForAccount")
      .mockImplementationOnce(originalGetWorker)
      .mockRejectedValueOnce(new Error("database unavailable"));

    try {
      const client = steamMock.instances.at(-1);
      client?.gamesPlayed.mockImplementationOnce(() => {
        throw new Error("initial pause failed");
      });

      await expect(
        steamManager.pauseUntil(account.id, now + 60_000),
      ).resolves.toBeUndefined();

      expect(workerLookup).toHaveBeenCalledTimes(1);
      expect(client?.gamesPlayed).toHaveBeenCalledTimes(2);
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect(client?.logOff).toHaveBeenCalledTimes(1);
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
        "pause_until",
      );
    } finally {
      workerLookup.mockRestore();
      await steamManager.shutdown();
    }
  });

  it("does not resume pause-until after its owning schedule is deleted", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 6, 8, 10, 30);
    const resumeAt = Date.UTC(2026, 6, 8, 11, 5);
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `pause-until-after-window-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });
      const presetId = crypto.randomUUID();
      const scheduleId = crypto.randomUUID();
      const windowId = `${scheduleId}:2026-07-08:10:00-11:00`;
      await db.insert(boostPreset).values({
        id: presetId,
        accountId: account.id,
        name: "Pause-until owner preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId: account.id,
        presetId,
        name: "Pause-until owner schedule",
        enabled: true,
        weekdaysJson: `[${new Date(now).getUTCDay()}]`,
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
        lastStartedWindow: windowId,
        createdAt: now,
        updatedAt: now,
      });

      await steamManager.start(account.id);
      const client = steamMock.instances.at(-1);
      client?.emit("loggedOn");
      await vi.waitFor(() => expect(boostCallCount(client)).toBe(1));
      await steamManager.pauseUntil(account.id, resumeAt);
      expect(await getSafetyHoldOwner(account.id)).toEqual({
        kind: "scheduled",
        scheduleId,
        windowId,
      });
      await db.delete(boostSchedule).where(eq(boostSchedule.id, scheduleId));

      await vi.advanceTimersByTimeAsync(resumeAt - now + 1);
      await vi.waitFor(async () =>
        expect(
          (await getAccountSafetyPolicy(account.id)).holdReason,
        ).toBeNull(),
      );
      const [pausedAccount] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(pausedAccount?.desiredState).toBe("paused");
      expect(boostCallCount(client)).toBe(1);
    } finally {
      await steamManager.shutdown();
      vi.useRealTimers();
    }
  });

  it("auto-imports the account library after the worker logs on", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `auto-import-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(steamAccount).values(account);
    await steamManager.start(account.id);

    const client = steamMock.instances.at(-1);
    client?.getUserOwnedApps.mockResolvedValueOnce({
      apps: [{ appid: 730, name: "Counter-Strike 2", playtime_forever: 42 }],
    });
    client?.emit("loggedOn");

    await vi.waitFor(async () => {
      const apps = await db
        .select()
        .from(steamAccountLibrary)
        .where(eq(steamAccountLibrary.accountId, account.id));
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({
        accountId: account.id,
        appId: 730,
        playtimeForever: 42,
      });
    });

    const [updatedAccount] = await db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.id, account.id));
    expect(updatedAccount?.steamId).toBe("76561198000000001");
  });

  it("removes a worker even when stopping it fails", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `forget-failure-${now}`,
      steamId: null,
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(steamAccount).values(account);
    await steamManager.start(account.id);
    const instanceCount = steamMock.instances.length;
    const stopSpy = vi
      .spyOn(SteamWorker.prototype, "stop")
      .mockRejectedValueOnce(new Error("stop failed"));
    const shutdownSpy = vi.spyOn(SteamWorker.prototype, "shutdown");

    await expect(steamManager.forget(account.id)).rejects.toThrow(
      "stop failed",
    );
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    stopSpy.mockRestore();
    shutdownSpy.mockRestore();

    await steamManager.start(account.id);
    expect(steamMock.instances).toHaveLength(instanceCount + 1);
    await steamManager.forget(account.id);
  });

  it("removes workers even when graceful shutdown fails", async () => {
    const now = Date.now();
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `shutdown-failure-${now}`,
      steamId: null,
      status: "boosting",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenExpiresAt: null,
      tokenKeyVersion: encrypted.keyVersion,
      lastError: null,
      latestBoostStartedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(steamAccount).values(account);
    await steamManager.start(account.id);
    await steamManager.runAccountOperation(account.id, async () => undefined);
    await db.insert(boostSession).values({
      id: crypto.randomUUID(),
      accountId: account.id,
      presetId: null,
      appIdsJson: "[]",
      startedAt: now,
      endedAt: null,
      stopReason: null,
      createdAt: now,
    });
    const instanceCount = steamMock.instances.length;
    const shutdownSpy = vi
      .spyOn(SteamWorker.prototype, "shutdown")
      .mockRejectedValueOnce(new Error("shutdown failed"));

    const shutdown = steamManager.shutdown();
    expect(steamManager.shutdown()).toBe(shutdown);
    await expect(shutdown).rejects.toThrow(
      "One or more Steam workers failed to shut down cleanly.",
    );
    shutdownSpy.mockRestore();

    const [closedSession] = await db
      .select()
      .from(boostSession)
      .where(eq(boostSession.accountId, account.id));
    expect(closedSession).toMatchObject({
      endedAt: expect.any(Number),
      stopReason: "disconnected",
    });

    await steamManager.start(account.id);
    expect(steamMock.instances).toHaveLength(instanceCount + 1);
    await steamManager.forget(account.id);
  });

  it("preserves library metadata when Steam apps are re-imported", async () => {
    const now = Date.now();
    const account = {
      id: crypto.randomUUID(),
      accountName: `meta-import-${now}`,
      steamId: "76561198000000001",
      status: "online",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      tokenKeyVersion: 1,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(steamAccount).values(account);
    await db.insert(steamAppCache).values({
      appId: 730,
      name: "Counter-Strike 2",
      playtimeForever: 10,
      source: "library",
      updatedAt: now,
    });
    await db.insert(steamAccountLibrary).values({
      accountId: account.id,
      appId: 730,
      playtimeForever: 10,
      source: "library",
      favorite: true,
      hidden: true,
      tagsJson: JSON.stringify(["fps", "idle"]),
      importedAt: now,
    });

    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1);
    client?.getUserOwnedApps.mockResolvedValueOnce({
      apps: [{ appid: 730, name: "Counter-Strike 2", playtime_forever: 99 }],
    });

    await worker.importLibrary();

    const [libraryEntry] = await db
      .select()
      .from(steamAccountLibrary)
      .where(eq(steamAccountLibrary.accountId, account.id));
    expect(libraryEntry).toMatchObject({
      appId: 730,
      playtimeForever: 99,
      favorite: true,
      hidden: true,
      tagsJson: JSON.stringify(["fps", "idle"]),
    });
  });

  it("pauses on blocked playingState and resumes only when the account is free", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const account = {
      id: crypto.randomUUID(),
      accountName: `blocked-${now}`,
      steamId: "76561198000000001",
      status: "online",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      tokenKeyVersion: 1,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(steamAccount).values(account);
    await db.insert(steamAccountGame).values({
      accountId: account.id,
      appId: 730,
      enabled: true,
      source: "manual",
      createdAt: now,
    });

    const worker = new SteamWorker(account);
    const client = steamMock.instances.at(-1);
    client?.emit("loggedOn");
    await vi.waitFor(() => expect(worker.isConnected).toBe(true));
    await worker.updateAccount(account);
    expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]);

    client?.emit("playingState", true);
    await vi.waitFor(() => {
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]);
    });

    client?.emit("playingState", false);
    await vi.waitFor(() => {
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]);
    });
    const boostCallsAfterRelease = boostCallCount(client);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(boostCallCount(client)).toBe(boostCallsAfterRelease);
    const [health] = await db
      .select()
      .from(accountHealthState)
      .where(eq(accountHealthState.accountId, account.id));
    expect(health).toMatchObject({
      retryAttempt: 0,
      errorClass: "none",
      recoveryAction: "none",
    });
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([730], true);
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([], true);
    vi.useRealTimers();
  });

  it("starts a fresh live-conflict cycle after pause and resume", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const account = {
      id: crypto.randomUUID(),
      accountName: `blocked-resume-${now}`,
      steamId: "76561198000000001",
      status: "online",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      tokenKeyVersion: 1,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });

      const worker = new SteamWorker(account);
      const client = steamMock.instances.at(-1);
      client?.emit("loggedOn");
      await vi.waitFor(() => expect(worker.isConnected).toBe(true));
      await worker.updateAccount(account);

      client?.emit("playingState", true);
      await vi.waitFor(async () => {
        const [health] = await db
          .select()
          .from(accountHealthState)
          .where(eq(accountHealthState.accountId, account.id));
        expect(health).toMatchObject({
          retryAttempt: 1,
          errorClass: "session_replaced",
          recoveryAction: "retry",
        });
      });

      await worker.pause();
      await worker.resume();
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]);

      client?.emit("playingState", true);
      await vi.waitFor(async () => {
        const [health] = await db
          .select()
          .from(accountHealthState)
          .where(eq(accountHealthState.accountId, account.id));
        expect(health).toMatchObject({
          retryAttempt: 1,
          errorClass: "session_replaced",
          recoveryAction: "retry",
        });
        expect(health?.nextRetryAt).toBe(health!.updatedAt + 5 * 60_000);
      });

      await worker.pause();
    } finally {
      vi.useRealTimers();
    }
  });
  describe("card farming integration", () => {
    afterEach(async () => {
      vi.restoreAllMocks();
      await steamManager.shutdown();
      vi.useRealTimers();
    });

    it("clears reported activity and Community access after a transient Steam error until login succeeds", async () => {
      const account = await farmingAccount();
      const worker = new SteamWorker(account);
      const client = steamMock.instances.at(-1)!;
      try {
        client.emit("loggedOn");
        await flushWorkerEvents(worker);
        expect(worker.getActivity()).toEqual({
          activityMode: "manual",
          activeAppIds: [440, 730],
        });

        // steam-user can close its transport with _disconnect(true) and emit
        // only error; a later disconnected event is not guaranteed.
        client.emit(
          "error",
          Object.assign(new Error("Connection lost"), { eresult: 2 }),
        );
        await flushWorkerEvents(worker);

        expect(worker.isConnected).toBe(false);
        expect(worker.currentStatus).toBe("error");
        expect(worker.getActivity()).toEqual({
          activityMode: "idle",
          activeAppIds: [],
        });
        await expect(worker.getCommunitySession()).rejects.toThrow(
          "Connect the Steam account",
        );

        await worker.start();
        expect(worker.currentStatus).toBe("connecting");
        expect(worker.getActivity()).toEqual({
          activityMode: "idle",
          activeAppIds: [],
        });
        client.emit("loggedOn");
        await flushWorkerEvents(worker);
        expect(worker.isConnected).toBe(true);
        expect(worker.getActivity()).toEqual({
          activityMode: "manual",
          activeAppIds: [440, 730],
        });
      } finally {
        await worker.shutdown();
      }
    });

    it("reports effective games and emits farming target changes while the status stays boosting", async () => {
      const account = await farmingAccount();
      const worker = new SteamWorker(account);
      const client = steamMock.instances.at(-1)!;
      const statuses = vi.fn();
      worker.on("status", statuses);
      try {
        client.emit("loggedOn");
        await flushWorkerEvents(worker);
        expect(worker.getActivity()).toEqual({
          activityMode: "manual",
          activeAppIds: [440, 730],
        });
        await worker.applyFarmingSelection([570]);
        await worker.applyFarmingSelection([10]);
        expect(worker.getActivity()).toEqual({
          activityMode: "farming",
          activeAppIds: [10],
        });
        expect(statuses).toHaveBeenLastCalledWith(
          expect.objectContaining({
            status: "boosting",
            activityMode: "farming",
            activeAppIds: [10],
          }),
        );
        expect(
          statuses.mock.calls.some(
            ([payload]) =>
              payload.activityMode === "farming" &&
              payload.activeAppIds[0] === 570,
          ),
        ).toBe(true);
        expect(
          selectedGames(account.id)
            .filter((game) => game.enabled)
            .map((game) => game.appId),
        ).toEqual([440, 730]);
        await worker.pause();
        expect(worker.getActivity()).toEqual({
          activityMode: "idle",
          activeAppIds: [],
        });
      } finally {
        await worker.shutdown();
      }
    });

    it("reserves farming mode and clears manual games before badge discovery", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);
      await steamManager.beginFarming(account.id);
      expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect(steamManager.getActivity(account.id)).toEqual({
        activityMode: "farming",
        activeAppIds: [],
      });
      expect(
        selectedGames(account.id)
          .filter((game) => game.enabled)
          .map((game) => game.appId),
      ).toEqual([440, 730]);
      await steamManager.endFarming(account.id);
      expect(steamManager.getActivity(account.id)).toEqual({
        activityMode: "idle",
        activeAppIds: [],
      });
    });

    it("does not pause manual idling when a read-only farming preview is stopped", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      client.gamesPlayed.mockClear();
      await steamManager.endFarming(account.id);
      expect(client.gamesPlayed).not.toHaveBeenCalled();
      expect(steamManager.getActivity(account.id)).toEqual({
        activityMode: "manual",
        activeAppIds: [440, 730],
      });
    });

    it("discards an obsolete queued farming cleanup after a newer manual resume", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);
      let release!: () => void;
      const barrier = steamManager.runAccountOperation(
        account.id,
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      let current = true;
      const ending = steamManager.endFarming(account.id, () => current);
      current = false;
      const resuming = steamManager.resume(account.id);
      client.gamesPlayed.mockClear();
      release();
      await Promise.all([barrier, ending, resuming]);
      expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);
      expect(client.gamesPlayed).not.toHaveBeenCalledWith([]);
      expect(steamManager.getActivity(account.id)).toEqual({
        activityMode: "manual",
        activeAppIds: [440, 730],
      });
    });

    it.each(["pause", "stop", "deleteAccount"] as const)(
      "stops market batches immediately before queued %s",
      async (command) => {
        const account = await farmingAccount();
        await connectManagedFarmingAccount(account.id);
        let release!: () => void;
        const barrier = steamManager.runAccountOperation(
          account.id,
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        );
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        const stopBatches = vi.spyOn(inventoryMarket, "stopAccountBatches");
        const operation = steamManager[command](account.id);
        expect(stopBatches).toHaveBeenCalledWith(account.id);
        release();
        await Promise.all([barrier, operation]);
      },
    );

    it("uses an ephemeral farming selection and preserves the manual game configuration", async () => {
      const account = await farmingAccount();
      const worker = new SteamWorker(account);
      const client = steamMock.instances.at(-1)!;
      try {
        client.emit("loggedOn");
        await flushWorkerEvents(worker);
        const manualSelection = selectedGames(account.id);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);

        await worker.applyFarmingSelection([570, 10]);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([570, 10]);
        expect(selectedGames(account.id)).toEqual(manualSelection);

        worker.clearFarmingSelection();
        await worker.updateAccount(account);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);
        expect(selectedGames(account.id)).toEqual(manualSelection);
      } finally {
        await worker.shutdown();
      }
    });

    it("enforces the reduced custom-title game limit before changing the farming payload", async () => {
      const account = await farmingAccount("My title");
      const worker = new SteamWorker(account);
      const client = steamMock.instances.at(-1)!;
      try {
        client.emit("loggedOn");
        await flushWorkerEvents(worker);
        const callsBefore = client.gamesPlayed.mock.calls.length;
        await expect(
          worker.applyFarmingSelection(
            Array.from({ length: 32 }, (_, index) => index + 1),
          ),
        ).rejects.toThrow("at most 31 entries");
        expect(client.gamesPlayed).toHaveBeenCalledTimes(callsBefore);

        const valid = Array.from({ length: 31 }, (_, index) => index + 1);
        await worker.applyFarmingSelection(valid);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith(valid);
        expect(selectedGames(account.id).map((game) => game.appId)).toEqual([
          440, 570, 730,
        ]);
      } finally {
        await worker.shutdown();
      }
    });

    it("discards a farming application whose generation expires at the payload await boundary", async () => {
      const account = await farmingAccount();
      const worker = new SteamWorker(account);
      const client = steamMock.instances.at(-1)!;
      try {
        client.emit("loggedOn");
        await flushWorkerEvents(worker);
        client.gamesPlayed.mockClear();
        let current = true;
        const guard = vi.fn(() => current);

        const applying = worker.applyFarmingSelection([570], guard);
        // Let the serialized command enter its asynchronous payload selection,
        // then invalidate it as a concurrent manager stop would do.
        await Promise.resolve();
        expect(guard).toHaveBeenCalledTimes(2);
        current = false;
        worker.clearFarmingSelection();
        await applying;

        expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);
        await worker.updateAccount(account);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);
      } finally {
        await worker.shutdown();
      }
    });

    it.each(["pause", "stop", "resume", "refreshWorker"] as const)(
      "does not leave an unmonitored farm when %s fails before reaching the worker",
      async (action) => {
        const account = await farmingAccount();
        const client = await connectManagedFarmingAccount(account.id);
        await steamManager.applyFarmingGames(account.id, [570]);
        client.gamesPlayed.mockClear();
        const internals = steamManager as unknown as {
          getWorkerForAccount(id: string): Promise<SteamWorker>;
          getOrCreateWorker(account: unknown): SteamWorker;
        };
        if (action === "refreshWorker") {
          vi.spyOn(internals, "getOrCreateWorker").mockImplementationOnce(
            () => {
              throw new Error("Synthetic lookup failure");
            },
          );
        } else {
          vi.spyOn(internals, "getWorkerForAccount").mockRejectedValueOnce(
            new Error("Synthetic lookup failure"),
          );
        }
        await expect(steamManager[action](account.id)).rejects.toThrow(
          "Synthetic lookup failure",
        );
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "manual",
        );
      },
    );

    it("stops an interrupted farm when a preset no longer exists", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);
      client.gamesPlayed.mockClear();
      await expect(
        steamManager.applyPreset(
          account.id,
          "11111111-1111-4111-8111-111111111111",
        ),
      ).rejects.toThrow("Preset was not found");
      expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
        "manual",
      );
    });

    it("reports connection, safety hold, desired-state and custom-title availability", async () => {
      const account = await farmingAccount("My title");
      expect(
        await steamManager.getFarmingAvailability(account.id),
      ).toMatchObject({
        allowed: false,
        reason: "not_connected",
        gameLimit: 31,
      });
      await connectManagedFarmingAccount(account.id);
      expect(
        await steamManager.getFarmingAvailability(account.id),
      ).toMatchObject({
        allowed: true,
        reason: null,
        gameLimit: 31,
      });

      await setSafetyHold(account.id, "manual");
      expect(
        await steamManager.getFarmingAvailability(account.id),
      ).toMatchObject({
        allowed: false,
        reason: "manual",
      });
      await expect(
        steamManager.applyFarmingGames(account.id, [570]),
      ).rejects.toThrow("unavailable");

      await steamManager.stop(account.id);
      expect(
        await steamManager.getFarmingAvailability(account.id),
      ).toMatchObject({
        allowed: false,
        reason: "not_running",
      });
    });

    it.each(["pause", "stop"] as const)(
      "invalidates a queued farming application synchronously on manual %s",
      async (action) => {
        const account = await farmingAccount();
        const client = await connectManagedFarmingAccount(account.id);
        const originalHalt = farmingController.halt.bind(farmingController);
        const haltSpy = vi.spyOn(farmingController, "halt");
        let current = true;
        haltSpy.mockImplementation((accountId, reason) => {
          if (accountId === account.id) current = false;
          originalHalt(accountId, reason);
        });
        let release = () => {};
        let entered = () => {};
        const ready = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const block = steamManager.runAccountOperation(account.id, async () => {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        });
        await ready;
        client.gamesPlayed.mockClear();
        const applying = steamManager.applyFarmingGames(
          account.id,
          [570],
          () => current,
        );
        const rejected = expect(applying).rejects.toThrow("unavailable");
        const intent = steamManager[action](account.id);
        try {
          expect(current).toBe(false);
          expect(haltSpy).toHaveBeenCalledWith(
            account.id,
            action === "pause" ? "paused" : "stopped",
          );
        } finally {
          release();
          await Promise.all([block, rejected, intent]);
        }

        expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
        expect(selectedGames(account.id).map((game) => game.appId)).toEqual([
          440, 570, 730,
        ]);
      },
    );

    it.each(["pause", "stop"] as const)(
      "preserves farming supervision on redundant start and still permits explicit %s",
      async (action) => {
        const account = await farmingAccount();
        const client = await connectManagedFarmingAccount(account.id);
        await steamManager.applyFarmingGames(account.id, [570]);
        await steamManager.runAccountOperation(
          account.id,
          async () => undefined,
        );
        const haltSpy = vi.spyOn(farmingController, "halt");
        const loginCalls = client.logOn.mock.calls.length;
        client.gamesPlayed.mockClear();

        await steamManager.start(account.id);

        expect(haltSpy).not.toHaveBeenCalled();
        expect(client.gamesPlayed).not.toHaveBeenCalled();
        expect(client.logOn).toHaveBeenCalledTimes(loginCalls);
        expect(
          await steamManager.getFarmingAvailability(account.id),
        ).toMatchObject({ allowed: true });
        await steamManager.applyFarmingGames(account.id, [10]);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([10]);

        await steamManager[action](account.id);
        expect(haltSpy).toHaveBeenCalledWith(
          account.id,
          action === "pause" ? "paused" : "stopped",
        );
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
        expect(selectedGames(account.id).map((game) => game.appId)).toEqual([
          440, 570, 730,
        ]);
      },
    );

    it.each(["pause", "stop"] as const)(
      "clears active farming on manual %s and restores only the manual selection on explicit resume",
      async (action) => {
        const account = await farmingAccount();
        const client = await connectManagedFarmingAccount(account.id);
        await steamManager.applyFarmingGames(account.id, [570]);
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([570]);

        const haltSpy = vi.spyOn(farmingController, "halt");
        await steamManager[action](account.id);
        expect(haltSpy).toHaveBeenCalledWith(
          account.id,
          action === "pause" ? "paused" : "stopped",
        );
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
        client.gamesPlayed.mockClear();
        client.emit("loggedOn");
        client.emit("playingState", false);
        await steamManager.runAccountOperation(
          account.id,
          async () => undefined,
        );
        expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);

        await steamManager.resume(account.id);
        if (action === "stop") {
          client.emit("loggedOn");
          await steamManager.runAccountOperation(
            account.id,
            async () => undefined,
          );
        }
        expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);
      },
    );

    it("ends farming into a manual safety hold without restoring games automatically", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      const manualSelection = selectedGames(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);

      await steamManager.endFarming(account.id);

      expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
        "manual",
      );
      expect(
        await steamManager.getFarmingAvailability(account.id),
      ).toMatchObject({ allowed: false, reason: "manual" });
      expect(selectedGames(account.id)).toEqual(manualSelection);
      await steamManager.resume(account.id);
      expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);
    });

    it("resumes a manual pause for farming without replaying the boost games", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);
      await steamManager.endFarming(account.id);
      expect(
        await steamManager.getFarmingAvailability(account.id),
      ).toMatchObject({ allowed: false, reason: "manual", resumable: true });

      await expect(
        steamManager.resumeForFarming(account.id),
      ).resolves.toMatchObject({ allowed: true });

      expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBeNull();
      await steamManager.applyFarmingGames(account.id, [570]);
      expect(client.gamesPlayed).toHaveBeenLastCalledWith([570]);
    });

    it.each(["hold-write", "recovery-write", "pause-command"] as const)(
      "force-disconnects active farming when stopping fails at %s",
      async (failure) => {
        const account = await farmingAccount();
        const client = await connectManagedFarmingAccount(account.id);
        const manualSelection = selectedGames(account.id);
        await steamManager.applyFarmingGames(account.id, [570]);
        await steamManager.runAccountOperation(
          account.id,
          async () => undefined,
        );
        const pauseSpy = vi.spyOn(SteamWorker.prototype, "pause");
        let failedRecoveryWrite = false;
        if (failure === "pause-command") {
          pauseSpy.mockRejectedValueOnce(new Error("Synthetic pause failure"));
        } else if (failure === "hold-write") {
          vi.spyOn(db, "update").mockImplementationOnce(() => {
            throw new Error("Synthetic safety hold write failure");
          });
        } else {
          const update = db.update.bind(db);
          vi.spyOn(db, "update").mockImplementation((table) => {
            if (table === accountHealthState && !failedRecoveryWrite) {
              failedRecoveryWrite = true;
              throw new Error("Synthetic recovery health write failure");
            }
            return update(table);
          });
        }
        client.gamesPlayed.mockClear();
        client.logOff.mockClear();

        await expect(
          steamManager.endFarming(account.id),
        ).resolves.toBeUndefined();

        expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
        expect(client.logOff).toHaveBeenCalledTimes(1);
        expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);
        expect(selectedGames(account.id)).toEqual(manualSelection);
        expect(
          db
            .select()
            .from(steamAccount)
            .where(eq(steamAccount.id, account.id))
            .get(),
        ).toMatchObject({ desiredState: "paused", status: "paused_manual" });
        if (failure === "hold-write") expect(pauseSpy).not.toHaveBeenCalled();
        else expect(pauseSpy).toHaveBeenCalledTimes(1);
        if (failure === "recovery-write")
          expect(failedRecoveryWrite).toBe(true);
      },
    );

    it("still clears Steam games and logs off when every database write fails while ending farming", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);
      await steamManager.runAccountOperation(account.id, async () => undefined);
      vi.spyOn(db, "update").mockImplementation(() => {
        throw new Error("Synthetic database write outage");
      });
      client.gamesPlayed.mockClear();
      client.logOff.mockClear();

      await expect(steamManager.endFarming(account.id)).rejects.toThrow(
        "Synthetic database write outage",
      );

      expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect(client.logOff).toHaveBeenCalledTimes(1);
      expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);
    });

    it("clears farming during a timed safety pause and resumes only the manual selection", async () => {
      vi.useFakeTimers();
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);
      const haltSpy = vi.spyOn(farmingController, "halt");

      await steamManager.pauseUntil(account.id, Date.now() + 60_000);
      expect(haltSpy).toHaveBeenCalledWith(account.id, "paused");
      expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect(
        await steamManager.getFarmingAvailability(account.id),
      ).toMatchObject({ allowed: false, reason: "pause_until" });
      client.gamesPlayed.mockClear();

      await vi.advanceTimersByTimeAsync(60_001);
      await steamManager.runAccountOperation(account.id, async () => undefined);

      expect(client.gamesPlayed).toHaveBeenLastCalledWith([440, 730]);
      expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);
    });

    it.each(["playingState", "disconnected", "error"] as const)(
      "halts farming after Steam %s and never automatically retries the farming payload",
      async (event) => {
        vi.useFakeTimers();
        const account = await farmingAccount();
        const client = await connectManagedFarmingAccount(account.id);
        await steamManager.applyFarmingGames(account.id, [570]);
        const haltSpy = vi.spyOn(farmingController, "halt");
        client.gamesPlayed.mockClear();
        const logOnCalls = client.logOn.mock.calls.length;
        if (event === "playingState") client.emit(event, true);
        else if (event === "error")
          client.emit(
            event,
            Object.assign(new Error("Session replaced"), { eresult: 6 }),
          );
        else client.emit(event, 2, "Connection lost");
        await steamManager.runAccountOperation(
          account.id,
          async () => undefined,
        );

        expect(haltSpy).toHaveBeenCalledWith(account.id, expect.any(String));
        expect(
          db
            .select()
            .from(steamAccount)
            .where(eq(steamAccount.id, account.id))
            .get()?.desiredState,
        ).toBe("paused");
        expect(
          await steamManager.getFarmingAvailability(account.id),
        ).toMatchObject({ allowed: false, reason: "not_running" });
        client.emit("playingState", false);
        client.emit("loggedOn");
        await steamManager.runAccountOperation(
          account.id,
          async () => undefined,
        );
        await vi.advanceTimersByTimeAsync(65 * 60_000);
        expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);
        expect(
          client.gamesPlayed.mock.calls.every(([games]) => games.length === 0),
        ).toBe(true);
        expect(client.logOn).toHaveBeenCalledTimes(logOnCalls);
      },
    );

    it("invalidates active farming immediately during shutdown and rejects later farming work", async () => {
      const account = await farmingAccount();
      const client = await connectManagedFarmingAccount(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);
      const shutdownSpy = vi.spyOn(farmingController, "beginShutdown");
      let release = () => {};
      client.steamBeeDrainRefreshTokens.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      client.gamesPlayed.mockClear();

      const shutdown = steamManager.shutdown();
      try {
        expect(shutdownSpy).toHaveBeenCalledTimes(1);
        expect(
          await steamManager.getFarmingAvailability(account.id),
        ).toMatchObject({ allowed: false, reason: "shutting_down" });
        await expect(
          steamManager.applyFarmingGames(account.id, [570]),
        ).rejects.toThrow("shutting down");
        client.emit("loggedOn");
      } finally {
        release();
        await shutdown;
      }

      expect(client.gamesPlayed).toHaveBeenLastCalledWith([]);
      expect(client.gamesPlayed).not.toHaveBeenCalledWith([570]);
      expect(
        (
          await db
            .select()
            .from(steamAccount)
            .where(eq(steamAccount.id, account.id))
        )[0]?.desiredState,
      ).toBe("paused");
      expect(selectedGames(account.id).map((game) => game.appId)).toEqual([
        440, 570, 730,
      ]);
    });

    it("keeps the account running through shutdown when farming will resume", async () => {
      const account = await farmingAccount();
      await connectManagedFarmingAccount(account.id);
      await steamManager.applyFarmingGames(account.id, [570]);
      await db
        .insert(accountFarmingResume)
        .values({ accountId: account.id, requestedAt: Date.now() });

      await steamManager.shutdown();

      expect(
        (
          await db
            .select()
            .from(steamAccount)
            .where(eq(steamAccount.id, account.id))
        )[0]?.desiredState,
      ).toBe("running");
    });
  });
});

function boostCallCount(
  client: { gamesPlayed: ReturnType<typeof vi.fn> } | undefined,
) {
  return (
    client?.gamesPlayed.mock.calls.filter(
      ([games]) => Array.isArray(games) && games.includes(730),
    ).length ?? 0
  );
}

const renewedCredential = {
  previousRefreshToken: "previous-token",
  refreshToken: "renewed-token",
  steamId: "76561198000000001",
};

async function credentialAccount() {
  const encrypted = encryptSecret(renewedCredential.previousRefreshToken);
  const [account] = await db
    .insert(steamAccount)
    .values({
      id: crypto.randomUUID(),
      accountName: `credential-${crypto.randomUUID()}`,
      steamId: renewedCredential.steamId,
      status: "disconnected",
      desiredState: "running",
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenKeyVersion: encrypted.keyVersion,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning();
  return account!;
}

async function farmingAccount(customTitle: string | null = null) {
  const account = await credentialAccount();
  const [updated] = await db
    .update(steamAccount)
    .set({ customTitle })
    .where(eq(steamAccount.id, account.id))
    .returning();
  await db.insert(steamAccountGame).values([
    {
      accountId: account.id,
      appId: 730,
      enabled: true,
      source: "manual",
      createdAt: Date.now(),
    },
    {
      accountId: account.id,
      appId: 440,
      enabled: true,
      source: "manual",
      createdAt: Date.now(),
    },
    {
      accountId: account.id,
      appId: 570,
      enabled: false,
      source: "manual",
      createdAt: Date.now(),
    },
  ]);
  return updated!;
}

function selectedGames(accountId: string) {
  return db
    .select()
    .from(steamAccountGame)
    .where(eq(steamAccountGame.accountId, accountId))
    .all();
}

async function connectManagedFarmingAccount(accountId: string) {
  await steamManager.start(accountId);
  const client = steamMock.instances.at(-1)!;
  client.emit("loggedOn");
  await steamManager.runAccountOperation(accountId, async () => undefined);
  expect(await steamManager.getFarmingAvailability(accountId)).toMatchObject({
    allowed: true,
  });
  return client;
}

async function flushWorkerEvents(worker: SteamWorker) {
  await (worker as unknown as { eventQueue: Promise<void> }).eventQueue;
}

function storedCredential(accountId: string) {
  const account = db
    .select()
    .from(steamAccount)
    .where(eq(steamAccount.id, accountId))
    .get()!;
  return decryptSecret({
    ciphertext: account.tokenCiphertext!,
    iv: account.tokenIv!,
    authTag: account.tokenAuthTag!,
    keyVersion: account.tokenKeyVersion,
  });
}

async function flushCredentials(worker: SteamWorker) {
  await (worker as unknown as { credentialQueue: Promise<void> })
    .credentialQueue;
}
