import { statSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { db, getMigrationState, migrate, sqlite } from "../src/db/client.js";
import { config, parseTrustProxy, paths } from "../src/config.js";
import {
  adminSession,
  boostSession,
  steamAccount,
  steamEvent,
  steamAccountLibrary,
  steamAppCache,
} from "../src/db/schema.js";
import { buildApp } from "../src/app.js";
import { readXmlTag } from "../src/http/routes/accounts.js";

describe("api auth flow", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM steam_account_library;
      DELETE FROM steam_account_game;
      DELETE FROM steam_app_cache;
      DELETE FROM steam_account;
      DELETE FROM admin_session;
      DELETE FROM admin_user;
    `);
  });

  it("parses trusted proxy aliases, hop counts and CIDRs safely", () => {
    for (const alias of ["true", "TRUE", " yes ", "on", "1"]) {
      expect(parseTrustProxy(alias)).toBe(1);
    }
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("off")).toBe(false);
    expect(parseTrustProxy("3")).toBe(3);
    expect(parseTrustProxy("10.0.0.0/8, fd00::/8")).toEqual([
      "10.0.0.0/8",
      "fd00::/8",
    ]);
    expect(() => parseTrustProxy("10.0.0.0/99")).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy("anywhere")).toThrow(/TRUST_PROXY/);
  });

  it("decodes XML text once and preserves CDATA content", () => {
    expect(readXmlTag("<steamID>&lt;Admin&gt;</steamID>", "steamID")).toBe(
      "<Admin>",
    );
    expect(
      readXmlTag("<steamID>&amp;lt;Admin&amp;gt;</steamID>", "steamID"),
    ).toBe("&lt;Admin&gt;");
    expect(
      readXmlTag("<steamID><![CDATA[A &amp; B]]></steamID>", "steamID"),
    ).toBe("A &amp; B");
  });

  it("does not let forwarded IP rotation bypass the admin auth limit", async () => {
    const originalTrustProxy = config.trustProxy;
    config.trustProxy = 1;
    const app = await buildApp({ initSteam: false });

    try {
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        headers: { "x-forwarded-for": "198.51.100.1" },
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      expect(setup.statusCode).toBe(200);

      const attempts = [];
      for (let index = 2; index <= 7; index += 1) {
        attempts.push(
          await app.inject({
            method: "POST",
            url: "/api/login",
            headers: { "x-forwarded-for": `198.51.100.${index}` },
            payload: { password: "wrong password" },
          }),
        );
      }

      expect(attempts.at(-1)?.statusCode).toBe(429);
      expect(attempts.at(-1)?.json()).toMatchObject({
        code: "RATE_LIMITED",
      });
    } finally {
      config.trustProxy = originalTrustProxy;
      await app.close();
    }
  });

  it("bounds correlation IDs and prevents API responses from being cached", async () => {
    const app = await buildApp({ initSteam: false });

    try {
      const accepted = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: { "x-correlation-id": "request_01:child" },
      });
      expect(accepted.headers["x-correlation-id"]).toBe("request_01:child");
      expect(accepted.headers["cache-control"]).toBe("no-store");

      for (const unsafeId of ["<script>alert(1)</script>", "a".repeat(129)]) {
        const response = await app.inject({
          method: "GET",
          url: "/api/me",
          headers: { "x-correlation-id": unsafeId },
        });
        expect(response.headers["x-correlation-id"]).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(response.headers["x-correlation-id"]).not.toBe(unsafeId);
      }

      const missing = await app.inject({
        method: "GET",
        url: "/api/not-a-route",
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it("uses private Unix modes for server data", () => {
    if (process.platform === "win32") return;

    expect(process.umask()).toBe(0o077);
    expect(statSync(config.dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(paths.steamData).mode & 0o777).toBe(0o700);
    expect(statSync(paths.secret).mode & 0o777).toBe(0o600);
    expect(statSync(paths.database).mode & 0o777).toBe(0o600);
  });

  it("sets up admin auth and protects account APIs with csrf", async () => {
    const app = await buildApp({ initSteam: false });

    const initial = await app.inject({ method: "GET", url: "/api/me" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      setupComplete: false,
      setupTokenRequired: true,
      authenticated: false,
    });

    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        password: "correct horse battery staple",
        setupToken: "steam-bee-test-setup-token",
      },
    });
    expect(setup.statusCode).toBe(200);
    const cookie = setup.cookies.find((item) => item.name === "session")?.value;
    const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
    expect(cookie).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/steam/login/qr/start",
      cookies: { session: cookie! },
    });
    expect(forbidden.statusCode).toBe(403);

    const accounts = await app.inject({
      method: "GET",
      url: "/api/accounts",
      cookies: { session: cookie! },
    });
    expect(accounts.statusCode).toBe(200);
    expect(accounts.json()).toEqual([]);

    await app.close();
  });

  it("allows exactly one concurrent setup and returns a stable conflict code", async () => {
    const app = await buildApp({ initSteam: false });
    const attempts = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple one",
          setupToken: "steam-bee-test-setup-token",
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple two",
          setupToken: "steam-bee-test-setup-token",
        },
      }),
    ]);

    expect(attempts.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect(
      attempts.find((response) => response.statusCode === 409)?.json(),
    ).toMatchObject({
      code: "SETUP_ALREADY_COMPLETE",
    });
    expect(
      Number(
        (
          sqlite.prepare("SELECT count(*) as count FROM admin_user").get() as {
            count: number;
          }
        ).count,
      ),
    ).toBe(1);

    await app.close();
  });

  it("throttles last-seen writes and removes expired sessions", async () => {
    const app = await buildApp({ initSteam: false });
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        password: "correct horse battery staple",
        setupToken: "steam-bee-test-setup-token",
      },
    });
    const cookie = setup.cookies.find((item) => item.name === "session")?.value;
    const [created] = await db.select().from(adminSession).limit(1);

    await app.inject({
      method: "GET",
      url: "/api/accounts",
      cookies: { session: cookie! },
    });
    const [unchanged] = await db.select().from(adminSession).limit(1);
    expect(unchanged?.lastSeenAt).toBe(created?.lastSeenAt);

    await db.update(adminSession).set({ lastSeenAt: Date.now() - 6 * 60_000 });
    await app.inject({
      method: "GET",
      url: "/api/accounts",
      cookies: { session: cookie! },
    });
    const [refreshed] = await db.select().from(adminSession).limit(1);
    expect(refreshed!.lastSeenAt).toBeGreaterThan(unchanged!.lastSeenAt);

    await db.update(adminSession).set({ expiresAt: Date.now() - 1 });
    const expired = await app.inject({
      method: "GET",
      url: "/api/accounts",
      cookies: { session: cookie! },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(await db.select().from(adminSession)).toHaveLength(0);

    await app.close();
  });

  it("exposes diagnostics and applies targeted auth rate limits", async () => {
    const app = await buildApp({ initSteam: false });

    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        password: "correct horse battery staple",
        setupToken: "steam-bee-test-setup-token",
      },
      headers: { "x-correlation-id": "test-correlation" },
    });
    expect(setup.headers["x-correlation-id"]).toBe("test-correlation");
    const cookie = setup.cookies.find((item) => item.name === "session")?.value;

    const diagnostics = await app.inject({
      method: "GET",
      url: "/api/diagnostics",
      cookies: { session: cookie! },
    });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      logging: {
        level: "silent",
        requests: false,
        quietRequests: true,
      },
      migrations: {
        current: getMigrationState().current,
        latest: getMigrationState().latest,
        pending: [],
      },
    });

    const attempts = [];
    for (let index = 0; index < 6; index += 1) {
      attempts.push(
        await app.inject({
          method: "POST",
          url: "/api/login",
          payload: { password: "wrong password" },
        }),
      );
    }
    expect(attempts.some((response) => response.statusCode === 429)).toBe(true);

    await app.close();
  });

  it("scopes library apps per account and rejects import before online", async () => {
    const app = await buildApp({ initSteam: false });
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        password: "correct horse battery staple",
        setupToken: "steam-bee-test-setup-token",
      },
    });
    const cookie = setup.cookies.find((item) => item.name === "session")?.value;
    const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
    const now = Date.now();
    const accountA = {
      id: crypto.randomUUID(),
      accountName: `account-a-${now}`,
      steamId: "76561198000000001",
      status: "disconnected",
      desiredState: "stopped",
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
    const accountB = {
      ...accountA,
      id: crypto.randomUUID(),
      accountName: `account-b-${now}`,
      steamId: "76561198000000002",
    };

    await db.insert(steamAccount).values([accountA, accountB]);
    await db.insert(steamAppCache).values([
      {
        appId: 730,
        name: "Counter-Strike 2",
        playtimeForever: 42,
        source: "library",
        updatedAt: now,
      },
      {
        appId: 440,
        name: "Team Fortress 2",
        playtimeForever: 7,
        source: "library",
        updatedAt: now,
      },
    ]);
    await db.insert(steamAccountLibrary).values([
      {
        accountId: accountA.id,
        appId: 730,
        playtimeForever: 42,
        source: "library",
        importedAt: now,
      },
      {
        accountId: accountB.id,
        appId: 440,
        playtimeForever: 7,
        source: "library",
        importedAt: now,
      },
    ]);

    const accountsResponse = await app.inject({
      method: "GET",
      url: "/api/accounts",
      cookies: { session: cookie! },
    });
    const presentedAccounts =
      accountsResponse.json<Array<Record<string, unknown>>>();
    expect(presentedAccounts[0]).not.toHaveProperty("tokenCiphertext");
    expect(presentedAccounts[0]).not.toHaveProperty("tokenIv");
    expect(presentedAccounts[0]).not.toHaveProperty("tokenAuthTag");
    expect(presentedAccounts[0]?.games).toEqual([]);

    const libraryA = await app.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/library`,
      cookies: { session: cookie! },
    });
    expect(libraryA.statusCode).toBe(200);
    expect(libraryA.json()).toEqual([
      {
        appId: 730,
        favorite: false,
        hidden: false,
        name: "Counter-Strike 2",
        playtimeForever: 42,
        source: "library",
        tags: [],
      },
    ]);

    const importAttempt = await app.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/library/import`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(importAttempt.statusCode).toBe(409);
    expect(importAttempt.json()).toMatchObject({
      error: expect.stringMatching(/not connected to Steam/),
    });

    await app.close();
  });

  it("manages presets, schedules, library metadata, analytics and system status", async () => {
    const app = await buildApp({ initSteam: false });
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        password: "correct horse battery staple",
        setupToken: "steam-bee-test-setup-token",
      },
    });
    const cookie = setup.cookies.find((item) => item.name === "session")?.value;
    const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
    const now = Date.now();
    const account = {
      id: crypto.randomUUID(),
      accountName: `feature-account-${now}`,
      steamId: "76561198000000003",
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
      playtimeForever: 42,
      source: "library",
      updatedAt: now,
    });
    await db.insert(steamAccountLibrary).values({
      accountId: account.id,
      appId: 730,
      playtimeForever: 42,
      source: "library",
      importedAt: now,
    });

    const preset = await app.inject({
      method: "POST",
      url: `/api/accounts/${account.id}/presets`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
      payload: {
        name: "Evening",
        appIds: [730],
        personaState: 7,
        customTitle: null,
      },
    });
    expect(preset.statusCode).toBe(200);
    const presetId = preset.json<{ id: string }>().id;

    const apply = await app.inject({
      method: "POST",
      url: `/api/accounts/${account.id}/presets/${presetId}/apply`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(apply.statusCode).toBe(200);

    const schedule = await app.inject({
      method: "POST",
      url: `/api/accounts/${account.id}/schedules`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
      payload: {
        name: "Werktag",
        presetId,
        enabled: true,
        weekdays: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "18:00",
        timezone: "UTC",
      },
    });
    expect(schedule.statusCode).toBe(200);
    expect(schedule.json()).toMatchObject({
      name: "Werktag",
      presetId,
      weekdays: [1, 2, 3, 4, 5],
    });

    const meta = await app.inject({
      method: "PUT",
      url: `/api/accounts/${account.id}/library/meta`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
      payload: { appId: 730, favorite: true, tags: ["fps", "idle"] },
    });
    expect(meta.statusCode).toBe(200);

    const library = await app.inject({
      method: "GET",
      url: `/api/accounts/${account.id}/library`,
      cookies: { session: cookie! },
    });
    expect(library.json()).toMatchObject([
      { appId: 730, favorite: true, tags: ["fps", "idle"] },
    ]);

    await db.insert(boostSession).values({
      id: crypto.randomUUID(),
      accountId: account.id,
      presetId,
      appIdsJson: JSON.stringify([730]),
      startedAt: now - 60_000,
      endedAt: now,
      stopReason: "test",
      createdAt: now - 60_000,
    });
    const analytics = await app.inject({
      method: "GET",
      url: `/api/accounts/${account.id}/analytics`,
      cookies: { session: cookie! },
    });
    expect(analytics.statusCode).toBe(200);
    const analyticsBody = analytics.json<{
      totalSessions: number;
      topGames: Array<{ appId: number; name: string; durationMs: number }>;
    }>();
    expect(analyticsBody.totalSessions).toBeGreaterThanOrEqual(1);
    expect(analyticsBody.topGames[0]).toMatchObject({
      appId: 730,
      name: "Counter-Strike 2",
    });
    expect(analyticsBody.topGames[0]?.durationMs).toBeGreaterThanOrEqual(
      60_000,
    );

    const systemStatus = await app.inject({
      method: "GET",
      url: "/api/system/status",
      cookies: { session: cookie! },
    });
    expect(systemStatus.statusCode).toBe(200);
    expect(systemStatus.json()).toMatchObject({ label: "System ok" });

    await app.close();
  });

  it("updates and deletes presets and schedules without leaking across accounts", async () => {
    const app = await buildApp({ initSteam: false });
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        password: "correct horse battery staple",
        setupToken: "steam-bee-test-setup-token",
      },
    });
    const cookie = setup.cookies.find((item) => item.name === "session")?.value;
    const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
    const now = Date.now();
    const accountA = {
      id: crypto.randomUUID(),
      accountName: `preset-a-${now}`,
      steamId: "76561198000000011",
      status: "disconnected",
      desiredState: "stopped",
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
    const accountB = {
      ...accountA,
      id: crypto.randomUUID(),
      accountName: `preset-b-${now}`,
      steamId: "76561198000000012",
    };
    await db.insert(steamAccount).values([accountA, accountB]);

    const createPreset = await app.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/presets`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
      payload: {
        name: "Original",
        appIds: [730, 4000],
        personaState: 7,
        customTitle: null,
      },
    });
    expect(createPreset.statusCode).toBe(200);
    const presetId = createPreset.json<{ id: string }>().id;

    const presetB = await app.inject({
      method: "GET",
      url: `/api/accounts/${accountB.id}/presets`,
      cookies: { session: cookie! },
    });
    expect(presetB.statusCode).toBe(200);
    expect(presetB.json()).toEqual([]);

    const updatePreset = await app.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/presets/${presetId}`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
      payload: {
        name: "Aktualisiert",
        appIds: [440],
        personaState: 1,
        customTitle: "Idle Set",
      },
    });
    expect(updatePreset.statusCode).toBe(200);
    expect(updatePreset.json()).toMatchObject({
      id: presetId,
      name: "Aktualisiert",
      appIds: [440],
      personaState: 1,
      customTitle: "Idle Set",
    });

    const createSchedule = await app.inject({
      method: "POST",
      url: `/api/accounts/${accountA.id}/schedules`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
      payload: {
        name: "Evenings",
        presetId,
        enabled: true,
        weekdays: [0, 6],
        startTime: "20:00",
        endTime: "23:00",
        timezone: "UTC",
      },
    });
    expect(createSchedule.statusCode).toBe(200);
    const scheduleId = createSchedule.json<{ id: string }>().id;

    const updateSchedule = await app.inject({
      method: "PUT",
      url: `/api/accounts/${accountA.id}/schedules/${scheduleId}`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
      payload: { enabled: false, weekdays: [1, 2], startTime: "10:00" },
    });
    expect(updateSchedule.statusCode).toBe(200);
    expect(updateSchedule.json()).toMatchObject({
      id: scheduleId,
      enabled: false,
      weekdays: [1, 2],
      startTime: "10:00",
      endTime: "23:00",
    });

    const deleteSchedule = await app.inject({
      method: "DELETE",
      url: `/api/accounts/${accountA.id}/schedules/${scheduleId}`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(deleteSchedule.statusCode).toBe(200);
    const schedulesAfterDelete = await app.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/schedules`,
      cookies: { session: cookie! },
    });
    expect(schedulesAfterDelete.json()).toEqual([]);

    const deletePreset = await app.inject({
      method: "DELETE",
      url: `/api/accounts/${accountA.id}/presets/${presetId}`,
      cookies: { session: cookie! },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(deletePreset.statusCode).toBe(200);
    const presetsAfterDelete = await app.inject({
      method: "GET",
      url: `/api/accounts/${accountA.id}/presets`,
      cookies: { session: cookie! },
    });
    expect(presetsAfterDelete.json()).toEqual([]);

    await app.close();
  });

  it("reports system attention when accounts or recent events are in error", async () => {
    const app = await buildApp({ initSteam: false });
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        password: "correct horse battery staple",
        setupToken: "steam-bee-test-setup-token",
      },
    });
    const cookie = setup.cookies.find((item) => item.name === "session")?.value;
    const now = Date.now();
    await db.insert(steamAccount).values({
      id: crypto.randomUUID(),
      accountName: `error-account-${now}`,
      steamId: "76561198000000021",
      status: "login_required",
      desiredState: "stopped",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      tokenKeyVersion: 1,
      lastError: "Refresh token expired",
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(steamEvent).values({
      accountId: null,
      level: "error",
      type: "steam.test.error",
      message: "Test error",
      metadataJson: "{}",
      createdAt: now,
    });

    const systemStatus = await app.inject({
      method: "GET",
      url: "/api/system/status",
      cookies: { session: cookie! },
    });
    expect(systemStatus.statusCode).toBe(200);
    expect(systemStatus.json()).toMatchObject({
      label: "Review errors",
      tone: "danger",
      accountErrors: 1,
    });

    await app.close();
  });
});
