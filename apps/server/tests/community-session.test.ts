import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@steam-bee/contracts";
import { CommunitySessionBroker } from "../src/steam/community-session.js";

const STEAM_ID = "76561198000000001";
const SESSION_ID = "test-session-id";
const COOKIES = [
  `sessionid=${SESSION_ID}; Path=/; Secure`,
  "steamLoginSecure=test-login-token; Path=/; HttpOnly; Secure",
];

function harness(timeoutMs = 20_000) {
  const state = { connected: true, steamId: STEAM_ID as string | null };
  const webLogOn = vi.fn();
  const broker = new CommunitySessionBroker(
    {
      connected: () => state.connected,
      steamId: () => state.steamId,
      webLogOn,
    },
    timeoutMs,
  );
  return { broker, state, webLogOn };
}

describe("Community session broker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one web login between concurrent requests and copies cached cookies", async () => {
    const { broker, webLogOn } = harness();
    const first = broker.get();
    const second = broker.get();
    expect(first).toBe(second);
    expect(webLogOn).toHaveBeenCalledTimes(1);

    broker.accept(SESSION_ID, COOKIES);
    const session = await first;
    expect(session).toEqual({
      steamId: STEAM_ID,
      sessionId: SESSION_ID,
      cookies: [`sessionid=${SESSION_ID}`, "steamLoginSecure=test-login-token"],
    });
    session.cookies.push("injected=caller-mutation");
    expect((await broker.get()).cookies).not.toContain(
      "injected=caller-mutation",
    );
    expect(webLogOn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires cached sessions at thirty minutes and requests fresh cookies", async () => {
    const { broker, webLogOn } = harness();
    broker.accept(SESSION_ID, COOKIES);
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
    expect((await broker.get()).sessionId).toBe(SESSION_ID);
    expect(webLogOn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const refreshed = broker.get();
    expect(webLogOn).toHaveBeenCalledTimes(1);
    broker.accept("fresh-session", [
      "sessionid=fresh-session",
      "steamLoginSecure=fresh-token",
    ]);
    expect((await refreshed).sessionId).toBe("fresh-session");
  });

  it("rejects every pending waiter on timeout and permits a subsequent retry", async () => {
    const { broker, webLogOn } = harness(250);
    const first = broker.get();
    const second = broker.get();
    const firstFailure = expect(first).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.steamNotConnected,
    });
    const secondFailure = expect(second).rejects.toMatchObject({
      statusCode: 409,
    });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.all([firstFailure, secondFailure]);
    expect(vi.getTimerCount()).toBe(0);

    const retry = broker.get();
    expect(webLogOn).toHaveBeenCalledTimes(2);
    broker.accept(SESSION_ID, COOKIES);
    await expect(retry).resolves.toMatchObject({ steamId: STEAM_ID });
  });

  it("invalidates in-flight sessions explicitly without retaining credentials", async () => {
    const { broker, webLogOn } = harness();
    const pending = broker.get();
    const failure = expect(pending).rejects.toMatchObject({ statusCode: 409 });
    broker.invalidate();
    await failure;
    expect(vi.getTimerCount()).toBe(0);

    const next = broker.get();
    expect(webLogOn).toHaveBeenCalledTimes(2);
    broker.accept(SESSION_ID, COOKIES);
    await next;
    broker.invalidate();
    const afterInvalidation = broker.get();
    expect(webLogOn).toHaveBeenCalledTimes(3);
    broker.accept(SESSION_ID, COOKIES);
    await afterInvalidation;
  });

  it("discards cached credentials when a disconnected connection is observed", async () => {
    const { broker, state, webLogOn } = harness();
    broker.accept(SESSION_ID, COOKIES);
    state.connected = false;
    await expect(broker.get()).rejects.toMatchObject({ statusCode: 409 });
    state.connected = true;
    const reconnected = broker.get();
    expect(webLogOn).toHaveBeenCalledTimes(1);
    broker.accept("reconnected-session", [
      "sessionid=reconnected-session",
      "steamLoginSecure=reconnected-token",
    ]);
    expect((await reconnected).sessionId).toBe("reconnected-session");
  });

  it("never returns another Steam identity's cached session", async () => {
    const { broker, state, webLogOn } = harness();
    broker.accept(SESSION_ID, COOKIES);
    state.steamId = "76561198000000002";
    const next = broker.get();
    expect(webLogOn).toHaveBeenCalledTimes(1);
    broker.accept("other-session", [
      "sessionid=other-session",
      "steamLoginSecure=other-token",
    ]);
    expect((await next).steamId).toBe(state.steamId);
  });

  it.each([
    ["", COOKIES],
    ["bad;session", COOKIES],
    ["bad\r\nsession", COOKIES],
    [SESSION_ID, [`sessionid=${SESSION_ID}`]],
    [SESSION_ID, ["sessionid=wrong-session", "steamLoginSecure=token"]],
    [
      SESSION_ID,
      [`sessionid=${SESSION_ID}`, "steamLoginSecure=token\r\nInjected=1"],
    ],
  ])(
    "ignores malformed or incomplete session event %#",
    async (sessionId, cookies) => {
      const { broker } = harness(20);
      const pending = broker.get();
      const failure = expect(pending).rejects.toMatchObject({
        statusCode: 409,
      });
      broker.accept(sessionId, cookies);
      await vi.advanceTimersByTimeAsync(20);
      await failure;
    },
  );

  it("ignores session events without an active identified Steam connection", async () => {
    const { broker, state, webLogOn } = harness();
    state.connected = false;
    broker.accept(SESSION_ID, COOKIES);
    await expect(broker.get()).rejects.toMatchObject({ statusCode: 409 });
    state.connected = true;
    state.steamId = null;
    broker.accept(SESSION_ID, COOKIES);
    await expect(broker.get()).rejects.toMatchObject({ statusCode: 409 });
    expect(webLogOn).not.toHaveBeenCalled();
  });

  it("sanitizes synchronous web login errors and clears its pending timer", async () => {
    const { broker, webLogOn } = harness();
    webLogOn.mockImplementationOnce(() => {
      throw new Error("steamLoginSecure=private-value");
    });
    await expect(broker.get()).rejects.toMatchObject({
      statusCode: 409,
      message: "Connect the Steam account to obtain a Community session.",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
