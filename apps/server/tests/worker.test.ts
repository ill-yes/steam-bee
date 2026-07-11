import { beforeEach, describe, expect, it, vi } from "vitest";
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
  }

  return { default: FakeSteamUser };
});

import { db, migrate, sqlite } from "../src/db/client.js";
import {
  boostSession,
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
  steamAppCache,
} from "../src/db/schema.js";
import { steamManager } from "../src/steam/manager.js";
import { SteamWorker } from "../src/steam/worker.js";
import { encryptSecret } from "../src/util/crypto.js";

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
    await expect(shutdown).resolves.toBeUndefined();
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
    await worker.updateAccount(account);
    const client = steamMock.instances.at(-1);
    expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]);

    client?.emit("playingState", true);
    await vi.waitFor(() => {
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]);
    });

    client?.emit("playingState", false);
    await vi.waitFor(() => {
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]);
    });
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([730], true);
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([], true);
  });
});
