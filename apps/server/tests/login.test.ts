import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const sessionMock = vi.hoisted(() => {
  const makeToken = () => {
    const payload = Buffer.from(
      JSON.stringify({
        exp: Math.floor((Date.now() + 90 * 24 * 60 * 60 * 1000) / 1000),
      }),
    ).toString("base64url");
    return `header.${payload}.signature`;
  };

  return {
    instances: [] as Array<{
      emit: (event: string, ...args: unknown[]) => void;
    }>,
    LoginSession: class FakeLoginSession {
      accountName = "qr_account";
      refreshToken = makeToken();
      steamID = { getSteamID64: () => "76561198000000003" };
      private listeners = new Map<string, Listener[]>();

      constructor() {
        sessionMock.instances.push(this);
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

      emit(event: string, ...args: unknown[]) {
        for (const callback of this.listeners.get(event) ?? [])
          callback(...args);
      }
    },
  };
});

const managerMock = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
}));

type Listener = (...args: unknown[]) => void;

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
    managerMock.start.mockClear();
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM steam_account;
    `);
  });

  it("persists QR login SteamID and starts the worker automatically", async () => {
    const { loginId } = await startQrLogin();
    sessionMock.instances.at(-1)?.emit("authenticated");

    await vi.waitFor(() => {
      expect(managerMock.start).toHaveBeenCalledTimes(1);
    });

    const state = getQrLogin(loginId);
    expect(state).toMatchObject({
      status: "authenticated",
      accountName: "qr_account",
      steamId: "76561198000000003",
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

    expect(getQrLogin(loginId)).toEqual(state);
  });

  it("retains an expired QR terminal state before cleaning it up", async () => {
    const startedAt = Date.now();
    const { loginId } = await startQrLogin();

    cleanupQrLogins(startedAt + 11 * 60_000);
    expect(getQrLogin(loginId)).toMatchObject({
      status: "error",
      message: "Login session expired.",
    });

    cleanupQrLogins(startedAt + 22 * 60_000);
    expect(getQrLogin(loginId)).toBeNull();
  });

  it("persists credential authentication exactly once", async () => {
    const flow = new CredentialLoginFlow();
    const start = flow.start("credential_account", "password");
    sessionMock.instances.at(-1)?.emit("authenticated");
    const result = await start;

    expect(result).toMatchObject({ status: "authenticated" });
    expect(managerMock.start).toHaveBeenCalledTimes(1);
    expect(
      sqlite.prepare("SELECT count(*) as count FROM steam_account").get(),
    ).toEqual({ count: 1 });
  });
});
