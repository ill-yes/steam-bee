import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  boostPreset,
  boostPresetGame,
  boostSchedule,
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
  steamAppCache,
  steamEvent,
} from "../src/db/schema.js";

const password = "correct horse battery staple";
const nextPassword = "correct horse battery staple updated";

describe("admin api", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM boost_session;
      DELETE FROM boost_schedule;
      DELETE FROM boost_preset_game;
      DELETE FROM boost_preset;
      DELETE FROM steam_account_library;
      DELETE FROM steam_account_game;
      DELETE FROM steam_app_cache;
      DELETE FROM steam_account;
      DELETE FROM admin_session;
      DELETE FROM admin_user;
    `);
  });

  it("changes the admin password and revokes other sessions", async () => {
    const app = await buildApp({ initSteam: false });
    const first = await setup(app);
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password },
    });
    const secondCookie = sessionCookie(secondLogin);

    const sessionsBefore = await app.inject({
      method: "GET",
      url: "/api/admin/sessions",
      cookies: { session: first.cookie },
    });
    expect(sessionsBefore.statusCode).toBe(200);
    expect(sessionsBefore.json()).toHaveLength(2);

    const rejected = await app.inject({
      method: "PUT",
      url: "/api/admin/password",
      cookies: { session: first.cookie },
      headers: { "x-csrf-token": first.csrfToken },
      payload: {
        currentPassword: "wrong password",
        newPassword: nextPassword,
      },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toMatchObject({
      error: "Current password is invalid.",
    });

    const changed = await app.inject({
      method: "PUT",
      url: "/api/admin/password",
      cookies: { session: first.cookie },
      headers: { "x-csrf-token": first.csrfToken },
      payload: {
        currentPassword: password,
        newPassword: nextPassword,
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ revokedSessions: 1 });

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/accounts",
      cookies: { session: secondCookie },
    });
    expect(oldSession.statusCode).toBe(401);

    const sessionsAfter = await app.inject({
      method: "GET",
      url: "/api/admin/sessions",
      cookies: { session: first.cookie },
    });
    expect(sessionsAfter.json()).toHaveLength(1);
    expect(sessionsAfter.json<Array<{ current: boolean }>>()[0]?.current).toBe(
      true,
    );

    const loginWithNewPassword = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: nextPassword },
    });
    expect(loginWithNewPassword.statusCode).toBe(200);

    await app.close();
  });

  it("lists and revokes non-current admin sessions", async () => {
    const app = await buildApp({ initSteam: false });
    const first = await setup(app);
    await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password },
    });

    const sessions = await app.inject({
      method: "GET",
      url: "/api/admin/sessions",
      cookies: { session: first.cookie },
    });
    const target = sessions
      .json<Array<{ id: string; current: boolean }>>()
      .find((session) => !session.current);
    expect(target).toBeTruthy();

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/sessions/${target!.id}`,
      cookies: { session: first.cookie },
      headers: { "x-csrf-token": first.csrfToken },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deleted: true });

    const current = sessions
      .json<Array<{ id: string; current: boolean }>>()
      .find((session) => session.current);
    const rejectCurrent = await app.inject({
      method: "DELETE",
      url: `/api/admin/sessions/${current!.id}`,
      cookies: { session: first.cookie },
      headers: { "x-csrf-token": first.csrfToken },
    });
    expect(rejectCurrent.statusCode).toBe(409);

    await app.close();
  });

  it("summarizes admin data and cleans events, libraries and app cache", async () => {
    const app = await buildApp({ initSteam: false });
    const auth = await setup(app);
    const now = Date.now();
    const accountId = crypto.randomUUID();
    const presetId = crypto.randomUUID();
    const scheduleId = crypto.randomUUID();

    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `admin-account-${now}`,
      steamId: "76561198000000031",
      status: "online",
      desiredState: "running",
      personaState: 7,
      customTitle: null,
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: now + 1_000_000,
      tokenKeyVersion: 1,
      lastError: null,
      latestBoostStartedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(steamAppCache).values([
      {
        appId: 730,
        name: "Counter-Strike 2",
        playtimeForever: 60,
        source: "library",
        updatedAt: now,
      },
      {
        appId: 999_999,
        name: "Unused App",
        playtimeForever: 0,
        source: "manual",
        updatedAt: now,
      },
    ]);
    await db.insert(steamAccountLibrary).values({
      accountId,
      appId: 730,
      playtimeForever: 60,
      source: "library",
      importedAt: now,
    });
    await db.insert(steamAccountGame).values({
      accountId,
      appId: 730,
      enabled: true,
      source: "manual",
      createdAt: now,
    });
    await db.insert(boostPreset).values({
      id: presetId,
      accountId,
      name: "Admin Preset",
      personaState: 7,
      customTitle: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(boostPresetGame).values({
      presetId,
      appId: 730,
      createdAt: now,
    });
    await db.insert(boostSchedule).values({
      id: scheduleId,
      accountId,
      presetId,
      name: "Admin Schedule",
      enabled: true,
      weekdaysJson: JSON.stringify([1, 2, 3, 4, 5]),
      startTime: "09:00",
      endTime: "18:00",
      timezone: "UTC",
      lastStartedWindow: null,
      lastStoppedWindow: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(steamEvent).values([
      {
        accountId,
        level: "info",
        type: "admin.test.info",
        message: "Aktueller Testlog",
        metadataJson: "{}",
        createdAt: now,
      },
      {
        accountId,
        level: "error",
        type: "admin.test.error",
        message: "Alter Testlog",
        metadataJson: "{}",
        createdAt: now - 10 * 24 * 60 * 60_000,
      },
    ]);

    const overview = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
      cookies: { session: auth.cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      totals: {
        accounts: 1,
        events: 2,
        presets: 1,
        schedules: 1,
        appCache: 2,
        libraryEntries: 1,
        selectedGames: 1,
      },
    });
    expect(
      overview.json<{ accounts: Array<{ libraryAppCount: number }> }>()
        .accounts[0]?.libraryAppCount,
    ).toBe(1);
    expect(
      overview.json<{ accounts: Array<Record<string, unknown>> }>().accounts[0],
    ).not.toHaveProperty("games");

    const deleteOldEvents = await app.inject({
      method: "DELETE",
      url: `/api/admin/events?olderThan=${now - 7 * 24 * 60 * 60_000}`,
      cookies: { session: auth.cookie },
      headers: { "x-csrf-token": auth.csrfToken },
    });
    expect(deleteOldEvents.statusCode).toBe(200);
    expect(deleteOldEvents.json()).toMatchObject({ deleted: 1 });

    const clearLibrary = await app.inject({
      method: "DELETE",
      url: `/api/admin/accounts/${accountId}/library`,
      cookies: { session: auth.cookie },
      headers: { "x-csrf-token": auth.csrfToken },
    });
    expect(clearLibrary.statusCode).toBe(200);
    expect(clearLibrary.json()).toMatchObject({ deleted: 1 });

    const rejectedUnscopedCleanup = await app.inject({
      method: "DELETE",
      url: "/api/admin/app-cache",
      cookies: { session: auth.cookie },
      headers: { "x-csrf-token": auth.csrfToken },
    });
    expect(rejectedUnscopedCleanup.statusCode).toBe(400);
    expect(rejectedUnscopedCleanup.json()).toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const clearUnusedApps = await app.inject({
      method: "DELETE",
      url: "/api/admin/app-cache?unused=true",
      cookies: { session: auth.cookie },
      headers: { "x-csrf-token": auth.csrfToken },
    });
    expect(clearUnusedApps.statusCode).toBe(200);
    expect(clearUnusedApps.json()).toMatchObject({ deleted: 1 });

    const deleteUsedApp = await app.inject({
      method: "DELETE",
      url: "/api/admin/app-cache/730",
      cookies: { session: auth.cookie },
      headers: { "x-csrf-token": auth.csrfToken },
    });
    expect(deleteUsedApp.statusCode).toBe(200);
    expect(deleteUsedApp.json()).toMatchObject({ deleted: true });

    const overviewAfter = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
      cookies: { session: auth.cookie },
    });
    expect(overviewAfter.json()).toMatchObject({
      totals: {
        appCache: 0,
        libraryEntries: 0,
      },
    });

    await app.close();
  });

  it("protects admin mutations with authentication and csrf", async () => {
    const app = await buildApp({ initSteam: false });
    const auth = await setup(app);

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missingCsrf = await app.inject({
      method: "DELETE",
      url: "/api/admin/events?level=info",
      cookies: { session: auth.cookie },
    });
    expect(missingCsrf.statusCode).toBe(403);

    await app.close();
  });
});

async function setup(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/setup",
    payload: { password, setupToken: "steam-bee-test-setup-token" },
  });
  return {
    cookie: sessionCookie(response),
    csrfToken: response.json<{ csrfToken: string }>().csrfToken,
  };
}

function sessionCookie(response: {
  cookies: Array<{ name: string; value: string }>;
}) {
  const cookie = response.cookies.find(
    (item) => item.name === "session",
  )?.value;
  expect(cookie).toBeTruthy();
  return cookie!;
}
