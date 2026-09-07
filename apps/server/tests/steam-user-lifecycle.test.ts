import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  harness,
  realHarness,
  libraryRequire,
  token,
  steamId,
  deferred,
  flush,
} = require("./fixtures/steam-user-lifecycle.cjs");
const fixture = fileURLToPath(
  new URL("./fixtures/steam-user-lifecycle.cjs", import.meta.url),
);
const clients: ReturnType<typeof harness>[] = [];
const setup = () => {
  const h = harness();
  clients.push(h);
  return h;
};
afterEach(() => {
  for (const h of clients.splice(0)) h.close();
});

describe("installed steam-user lifecycle patch", () => {
  it.each([false, true])(
    "live CM late rotation survives deadline, stopping=%s",
    async (stopping) => {
      const h = realHarness();
      clients.push(h);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await h.connect();
        if (stopping) h.client.steamBeeBeginShutdown();
        await vi.advanceTimersByTimeAsync(10000);
        await h.client.steamBeeDrainRefreshTokens();
        expect(h.events.credentials).toEqual([]);
        const currentToken = h.client._logOnDetails.access_token;
        const requests = h.requests.length;
        h.requests[0].respond(token("late-renewed"));
        await flush();
        expect(h.events.credentials).toEqual([
          {
            previousRefreshToken: token("A"),
            refreshToken: token("late-renewed"),
            steamId,
          },
        ]);
        expect(h.events.publicTokens).toEqual([]);
        expect(h.events.cookies).toEqual([]);
        expect(h.client._logOnDetails.access_token).toBe(currentToken);
        expect(h.requests).toHaveLength(requests);
        h.requests[0].respond(token("duplicate"));
        expect(h.events.credentials).toHaveLength(1);
      } finally {
        h.close();
        vi.useRealTimers();
      }
    },
  );

  it("deadline then true disconnect detaches old raw response from B", async () => {
    const h = realHarness();
    clients.push(h);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await h.connect();
      await vi.advanceTimersByTimeAsync(10000);
      h.close();
      await h.connect(token("B"));
      h.requests[0].respond(token("old-late"));
      await flush();
      expect(h.events.credentials).toEqual([]);
      expect(h.client._logOnDetails.access_token).toBe(token("B"));
    } finally {
      h.close();
      vi.useRealTimers();
    }
  });

  it("malformed late renewal token cannot escape raw CM callback", async () => {
    const h = realHarness();
    clients.push(h);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await h.connect();
      h.client.steamBeeBeginShutdown();
      await vi.advanceTimersByTimeAsync(10000);
      expect(() => h.requests[0].respond("not-a-jwt")).not.toThrow();
      await flush();
      expect(h.events.credentials).toEqual([]);
      expect(h.client._steamBeeAuthRequests.size).toBe(0);
    } finally {
      h.close();
      vi.useRealTimers();
    }
  });
  it("real CM abandon scenario runs in a strict child", () => {
    expect(
      execFileSync(
        process.execPath,
        ["--unhandled-rejections=strict", fixture, "cm-abandon"],
        { timeout: 10000, encoding: "utf8" },
      ),
    ).toContain("strict lifecycle passed");
  });

  it("real CM auth cancellation releases singleflight and B uses cookie-only", async () => {
    const h = realHarness();
    clients.push(h);
    const a = await h.connect();
    expect(h.requests[0].data.renewal_type).toBe(1);
    h.close();
    const b = await h.connect();
    expect(b).not.toBe(a);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].data.renewal_type).toBe(0);
    expect(h.client._steamBeeRenewals.size).toBe(0);
    expect(h.client._heartbeatInterval).toBeDefined();
    h.requests[1].respond();
    await flush();
    expect(h.events.cookies).toHaveLength(1);
    h.client.steamBeeBeginShutdown();
    await h.client.steamBeeDrainRefreshTokens();
  });

  it("real CM success already received still persists after disconnect", async () => {
    const h = realHarness();
    clients.push(h);
    await h.connect();
    h.requests[0].respond(token("renewed"));
    h.close();
    await h.client.steamBeeDrainRefreshTokens();
    expect(h.events.credentials).toEqual([
      {
        previousRefreshToken: token("A"),
        refreshToken: token("renewed"),
        steamId,
      },
    ]);
    expect(h.events.publicTokens).toEqual([]);
    expect(h.events.cookies).toEqual([]);
  });

  it("real CM deadline bounds shutdown drain when Steam never responds", async () => {
    const h = realHarness();
    clients.push(h);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await h.connect();
      h.client.steamBeeBeginShutdown();
      let drained = false;
      const drain = h.client.steamBeeDrainRefreshTokens().then(() => {
        drained = true;
      });
      await vi.advanceTimersByTimeAsync(9999);
      expect(drained).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await drain;
      expect(h.client._steamBeeRenewals.size).toBe(0);
      expect(h.client._steamBeeAuthRequests.size).toBe(1);
      expect(h.client._steamBeeUncertainRefreshTokens.has(token("A"))).toBe(
        true,
      );
      expect(h.events.errors).toEqual([]);
    } finally {
      h.close();
      vi.useRealTimers();
    }
  });

  it.each(["TCP", "WS"])(
    "shutdown waits for captured %s socket close, not logical disconnect",
    async (type) => {
      const h = setup();
      const a = await h.login(token("A"), { renew: false });
      a.cookies.resolve(["sessionid=synthetic"]);
      await flush();
      const socket = new EventEmitter() as EventEmitter & {
        destroy: () => void;
        closed: boolean;
        end: () => void;
      };
      socket.closed = false;
      socket.destroy = vi.fn(() => {
        socket.closed = true;
      });
      socket.end = vi.fn();
      h.client._connection = {
        connectionType: type,
        stream: type === "WS" ? { _socket: socket } : socket,
        end() {
          socket.removeAllListeners();
          socket.destroy();
        },
      };
      let done = false;
      const shutdown = h.client.steamBeeLogOffAndDrain().then(() => {
        done = true;
      });
      await flush();
      expect(done).toBe(false);
      expect(h.client.steamID).toBeNull();
      socket.closed = true;
      socket.emit("close");
      await shutdown;
      expect(done).toBe(true);
    },
  );

  it("shutdown uses actual TCP end implementation and Node socket close", async () => {
    const h = setup();
    const TCPConnection = libraryRequire(
      "./components/connection_protocols/tcp.js",
    );
    const socket = new Socket();
    const connection = Object.create(TCPConnection.prototype);
    connection.stream = socket;
    connection.user = h.client;
    connection.connectionType = "TCP";
    connection.connectionId = 1;
    h.client._connection = connection;
    await h.client.steamBeeLogOffAndDrain();
    expect(socket.closed).toBe(true);
    expect(socket.destroyed).toBe(true);
    expect(socket.readable).toBe(false);
    expect(
      (socket as unknown as { _readableState: { closeEmitted: boolean } })
        ._readableState.closeEmitted,
    ).toBe(true);
  });

  it("unobservable connecting transport fails closed during shutdown", async () => {
    const h = setup();
    h.client._connection = { connectionType: "WS", stream: {}, end() {} };
    await expect(h.client.steamBeeLogOffAndDrain()).rejects.toThrow(
      "closure cannot be verified",
    );
  });
  it.each(["false", "true", "reject", "positive"])(
    "runs real dispatcher in strict child: %s",
    (scenario) => {
      const output = execFileSync(
        process.execPath,
        ["--unhandled-rejections=strict", fixture, scenario],
        { timeout: 10_000, encoding: "utf8" },
      );
      expect(output).toContain("strict lifecycle passed");
    },
  );

  it.each([true, false, "reject"])(
    "active renewal %s retains normal web login",
    async (result) => {
      const h = setup();
      const a = await h.login();
      if (result === "reject") a.renewal.reject(new Error("synthetic"));
      else {
        a.session.refreshToken = token("renewed");
        a.renewal.resolve(result);
      }
      await flush();
      expect(a.session.cookieCalls).toBe(1);
      expect(h.events.publicTokens).toHaveLength(result === true ? 1 : 0);
      a.cookies.resolve(["sessionid=synthetic"]);
      await flush();
      expect(h.events.cookies).toHaveLength(1);
      expect(h.client.options).toMatchObject({
        autoRelogin: false,
        renewRefreshTokens: true,
      });
    },
  );

  it("preserves late credential lineage without touching new login B", async () => {
    const h = setup();
    const a = await h.login(token("A"));
    h.close();
    const b = await h.login(token("B"));
    a.session.refreshToken = token("A-renewed");
    a.renewal.resolve(true);
    await flush();
    expect(h.events.credentials).toEqual([
      {
        previousRefreshToken: token("A"),
        refreshToken: token("A-renewed"),
        steamId,
      },
    ]);
    expect(b.details.access_token).toBe(token("B"));
    expect(b.session.refreshToken).toBe(token("B"));
    expect(a.session.cookieCalls + b.session.cookieCalls).toBe(0);
    expect(h.events.publicTokens).toEqual([]);
    b.renewal.resolve(false);
    await flush();
    expect(b.session.cookieCalls).toBe(1);
  });

  it("singleflights the same predecessor across generations", async () => {
    const h = setup();
    const a = await h.login();
    h.close();
    const b = await h.login();
    expect(a.session.renewCalls + b.session.renewCalls).toBe(1);
    a.session.refreshToken = token("renewed");
    a.renewal.resolve(true);
    await flush();
    expect(h.events.credentials).toHaveLength(1);
    expect(h.events.publicTokens).toEqual([token("renewed")]);
    expect(a.session.cookieCalls).toBe(0);
    expect(b.session.cookieCalls).toBe(1);
    expect(b.details.access_token).toBe(token("renewed"));
  });

  it.each(["resolve", "reject"])(
    "drops stale cookie %s without backoff",
    async (result) => {
      const h = setup();
      const a = await h.login(token("A"), { renew: false });
      h.close();
      if (result === "resolve") a.cookies.resolve(["sessionid=synthetic"]);
      else a.cookies.reject(new Error("synthetic"));
      await flush();
      expect(h.events.cookies).toEqual([]);
      expect(h.client._exponentialBackoffs.webLogOn).toBeUndefined();
      expect(h.events.errors).toEqual([]);
    },
  );

  it("checks generation inside nextTick cookie publication", async () => {
    const h = setup();
    const a = await h.login(token("A"), { renew: false });
    const reset = h.client._resetExponentialBackoff.bind(h.client);
    h.client._resetExponentialBackoff = (name: string, soft: boolean) => {
      reset(name, soft);
      if (name === "webLogOn") {
        h.client._resetExponentialBackoff = reset;
        queueMicrotask(() => h.close());
      }
    };
    a.cookies.resolve(["sessionid=synthetic"]);
    await flush();
    h.client._resetExponentialBackoff = reset;
    expect(h.events.cookies).toEqual([]);
  });

  it.each([false, true])(
    "checks a resolved retry before new request, disconnected=%s",
    async (disconnected) => {
      const h = setup();
      const retry = deferred();
      h.client._exponentialBackoff = () => retry.promise;
      const a = await h.login(token("A"), { renew: false });
      a.cookies.reject(new Error("synthetic"));
      await flush();
      const nextCookies = deferred();
      a.session.getWebCookies = () => {
        a.session.cookieCalls++;
        return nextCookies.promise;
      };
      retry.resolve();
      if (disconnected) h.close();
      await flush();
      expect(a.session.cookieCalls).toBe(disconnected ? 1 : 2);
      nextCookies.resolve(["sessionid=synthetic"]);
      await flush();
      expect(h.events.cookies).toHaveLength(disconnected ? 0 : 1);
    },
  );

  it("shutdown waits for admitted credentials, never resumes session work", async () => {
    const h = setup();
    const a = await h.login();
    h.client.steamBeeBeginShutdown();
    h.client.removeAllListeners("error");
    h.client.logOn({ refreshToken: token("B") });
    let drained = false;
    const drain = h.client.steamBeeDrainRefreshTokens().then(() => {
      drained = true;
    });
    await flush();
    expect(drained).toBe(false);
    a.session.refreshToken = token("renewed");
    a.renewal.resolve(true);
    await drain;
    expect(h.events.credentials).toHaveLength(1);
    expect(a.session.cookieCalls).toBe(0);
    expect(h.events.publicTokens).toEqual([]);
  });

  it("terminates unexpected active dispatcher errors through local error handling", async () => {
    const h = setup();
    h.client._getChangelistUpdate = () => {
      throw new Error("synthetic private detail");
    };
    await h.login();
    expect(h.client.steamID).toBeNull();
    expect(h.events.errors).toHaveLength(1);
    expect(h.events.errors[0].message).toBe("Steam session lifecycle failed");
  });

  it.each(["disconnect", "listener"])(
    "terminal dispatcher sink cannot reject again on %s failure",
    async (failure) => {
      const h = setup();
      const disconnect = h.client._disconnect.bind(h.client);
      h.client._getChangelistUpdate = () => {
        throw new Error("synthetic");
      };
      if (failure === "disconnect")
        h.client._disconnect = () => {
          throw new Error("synthetic teardown");
        };
      else
        h.client.on("error", () => {
          throw new Error("synthetic consumer");
        });
      await h.login();
      h.client._disconnect = disconnect;
      expect(h.events.errors).toHaveLength(1);
      expect(h.client._steamBeeGeneration).toBeGreaterThan(1);
    },
  );

  it("honors synchronous disconnect from loggedOn listeners", async () => {
    const h = setup();
    h.client.on("loggedOn", () => h.close());
    const a = await h.login();
    expect(a.session.renewCalls).toBe(0);
    expect(a.session.cookieCalls).toBe(0);
    expect(h.events.errors).toEqual([]);
  });

  it("honors synchronous disconnect from public refreshToken listeners", async () => {
    const h = setup();
    h.client.on("refreshToken", () => h.close());
    const a = await h.login();
    a.session.refreshToken = token("renewed");
    a.renewal.resolve(true);
    await flush();
    expect(h.events.credentials).toHaveLength(1);
    expect(a.session.cookieCalls).toBe(0);
    expect(h.client._heartbeatInterval).toBeUndefined();
  });

  it("drops shutdown renewal rejection even after error listeners are removed", async () => {
    const h = setup();
    const a = await h.login();
    h.client.steamBeeBeginShutdown();
    h.client.removeAllListeners("error");
    a.renewal.reject(new Error("synthetic"));
    await h.client.steamBeeDrainRefreshTokens();
    await flush();
    expect(h.events.credentials).toEqual([]);
    expect(a.session.cookieCalls).toBe(0);
  });

  it("invalidates pending startup before the nextTick login begins", async () => {
    const h = setup();
    let reads = 0;
    h.client._readFiles = async () => {
      reads++;
      return [];
    };
    h.client.logOn({ refreshToken: token("A") });
    h.close();
    await flush();
    expect(reads).toBe(0);
    expect(h.client._connecting).toBe(false);
  });

  it("stale startup file results cannot overwrite a new login", async () => {
    const h = setup();
    const files = deferred();
    h.client._readFiles = () => files.promise;
    h.client.logOn({ refreshToken: token("A") });
    await flush();
    h.close();
    h.client._readFiles = async () => [];
    const b = await h.login(token("B"));
    files.resolve([
      { filename: "cellid-synthetic.txt", contents: Buffer.from("999") },
    ]);
    await flush();
    expect(b.details.access_token).toBe(token("B"));
    expect(b.details.cell_id).toBe(1);
    b.renewal.resolve(false);
    await flush();
  });
});
