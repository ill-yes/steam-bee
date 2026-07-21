import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptBackup } from "../src/backup/format.js";
import { buildApp } from "../src/app.js";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  boostPreset,
  boostSchedule,
  notificationDelivery,
  notificationRule,
  scheduleException,
  steamAccount,
  steamAccountLibrary,
  steamAppCache,
  steamEvent,
} from "../src/db/schema.js";
import { steamManager } from "../src/steam/manager.js";

describe("operations API", () => {
  beforeEach(async () => {
    await steamManager.shutdown();
    migrate();
    sqlite.exec(`
      DELETE FROM notification_rule;
      DELETE FROM account_group;
      DELETE FROM steam_account;
      DELETE FROM admin_session;
      DELETE FROM admin_user;
    `);
  });

  it("exposes safety, groups, snapshot goals, notifications and backups", async () => {
    const app = await buildApp({ initSteam: false });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookie = setup.cookies.find(
        (item) => item.name === "session",
      )!.value;
      const csrf = setup.json<{ csrfToken: string }>().csrfToken;
      const auth = {
        cookies: { session: cookie },
        headers: { "x-csrf-token": csrf },
      };
      const missingAccountId = crypto.randomUUID();
      for (const command of ["start", "pause", "resume", "stop"] as const) {
        const response = await app.inject({
          method: "POST",
          url: `/api/accounts/${missingAccountId}/${command}`,
          ...auth,
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
      }

      const now = Date.now();
      const accountId = crypto.randomUUID();
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: `operations-${now}`,
        status: "disconnected",
        desiredState: "stopped",
        personaState: 7,
        tokenKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(steamAppCache).values({
        appId: 730,
        name: "Counter-Strike 2",
        playtimeForever: 120,
        source: "library",
        updatedAt: now,
      });
      await db.insert(steamAccountLibrary).values({
        accountId,
        appId: 730,
        playtimeForever: 120,
        source: "library",
        importedAt: now,
      });

      const accounts = await app.inject({
        method: "GET",
        url: "/api/accounts",
        cookies: auth.cookies,
      });
      expect(accounts.statusCode).toBe(200);
      expect(accounts.json()[0]).toMatchObject({
        health: { libraryImportedAt: now, retryAttempt: 0 },
        safety: { resumePolicy: "automatic" },
      });

      const safety = await app.inject({
        method: "PUT",
        url: `/api/accounts/${accountId}/safety`,
        ...auth,
        payload: {
          resumePolicy: "manual",
          resumeDelayMinutes: 30,
          maxSessionMinutes: 60,
          maxDailyMinutes: 120,
          maxWeeklyMinutes: null,
        },
      });
      expect(safety.statusCode).toBe(200);
      expect(safety.json()).toMatchObject({
        resumePolicy: "manual",
        maxSessionMinutes: 60,
      });

      const goal = await app.inject({
        method: "PUT",
        url: `/api/accounts/${accountId}/goals`,
        ...auth,
        payload: { appId: 730, targetMinutes: 240 },
      });
      expect(goal.statusCode).toBe(200);
      expect(goal.json()[0]).toMatchObject({
        appName: "Counter-Strike 2",
        currentMinutes: 120,
        progressPercent: 50,
      });

      const group = await app.inject({
        method: "POST",
        url: "/api/account-groups",
        ...auth,
        payload: { name: "Safe stop", accountIds: [accountId] },
      });
      expect(group.statusCode).toBe(200);
      const groupId = group.json<{ id: string }>().id;
      const stopped = await app.inject({
        method: "POST",
        url: `/api/account-groups/${groupId}/actions/stop`,
        ...auth,
      });
      expect(stopped.json()).toMatchObject({
        command: "stop",
        results: [{ accountId, ok: true, error: null }],
      });

      const notification = await app.inject({
        method: "POST",
        url: "/api/notifications/rules",
        ...auth,
        payload: {
          name: "Browser safety",
          target: "browser",
          enabled: true,
          eventTypes: ["steam.safety.cap"],
        },
      });
      expect(notification.statusCode).toBe(200);
      expect(notification.json()[0]).toMatchObject({
        target: "browser",
        enabled: true,
        webhookConfigured: false,
      });

      const backup = await app.inject({
        method: "POST",
        url: "/api/admin/backup",
        ...auth,
        payload: { passphrase: "correct horse battery staple" },
      });
      expect(backup.statusCode).toBe(200);
      expect(backup.headers["content-type"]).toContain(
        "application/vnd.steam-bee.backup",
      );
      const decrypted = decryptBackup(
        backup.rawPayload,
        "correct horse battery staple",
      );
      expect(decrypted.entries.map((entry) => entry.path).sort()).toEqual([
        "instance.secret",
        "steam-bee.sqlite",
      ]);
    } finally {
      await app.close();
    }
  });

  it("returns stable client errors for missing operations resources", async () => {
    const app = await buildApp({ initSteam: false });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookie = setup.cookies.find(
        (item) => item.name === "session",
      )!.value;
      const csrf = setup.json<{ csrfToken: string }>().csrfToken;
      const auth = {
        cookies: { session: cookie },
        headers: { "x-csrf-token": csrf },
      };
      const now = Date.now();
      const accountId = crypto.randomUUID();
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: `operations-errors-${now}`,
        status: "disconnected",
        desiredState: "stopped",
        personaState: 7,
        tokenKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      const goal = await app.inject({
        method: "PUT",
        url: `/api/accounts/${accountId}/goals`,
        ...auth,
        payload: { appId: 730, targetMinutes: 240 },
      });
      expect(goal.statusCode).toBe(409);
      expect(goal.json()).toEqual({
        error: "Import the game before creating a goal.",
        code: "CONFLICT",
      });

      const group = await app.inject({
        method: "POST",
        url: "/api/account-groups",
        ...auth,
        payload: {
          name: "Missing account",
          accountIds: [crypto.randomUUID()],
        },
      });
      expect(group.statusCode).toBe(404);
      expect(group.json()).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });

      const missingGroup = await app.inject({
        method: "POST",
        url: `/api/account-groups/${crypto.randomUUID()}/actions/stop`,
        ...auth,
      });
      expect(missingGroup.statusCode).toBe(404);
      expect(missingGroup.json()).toMatchObject({ code: "NOT_FOUND" });

      const missingRule = await app.inject({
        method: "PUT",
        url: `/api/notifications/rules/${crypto.randomUUID()}`,
        ...auth,
        payload: {
          name: "Missing rule",
          target: "browser",
          enabled: true,
          eventTypes: ["steam.status.error"],
        },
      });
      expect(missingRule.statusCode).toBe(404);
      expect(missingRule.json()).toMatchObject({ code: "NOT_FOUND" });

      const presetId = crypto.randomUUID();
      const scheduleId = crypto.randomUUID();
      await db.insert(boostPreset).values({
        id: presetId,
        accountId,
        name: "Disabled preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId,
        presetId,
        name: "Disabled schedule",
        enabled: false,
        weekdaysJson: "[1,2,3,4,5,6,7]",
        startTime: "09:00",
        endTime: "10:00",
        timezone: "UTC",
        createdAt: now,
        updatedAt: now,
      });
      const skip = await app.inject({
        method: "POST",
        url: `/api/accounts/${accountId}/schedules/${scheduleId}/skip-next`,
        ...auth,
      });
      expect(skip.statusCode).toBe(409);
      expect(skip.json()).toEqual({
        error: "No upcoming schedule window is available.",
        code: "CONFLICT",
      });
    } finally {
      await app.close();
    }
  });

  it("serializes skip-next with scheduler work and schedule deletion", async () => {
    const app = await buildApp({ initSteam: false });
    let releaseBlocker = () => {};
    let blocker: Promise<void> | undefined;
    let runSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookie = setup.cookies.find(
        (item) => item.name === "session",
      )!.value;
      const csrf = setup.json<{ csrfToken: string }>().csrfToken;
      const auth = {
        cookies: { session: cookie },
        headers: { "x-csrf-token": csrf },
      };
      const now = Date.now();
      const accountId = crypto.randomUUID();
      const presetId = crypto.randomUUID();
      const scheduleId = crypto.randomUUID();
      const startsAt = new Date(now + 60 * 60_000);
      const endsAt = new Date(now + 2 * 60 * 60_000);
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: `skip-race-${now}`,
        status: "disconnected",
        desiredState: "stopped",
        personaState: 7,
        tokenKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostPreset).values({
        id: presetId,
        accountId,
        name: "Skip race preset",
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSchedule).values({
        id: scheduleId,
        accountId,
        presetId,
        name: "Skip race schedule",
        enabled: true,
        weekdaysJson: "[0,1,2,3,4,5,6]",
        startTime: utcTime(startsAt),
        endTime: utcTime(endsAt),
        timezone: "UTC",
        createdAt: now,
        updatedAt: now,
      });

      let markBlocked = () => {};
      const blocked = new Promise<void>((resolve) => {
        markBlocked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      blocker = steamManager.runAccountOperation(accountId, async () => {
        markBlocked();
        await gate;
      });
      await blocked;

      const originalRun = steamManager.runAccountOperation.bind(steamManager);
      let markSkipQueued = () => {};
      const skipQueued = new Promise<void>((resolve) => {
        markSkipQueued = resolve;
      });
      runSpy = vi
        .spyOn(steamManager, "runAccountOperation")
        .mockImplementation((queuedAccountId, operation) => {
          if (queuedAccountId === accountId) markSkipQueued();
          return originalRun(queuedAccountId, operation);
        });
      const skipping = app.inject({
        method: "POST",
        url: `/api/accounts/${accountId}/schedules/${scheduleId}/skip-next`,
        ...auth,
      });
      await skipQueued;
      runSpy.mockRestore();
      runSpy = undefined;

      let schedulerObservedSkip = false;
      const schedulerMutation = steamManager.runAccountOperation(
        accountId,
        async () => {
          schedulerObservedSkip = Boolean(
            await db.query.scheduleException.findFirst({
              where: and(
                eq(scheduleException.accountId, accountId),
                eq(scheduleException.scheduleId, scheduleId),
              ),
            }),
          );
        },
      );
      const deletion = app.inject({
        method: "DELETE",
        url: `/api/accounts/${accountId}/schedules/${scheduleId}`,
        ...auth,
      });

      releaseBlocker();
      await blocker;
      const [skipResponse, deleteResponse] = await Promise.all([
        skipping,
        deletion,
      ]);
      await schedulerMutation;

      expect(skipResponse.statusCode).toBe(200);
      expect(schedulerObservedSkip).toBe(true);
      expect(deleteResponse.statusCode).toBe(200);
    } finally {
      runSpy?.mockRestore();
      releaseBlocker();
      await blocker?.catch(() => undefined);
      await app.close();
      await steamManager.shutdown();
    }
  });

  it("starts a fresh delivery window when a notification rule changes", async () => {
    const app = await buildApp({ initSteam: false });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookie = setup.cookies.find(
        (item) => item.name === "session",
      )!.value;
      const csrf = setup.json<{ csrfToken: string }>().csrfToken;
      const ruleId = crypto.randomUUID();
      const eventAt = Date.now() - 5_000;
      await db.insert(notificationRule).values({
        id: ruleId,
        name: "Old rule",
        target: "webhook",
        enabled: true,
        eventTypesJson: JSON.stringify(["steam.status.error"]),
        webhookKeyVersion: 1,
        failureCount: 0,
        createdAt: eventAt - 1_000,
        updatedAt: eventAt - 1_000,
      });
      const [event] = await db
        .insert(steamEvent)
        .values({
          accountId: null,
          level: "error",
          type: "steam.status.error",
          message: "Old event",
          metadataJson: "{}",
          createdAt: eventAt,
        })
        .returning();
      await db.insert(notificationDelivery).values({
        id: crypto.randomUUID(),
        ruleId,
        eventId: event.id,
        status: "pending",
        attempts: 0,
        nextAttemptAt: eventAt,
        createdAt: eventAt,
        updatedAt: eventAt,
      });

      const response = await app.inject({
        method: "PUT",
        url: `/api/notifications/rules/${ruleId}`,
        cookies: { session: cookie },
        headers: { "x-csrf-token": csrf },
        payload: {
          name: "New browser rule",
          target: "browser",
          enabled: true,
          eventTypes: ["steam.safety.cap"],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(await db.select().from(notificationDelivery)).toEqual([]);
      const updated = await db.query.notificationRule.findFirst({
        where: eq(notificationRule.id, ruleId),
      });
      expect(updated).toMatchObject({
        name: "New browser rule",
        target: "browser",
        failureCount: 0,
      });
      expect(updated?.createdAt).toBeGreaterThan(eventAt);
    } finally {
      await app.close();
    }
  });

  it("reports configured and effective notification rule health", async () => {
    const app = await buildApp({ initSteam: false });
    try {
      const now = Date.now();
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookie = setup.cookies.find(
        (item) => item.name === "session",
      )!.value;
      const rules = [
        { name: "active", enabled: true, failureCount: 0 },
        { name: "disabled", enabled: false, failureCount: 0 },
        { name: "failed", enabled: true, failureCount: 2 },
        {
          name: "suspended",
          enabled: true,
          failureCount: 5,
          disabledUntil: now + 60_000,
        },
        { name: "retrying", enabled: true, failureCount: 1 },
      ].map((rule) => ({
        id: crypto.randomUUID(),
        target: "webhook",
        eventTypesJson: JSON.stringify(["steam.status.error"]),
        webhookKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
        disabledUntil: null,
        ...rule,
      }));
      await db.insert(notificationRule).values(rules);
      const [event] = await db
        .insert(steamEvent)
        .values({
          accountId: null,
          level: "error",
          type: "steam.status.error",
          message: "Synthetic failure",
          metadataJson: "{}",
          createdAt: now,
        })
        .returning();
      const nextRetryAt = now + 30_000;
      const retryingRuleId = rules.find((rule) => rule.name === "retrying")!.id;
      const deliveredEvents = await db
        .insert(steamEvent)
        .values(
          Array.from({ length: 75 }, (_, index) => ({
            accountId: null,
            level: "info",
            type: "steam.status.ready",
            message: `Historical delivery ${index}`,
            metadataJson: "{}",
            createdAt: now - index - 1,
          })),
        )
        .returning();
      await db.insert(notificationDelivery).values([
        ...deliveredEvents.map((deliveredEvent) => ({
          id: crypto.randomUUID(),
          ruleId: retryingRuleId,
          eventId: deliveredEvent.id,
          status: "delivered",
          attempts: 1,
          nextAttemptAt: null,
          createdAt: now,
          updatedAt: now,
        })),
        {
          id: crypto.randomUUID(),
          ruleId: retryingRuleId,
          eventId: event.id,
          status: "retry",
          attempts: 1,
          nextAttemptAt: nextRetryAt,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/notifications/rules",
        cookies: { session: cookie },
      });
      expect(response.statusCode).toBe(200);
      const byName = Object.fromEntries(
        response
          .json<Array<Record<string, unknown>>>()
          .map((rule) => [rule.name, rule]),
      );
      expect(byName.active).toMatchObject({
        effectiveEnabled: true,
        effectiveStatus: "active",
        failureCount: 0,
        nextRetryAt: null,
        suspendedUntil: null,
      });
      expect(byName.disabled).toMatchObject({
        effectiveEnabled: false,
        effectiveStatus: "disabled",
      });
      expect(byName.failed).toMatchObject({
        effectiveEnabled: true,
        effectiveStatus: "failed",
        failureCount: 2,
      });
      expect(byName.suspended).toMatchObject({
        effectiveEnabled: false,
        effectiveStatus: "suspended",
        suspendedUntil: now + 60_000,
      });
      expect(byName.retrying).toMatchObject({
        effectiveEnabled: true,
        effectiveStatus: "retrying",
        nextRetryAt,
      });
    } finally {
      await app.close();
    }
  });

  it("atomically upserts concurrent browser notification rules", async () => {
    const app = await buildApp({ initSteam: false });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookie = setup.cookies.find(
        (item) => item.name === "session",
      )!.value;
      const csrf = setup.json<{ csrfToken: string }>().csrfToken;
      const request = () =>
        app.inject({
          method: "POST",
          url: "/api/notifications/rules",
          cookies: { session: cookie },
          headers: { "x-csrf-token": csrf },
          payload: {
            name: "Browser alerts",
            target: "browser",
            enabled: true,
            eventTypes: ["steam.status.error"],
          },
        });

      const responses = await Promise.all([request(), request()]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        200, 200,
      ]);
      const browserRules = await db
        .select()
        .from(notificationRule)
        .where(eq(notificationRule.target, "browser"));
      expect(browserRules).toHaveLength(1);
      expect(browserRules[0]).toMatchObject({
        name: "Browser alerts",
        enabled: true,
        eventTypesJson: JSON.stringify(["steam.status.error"]),
      });
    } finally {
      await app.close();
    }
  });

  it("validates pause-until against request time", async () => {
    const registeredAt = 2_000_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(registeredAt);
    const app = await buildApp({ initSteam: false });
    try {
      const setup = await app.inject({
        method: "POST",
        url: "/api/setup",
        payload: {
          password: "correct horse battery staple",
          setupToken: "steam-bee-test-setup-token",
        },
      });
      const cookie = setup.cookies.find(
        (item) => item.name === "session",
      )!.value;
      const csrf = setup.json<{ csrfToken: string }>().csrfToken;
      const accountId = crypto.randomUUID();
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: "pause-request-time",
        status: "disconnected",
        desiredState: "stopped",
        personaState: 7,
        tokenKeyVersion: 1,
        createdAt: registeredAt,
        updatedAt: registeredAt,
      });

      nowSpy.mockReturnValue(registeredAt + 60_000);
      const response = await app.inject({
        method: "POST",
        url: `/api/accounts/${accountId}/safety/pause-until`,
        cookies: { session: cookie },
        headers: { "x-csrf-token": csrf },
        payload: { until: registeredAt + 90_000 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    } finally {
      await app.close();
      nowSpy.mockRestore();
    }
  });
});

function utcTime(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}`;
}
