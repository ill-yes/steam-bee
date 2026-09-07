const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

const libraryPath =
  process.env.STEAM_BEE_TEST_LIBRARY || require.resolve("steam-user");
const libraryRequire = createRequire(libraryPath);
const SteamUser = require(libraryPath);
const SteamID = libraryRequire("steamid");
const EMsg = libraryRequire("./enums/EMsg.js");
const steamId = "76561198000000001";
const token = (marker, refresh = true) =>
  `e30.${Buffer.from(JSON.stringify({ iss: "steam", sub: steamId, aud: refresh ? ["client", "derive"] : ["client"], marker })).toString("base64url")}.synthetic`;
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const client = new SteamUser({
    dataDirectory: null,
    autoRelogin: false,
    renewRefreshTokens: true,
  });
  const events = {
    credentials: [],
    publicTokens: [],
    cookies: [],
    errors: [],
    sends: [],
  };
  client._readFiles = async () => [];
  client._saveFile = () => {};
  client._doConnection = async () => {};
  client._getChangelistUpdate = () => {};
  client._requestNotifications = () => {};
  client._send = (...args) => events.sends.push(args);
  client._getLoginSession = () => client._loginSession;
  client.on("steamBeeRefreshToken", (value) => events.credentials.push(value));
  client.on("refreshToken", (value) => events.publicTokens.push(value));
  client.on("webSession", (...value) => events.cookies.push(value));
  client.on("error", (value) => events.errors.push(value));
  async function login(refreshToken = token("A"), options = {}) {
    client.logOn({ refreshToken });
    await flush();
    const renewal = deferred();
    const cookies = deferred();
    const session = {
      refreshToken,
      renewCalls: 0,
      cookieCalls: 0,
      renewRefreshToken() {
        this.renewCalls++;
        return renewal.promise;
      },
      getWebCookies() {
        this.cookieCalls++;
        return cookies.promise;
      },
    };
    client._loginSession = session;
    client.steamID = new SteamID(steamId);
    if (options.renew === false)
      delete client._shouldAttemptRefreshTokenRenewal;
    client._handlerManager.emit(client, EMsg.ClientLogOnResponse, {
      eresult: 1,
      cell_id: 1,
      heartbeat_seconds: 60,
    });
    await flush();
    return { renewal, cookies, session, details: client._logOnDetails };
  }
  function close() {
    client._disconnect(true);
  }
  return { client, events, login, close };
}

async function strictScenario(scenario) {
  if (scenario === "cm-abandon") {
    const h = realHarness();
    try {
      await h.connect();
      h.close();
      await h.connect();
      assert.equal(h.requests.length, 2);
      assert.equal(h.requests[1].data.renewal_type, 0);
      assert.equal(h.client._steamBeeRenewals.size, 0);
      assert.ok(h.client._heartbeatInterval);
      h.client.steamBeeBeginShutdown();
      await h.client.steamBeeDrainRefreshTokens();
    } finally {
      h.close();
    }
    return;
  }
  const h = harness();
  try {
    const a = await h.login();
    if (scenario !== "positive") h.close();
    if (scenario === "reject")
      a.renewal.reject(new Error("synthetic renewal failure"));
    else {
      a.session.refreshToken = token("renewed");
      a.renewal.resolve(scenario !== "false");
    }
    await flush();
    await flush();
    assert.equal(h.events.errors.length, 0);
    if (scenario === "positive") {
      assert.equal(h.events.publicTokens.length, 1);
      assert.equal(a.session.cookieCalls, 1);
      a.cookies.resolve(["sessionid=synthetic"]);
      await flush();
      assert.equal(h.events.cookies.length, 1);
    } else {
      assert.equal(a.session.cookieCalls, 0);
      assert.equal(h.events.cookies.length, 0);
      assert.equal(h.events.publicTokens.length, 0);
      assert.ok(
        !h.client._heartbeatInterval || h.client._heartbeatInterval._destroyed,
      );
      if (scenario === "true") assert.equal(h.events.credentials.length, 1);
    }
  } finally {
    h.close();
  }
}

function realHarness() {
  const h = harness();
  const client = h.client;
  delete client._getLoginSession;
  delete client._send;
  const sessionRequire = createRequire(libraryRequire.resolve("steam-session"));
  const proto = sessionRequire("./protobufs.js").getProtoForMethod(
    "Authentication",
    "GenerateAccessTokenForApp",
  );
  const requests = [];
  async function connect(refreshToken = token("A")) {
    client.logOn({ refreshToken });
    await flush();
    client.steamID = new SteamID(steamId);
    client._connection = {
      send(buffer) {
        const offset = 8 + buffer.readUInt32LE(4);
        const data = proto.request.decode(buffer.subarray(offset));
        const callback = client._jobs.get(client._currentJobID.toString());
        requests.push({
          data,
          respond(renewedToken) {
            const body = proto.response
              .encode({
                access_token: token("access", false),
                refresh_token: renewedToken,
              })
              .finish();
            callback({ toBuffer: () => body }, { proto: { eresult: 1 } });
          },
        });
      },
      end() {},
    };
    client._handlerManager.emit(client, EMsg.ClientLogOnResponse, {
      eresult: 1,
      cell_id: 1,
      heartbeat_seconds: 60,
    });
    await flush();
    return client._loginSession;
  }
  return { ...h, connect, requests };
}

module.exports = {
  harness,
  realHarness,
  libraryRequire,
  token,
  steamId,
  deferred,
  flush,
};
if (require.main === module) {
  strictScenario(process.argv[2])
    .then(() => process.stdout.write("strict lifecycle passed\n"))
    .catch((error) => {
      process.stderr.write(`${error.name}: ${error.message}\n`);
      process.exitCode = 1;
    });
}
