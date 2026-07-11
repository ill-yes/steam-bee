import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

type Listener = (...args: unknown[]) => void;

const sessionMock = vi.hoisted(() => {
  const makeToken = () => {
    const payload = Buffer.from(
      JSON.stringify({
        exp: Math.floor((Date.now() + 90 * 24 * 60 * 60 * 1000) / 1000),
      }),
    ).toString("base64url");
    return `header.${payload}.signature`;
  };

  class FakeLoginSession {
    accountName = "qr_account";
    refreshToken = makeToken();
    steamID = { getSteamID64: () => "76561198000000003" };
    private listeners = new Map<string, Listener[]>();
    cancelLoginAttempt = vi.fn(() => true);
    removeAllListeners = vi.fn((event?: string) => {
      if (event) this.listeners.delete(event);
      else this.listeners.clear();
      return this;
    });

    constructor() {
      instances.push(this);
    }

    on(event: string, callback: Listener) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        callback,
      ]);
      return this;
    }

    async startWithQR() {
      return { qrChallengeUrl: "steam://qr-login" };
    }

    async startWithCredentials() {
      return {};
    }

    listenersFor(event: string) {
      return [...(this.listeners.get(event) ?? [])];
    }

    emit(event: string, ...args: unknown[]) {
      for (const callback of this.listeners.get(event) ?? []) {
        callback(...args);
      }
    }
  }

  const instances: FakeLoginSession[] = [];
  return { instances, LoginSession: FakeLoginSession };
});

const managerMock = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
}));

vi.mock("steam-session", () => ({
  EAuthTokenPlatformType: { SteamClient: 1 },
  LoginSession: sessionMock.LoginSession,
}));

vi.mock("../src/steam/manager.js", () => ({
  steamManager: managerMock,
}));

import { db, migrate, sqlite } from "../src/db/client.js";
import { steamAccount } from "../src/db/schema.js";
import {
  cleanupQrLogins,
  CredentialLoginFlow,
  getQrLogin,
  startQrLogin,
} from "../src/steam/login.js";

describe("Steam login flows", () => {
  beforeEach(() => {
    migrate();
    sessionMock.instances.length = 0;
    managerMock.start.mockClear();
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM steam_account;
    `);
  });

  it("persists QR login SteamID and starts the worker automatically", async () => {
    const { loginId } = await startQrLogin();
    const session = sessionMock.instances.at(-1)!;
    session.emit("authenticated");

    await vi.waitFor(() => {
      expect(managerMock.start).toHaveBeenCalledTimes(1);
    });

    const state = getQrLogin(loginId);
    expect(state).toMatchObject({
      status: "authenticated",
      accountName: "qr_account",
      steamId: "76561198000000003",
      connectedAt: expect.any(Number),
    });

    const [account] = await db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.accountName, "qr_account"));
    expect(account).toMatchObject({
      steamId: "76561198000000003",
      desiredState: "running",
    });
    expect(managerMock.start).toHaveBeenCalledWith(account.id, {
      action: "steam-login-qr",
    });
    expect(session.cancelLoginAttempt).toHaveBeenCalledTimes(1);
    expect(session.removeAllListeners).toHaveBeenCalledTimes(1);

    expect(getQrLogin(loginId)).toEqual(state);
  });

  it("retains an expired QR terminal state before cleaning it up", async () => {
    const startedAt = Date.now();
    const { loginId } = await startQrLogin();
    const session = sessionMock.instances.at(-1)!;

    cleanupQrLogins(startedAt + 11 * 60_000);
    const state = getQrLogin(loginId);
    expect(state).toMatchObject({
      status: "error",
      message: "Login session expired.",
    });
    expect(getQrLogin(loginId)).toEqual(state);
    expect(session.cancelLoginAttempt).toHaveBeenCalledTimes(1);
    expect(session.removeAllListeners).toHaveBeenCalledTimes(1);

    cleanupQrLogins(startedAt + 12 * 60_000);
    expect(session.cancelLoginAttempt).toHaveBeenCalledTimes(1);
    expect(session.removeAllListeners).toHaveBeenCalledTimes(1);

    cleanupQrLogins(startedAt + 22 * 60_000);
    expect(getQrLogin(loginId)).toBeNull();
  });

  it("rejects authentication received after the QR pending TTL", async () => {
    const startedAt = Date.now();
    const { loginId } = await startQrLogin();
    const session = sessionMock.instances.at(-1)!;
    const [staleAuthenticated] = session.listenersFor("authenticated");
    const expiredAt = startedAt + 11 * 60_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(expiredAt);

    session.emit("authenticated");
    now.mockRestore();
    staleAuthenticated?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(getQrLogin(loginId)).toEqual({
      status: "error",
      message: "Login session expired.",
    });
    expect(session.cancelLoginAttempt).toHaveBeenCalledTimes(1);
    expect(session.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(managerMock.start).not.toHaveBeenCalled();
    expect(
      sqlite.prepare("SELECT count(*) as count FROM steam_account").get(),
    ).toEqual({ count: 0 });
  });

  it("ignores stale authentication after a terminal QR state", async () => {
    const { loginId } = await startQrLogin();
    const session = sessionMock.instances.at(-1)!;
    const [staleAuthenticated] = session.listenersFor("authenticated");

    session.emit("timeout");
    const state = getQrLogin(loginId);
    staleAuthenticated?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(state).toEqual({
      status: "error",
      message: "QR login timed out.",
    });
    expect(getQrLogin(loginId)).toEqual(state);
    expect(getQrLogin(loginId)).toEqual(state);
    expect(session.cancelLoginAttempt).toHaveBeenCalledTimes(1);
    expect(session.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(managerMock.start).not.toHaveBeenCalled();
    expect(
      sqlite.prepare("SELECT count(*) as count FROM steam_account").get(),
    ).toEqual({ count: 0 });
  });

  it("persists credential authentication exactly once", async () => {
    const connectedAt = 1_800_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(connectedAt);
    const flow = new CredentialLoginFlow();
    let result: Awaited<ReturnType<CredentialLoginFlow["start"]>>;
    try {
      const start = flow.start("credential_account", "password");
      sessionMock.instances.at(-1)?.emit("authenticated");
      result = await start;
    } finally {
      now.mockRestore();
    }

    expect(result).toMatchObject({ status: "authenticated", connectedAt });
    expect(managerMock.start).toHaveBeenCalledTimes(1);
    expect(
      sqlite.prepare("SELECT count(*) as count FROM steam_account").get(),
    ).toEqual({ count: 1 });
  });
});
