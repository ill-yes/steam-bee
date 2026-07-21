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

    removeAllListeners(event?: string) {
      if (event) this.listeners.delete(event);
      else this.listeners.clear();
      return this;
    }
  }

  return { default: FakeSteamUser };
});

import { db, migrate, sqlite } from "../src/db/client.js";
import {
  accountHealthState,
  boostPreset,
  boostSchedule,
  boostSession,
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
  steamAppCache,
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

  it("stops reconnecting after Steam replaces the session", async () => {
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
      Object.assign(new Error("Logged in elsewhere"), { eresult: 34 }),
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
        status: "error",
        desiredState: "paused",
      });
      expect(health).toMatchObject({
        nextRetryAt: null,
        retryAttempt: 0,
        errorClass: "session_replaced",
        errorCode: 34,
        recoveryAction: "manual_resume",
      });
    });

    expect(client?.logOn).toHaveBeenCalledTimes(1);
    await worker.shutdown();
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
      Object.assign(new Error("Logged in elsewhere"), { eresult: 34 }),
    );
    await vi.waitFor(async () => {
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(updated).toMatchObject({
        desiredState: "paused",
        status: "error",
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
      Object.assign(new Error("Logged in elsewhere"), { eresult: 34 }),
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
        status: "error",
      });
      expect(health?.recoveryAction).toBe("manual_resume");
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
        Object.assign(new Error("Logged in elsewhere"), { eresult: 34 }),
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
          status: "error",
        });
        expect(health?.recoveryAction).toBe("manual_resume");
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
        Object.assign(new Error("Logged in elsewhere"), { eresult: 34 }),
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
          status: "error",
        });
        expect(health?.recoveryAction).toBe("manual_resume");
      });

      const logOnCalls = client?.logOn.mock.calls.length ?? 0;
      await steamManager.tickSchedules(activeAt);
      expect(client?.logOn).toHaveBeenCalledTimes(logOnCalls);
      const [held] = await db
        .select()
        .from(accountHealthState)
        .where(eq(accountHealthState.accountId, account.id));
      expect(held?.recoveryAction).toBe("manual_resume");
    } finally {
      releasePreset();
      await tick?.catch(() => undefined);
      updateSpy.mockRestore();
      await steamManager.shutdown();
    }
  });

  it("keeps a delayed other-session hold across reconnect before expiry", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `delayed-reconnect-before-${now}`,
      steamId: "76561198000000001",
      status: "online",
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
    const accountOperations = new AccountOperationState();
    let worker: SteamWorker | null = null;

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });
      await updateSafetyPolicy(account.id, {
        resumePolicy: "delayed",
        resumeDelayMinutes: 1,
        maxSessionMinutes: null,
        maxDailyMinutes: null,
        maxWeeklyMinutes: null,
      });
      worker = new SteamWorker(account, {
        runAccountOperation: (operation) =>
          accountOperations.run(account.id, operation),
      });
      const client = steamMock.instances.at(-1);
      client?.emit("loggedOn");
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]),
      );
      const initialBoostCalls = boostCallCount(client);

      client?.emit("playingState", true);
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]),
      );
      client?.emit("playingState", false);
      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_delay",
        ),
      );

      client?.emit("disconnected");
      await vi.waitFor(() => expect(worker?.isConnected).toBe(false));
      client?.emit("loggedOn");
      await vi.waitFor(async () => {
        expect(worker?.currentStatus).toBe("paused_other_session");
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_delay",
        );
      });
      expect(boostCallCount(client)).toBe(initialBoostCalls);

      const resumeAt = (await getAccountSafetyPolicy(account.id)).pauseUntil;
      const remainingDelay = (resumeAt ?? Date.now()) - Date.now();
      expect(remainingDelay).toBeGreaterThan(1);
      await vi.advanceTimersByTimeAsync(remainingDelay - 1);
      expect(boostCallCount(client)).toBe(initialBoostCalls);
      await vi.advanceTimersByTimeAsync(2);
      await vi.waitFor(async () => {
        expect(boostCallCount(client)).toBe(initialBoostCalls + 1);
        expect(
          (await getAccountSafetyPolicy(account.id)).holdReason,
        ).toBeNull();
      });
    } finally {
      await worker?.shutdown();
      vi.useRealTimers();
    }
  });

  it("waits for login when a delayed hold expires while disconnected", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `delayed-reconnect-after-${now}`,
      steamId: "76561198000000001",
      status: "online",
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
    const accountOperations = new AccountOperationState();
    let worker: SteamWorker | null = null;

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });
      await updateSafetyPolicy(account.id, {
        resumePolicy: "delayed",
        resumeDelayMinutes: 1,
        maxSessionMinutes: null,
        maxDailyMinutes: null,
        maxWeeklyMinutes: null,
      });
      worker = new SteamWorker(account, {
        runAccountOperation: (operation) =>
          accountOperations.run(account.id, operation),
      });
      const client = steamMock.instances.at(-1);
      client?.emit("loggedOn");
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([730]),
      );
      const initialBoostCalls = boostCallCount(client);

      client?.emit("playingState", true);
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]),
      );
      client?.emit("playingState", false);
      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_delay",
        ),
      );
      client?.emit("disconnected");
      await vi.waitFor(() => expect(worker?.isConnected).toBe(false));

      await vi.advanceTimersByTimeAsync(60_001);
      await vi.waitFor(async () => {
        expect(worker?.currentStatus).not.toBe("boosting");
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_delay",
        );
      });
      expect(boostCallCount(client)).toBe(initialBoostCalls);
      expect(client?.logOn).toHaveBeenCalledTimes(1);

      client?.emit("loggedOn");
      await vi.waitFor(async () => {
        expect(boostCallCount(client)).toBe(initialBoostCalls + 1);
        expect(worker?.currentStatus).toBe("boosting");
        expect(
          (await getAccountSafetyPolicy(account.id)).holdReason,
        ).toBeNull();
      });
    } finally {
      await worker?.shutdown();
      vi.useRealTimers();
    }
  });

  it("honors a delayed safety hold across a manager restart", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 6, 8, 10, 30);
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `delayed-restart-${now}`,
      steamId: null,
      status: "paused_other_session",
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
      const presetId = crypto.randomUUID();
      await db.insert(boostPreset).values({
        id: presetId,
        accountId: account.id,
        name: "Restart hold preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: crypto.randomUUID(),
        accountId: account.id,
        presetId,
        name: "Restart hold schedule",
        enabled: true,
        weekdaysJson: `[${new Date(now).getUTCDay()}]`,
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
        createdAt: now,
        updatedAt: now,
      });
      await setSafetyHold(account.id, "other_session_delay", now + 60_000);

      await steamManager.init();
      const client = steamMock.instances.at(-1);
      expect(client?.logOn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_001);
      await vi.waitFor(() => expect(client?.logOn).toHaveBeenCalledTimes(1));
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
        "other_session_delay",
      );

      client?.emit("disconnected");
      await vi.waitFor(async () => {
        const [updated] = await db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, account.id));
        expect(updated?.status).toBe("reconnecting");
      });
      await steamManager.tickSchedules(new Date(now + 60_001));
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
        "other_session_delay",
      );

      client?.emit("loggedOn");
      await vi.waitFor(async () =>
        expect(
          (await getAccountSafetyPolicy(account.id)).holdReason,
        ).toBeNull(),
      );
    } finally {
      await steamManager.shutdown();
      vi.useRealTimers();
    }
  });

  it("does not resume a restored delay after its owner is deleted and the manager restarts", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 6, 8, 10, 30);
    const afterWindow = Date.UTC(2026, 6, 8, 11, 5);
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `delayed-after-window-${now}`,
      steamId: null,
      status: "paused_other_session",
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
        name: "Expired owner preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId: account.id,
        presetId,
        name: "Expired owner schedule",
        enabled: true,
        weekdaysJson: `[${new Date(now).getUTCDay()}]`,
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
        lastStartedWindow: windowId,
        createdAt: now,
        updatedAt: now,
      });
      await setSafetyHold(account.id, "other_session_delay", now + 60_000, {
        kind: "scheduled",
        scheduleId,
        windowId,
      });

      await steamManager.init();
      const client = steamMock.instances.at(-1);
      await vi.advanceTimersByTimeAsync(60_001);
      await vi.waitFor(() => expect(client?.logOn).toHaveBeenCalledTimes(1));

      client?.emit("disconnected");
      await vi.waitFor(async () => {
        const [updated] = await db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, account.id));
        expect(updated?.status).toBe("reconnecting");
      });

      vi.setSystemTime(afterWindow);
      await steamManager.tickSchedules(new Date(afterWindow));
      expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
        "other_session_delay",
      );
      const [heldSchedule] = await db
        .select()
        .from(boostSchedule)
        .where(eq(boostSchedule.id, scheduleId));
      expect(heldSchedule?.lastStoppedWindow).toBeNull();

      await db.delete(boostSchedule).where(eq(boostSchedule.id, scheduleId));
      expect(await getSafetyHoldOwner(account.id)).toEqual({
        kind: "scheduled",
        scheduleId,
        windowId,
      });
      await steamManager.shutdown();
      await steamManager.init();
      const restartedClient = steamMock.instances.at(-1);
      expect(restartedClient).not.toBe(client);
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() =>
        expect(restartedClient?.logOn).toHaveBeenCalledTimes(1),
      );

      restartedClient?.emit("loggedOn");
      await vi.waitFor(async () => {
        const [updated] = await db
          .select()
          .from(steamAccount)
          .where(eq(steamAccount.id, account.id));
        expect(updated).toMatchObject({
          desiredState: "paused",
          status: "paused_manual",
        });
        expect(
          (await getAccountSafetyPolicy(account.id)).holdReason,
        ).toBeNull();
      });
      expect(boostCallCount(restartedClient)).toBe(0);
    } finally {
      await steamManager.shutdown();
      vi.useRealTimers();
    }
  });

  it("serializes a manual policy update racing a restored delayed expiry", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const encrypted = encryptSecret("refresh-token");
    const account = {
      id: crypto.randomUUID(),
      accountName: `delayed-manual-restart-${now}`,
      steamId: null,
      status: "paused_other_session",
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
    let releasePolicyUpdate: (() => void) | undefined;
    let policyUpdate: Promise<void> | undefined;

    try {
      await db.insert(steamAccount).values(account);
      await updateSafetyPolicy(account.id, {
        resumePolicy: "delayed",
        resumeDelayMinutes: 1,
        maxSessionMinutes: null,
        maxDailyMinutes: null,
        maxWeeklyMinutes: null,
      });
      await setSafetyHold(account.id, "other_session_delay", now + 60_000);

      await steamManager.init();
      expect(steamMock.instances.at(-1)?.logOn).not.toHaveBeenCalled();
      await steamManager.shutdown();

      await steamManager.init();
      const restartedClient = steamMock.instances.at(-1);
      const policyGate = new Promise<void>((resolve) => {
        releasePolicyUpdate = resolve;
      });
      policyUpdate = steamManager.runAccountOperation(account.id, async () => {
        await updateSafetyPolicy(account.id, {
          resumePolicy: "manual",
          resumeDelayMinutes: 1,
          maxSessionMinutes: null,
          maxDailyMinutes: null,
          maxWeeklyMinutes: null,
        });
        await policyGate;
      });
      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).resumePolicy).toBe(
          "manual",
        ),
      );
      await vi.advanceTimersByTimeAsync(60_001);
      expect(restartedClient?.logOn).not.toHaveBeenCalled();
      releasePolicyUpdate();
      await policyUpdate;

      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_manual",
        ),
      );
      expect(restartedClient?.logOn).not.toHaveBeenCalled();
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(updated?.desiredState).toBe("paused");
    } finally {
      releasePolicyUpdate?.();
      await policyUpdate?.catch(() => undefined);
      await steamManager.shutdown();
      vi.useRealTimers();
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

  it("serializes a manual policy update racing a live delayed resume", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const account = {
      id: crypto.randomUUID(),
      accountName: `delayed-policy-${now}`,
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
    let worker: SteamWorker | null = null;
    const accountOperations = new AccountOperationState();
    let releasePolicyUpdate: (() => void) | undefined;
    let policyUpdate: Promise<void> | undefined;

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });
      await updateSafetyPolicy(account.id, {
        resumePolicy: "delayed",
        resumeDelayMinutes: 1,
        maxSessionMinutes: null,
        maxDailyMinutes: null,
        maxWeeklyMinutes: null,
      });
      worker = new SteamWorker(account, {
        runAccountOperation: (operation) =>
          accountOperations.run(account.id, operation),
      });
      const client = steamMock.instances.at(-1);
      client?.emit("loggedOn");
      await vi.waitFor(() => expect(worker?.isConnected).toBe(true));
      await worker.updateAccount(account);
      client?.emit("playingState", true);
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]),
      );
      client?.emit("playingState", false);
      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_delay",
        ),
      );

      const policyGate = new Promise<void>((resolve) => {
        releasePolicyUpdate = resolve;
      });
      policyUpdate = accountOperations.run(account.id, async () => {
        await updateSafetyPolicy(account.id, {
          resumePolicy: "manual",
          resumeDelayMinutes: 1,
          maxSessionMinutes: null,
          maxDailyMinutes: null,
          maxWeeklyMinutes: null,
        });
        await policyGate;
      });
      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).resumePolicy).toBe(
          "manual",
        ),
      );
      await vi.advanceTimersByTimeAsync(60_001);
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]);
      releasePolicyUpdate();
      await policyUpdate;

      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_manual",
        ),
      );
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]);
      const [updated] = await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, account.id));
      expect(updated?.desiredState).toBe("paused");
    } finally {
      releasePolicyUpdate?.();
      await policyUpdate?.catch(() => undefined);
      await worker?.shutdown();
      vi.useRealTimers();
    }
  });

  it("quiesces an admitted delayed resume before shutdown drains work", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const account = {
      id: crypto.randomUUID(),
      accountName: `delayed-shutdown-${now}`,
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
    const accountOperations = new AccountOperationState();
    let worker: SteamWorker | null = null;
    let releaseBlocker: (() => void) | undefined;
    let blocker: Promise<void> | undefined;

    try {
      await db.insert(steamAccount).values(account);
      await db.insert(steamAccountGame).values({
        accountId: account.id,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      });
      await updateSafetyPolicy(account.id, {
        resumePolicy: "delayed",
        resumeDelayMinutes: 1,
        maxSessionMinutes: null,
        maxDailyMinutes: null,
        maxWeeklyMinutes: null,
      });
      worker = new SteamWorker(account, {
        runAccountOperation: (operation) =>
          accountOperations.run(account.id, operation),
      });
      const client = steamMock.instances.at(-1);
      client?.emit("loggedOn");
      await vi.waitFor(() => expect(worker?.isConnected).toBe(true));
      await worker.updateAccount(account);
      client?.emit("playingState", true);
      await vi.waitFor(() =>
        expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]),
      );
      client?.emit("playingState", false);
      await vi.waitFor(async () =>
        expect((await getAccountSafetyPolicy(account.id)).holdReason).toBe(
          "other_session_delay",
        ),
      );

      let markBlockerStarted = () => {};
      const blockerStarted = new Promise<void>((resolve) => {
        markBlockerStarted = resolve;
      });
      const blockerGate = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      blocker = accountOperations.run(account.id, async () => {
        markBlockerStarted();
        await blockerGate;
      });
      await blockerStarted;

      await vi.advanceTimersByTimeAsync(60_001);
      const boostCallsBeforeShutdown = client?.gamesPlayed.mock.calls.filter(
        ([games]) => Array.isArray(games) && games.includes(730),
      ).length;

      worker.beginShutdown();
      const drain = accountOperations.drain();
      releaseBlocker();
      await Promise.all([blocker, drain]);
      await worker.shutdown();

      expect(
        client?.gamesPlayed.mock.calls.filter(
          ([games]) => Array.isArray(games) && games.includes(730),
        ),
      ).toHaveLength(boostCallsBeforeShutdown ?? 0);
      expect(client?.gamesPlayed).toHaveBeenLastCalledWith([]);
    } finally {
      releaseBlocker?.();
      await blocker?.catch(() => undefined);
      await worker?.shutdown();
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
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([730], true);
    expect(client?.gamesPlayed).not.toHaveBeenCalledWith([], true);
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
