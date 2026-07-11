import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  boostSession,
  steamAccount,
  steamAccountGame,
  steamEvent,
} from "../src/db/schema.js";
import { trackBoostSession } from "../src/steam/boost-session-tracker.js";
import {
  SteamStatusEventRecorder,
  steamStatusEventMessage,
} from "../src/steam/status-event-recorder.js";

describe("Steam manager services", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec(`
      DELETE FROM steam_event;
      DELETE FROM boost_session;
      DELETE FROM steam_account_game;
      DELETE FROM boost_schedule;
      DELETE FROM boost_preset_game;
      DELETE FROM boost_preset;
      DELETE FROM steam_account;
    `);
  });

  it("formats status events exhaustively and includes worker errors", () => {
    expect(steamStatusEventMessage("boosting")).toBe(
      "Active game selection is being reported to Steam.",
    );
    expect(steamStatusEventMessage("login_required", "Token expired")).toBe(
      "Login required: Token expired",
    );
  });

  it("deduplicates repeated status events and preserves operation metadata", async () => {
    const accountId = await insertAccount();
    const recorder = new SteamStatusEventRecorder(() => ({
      source: "test",
      correlationId: "operation-1",
    }));
    const status = { accountId, status: "online" as const };

    await recorder.record(status);
    await recorder.record(status);

    const events = await db
      .select()
      .from(steamEvent)
      .where(eq(steamEvent.accountId, accountId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: "info",
      type: "steam.status",
      message: "Steam session is online.",
    });
    expect(JSON.parse(events[0]?.metadataJson ?? "{}")).toEqual({
      source: "test",
      correlationId: "operation-1",
      status: "online",
      hasError: false,
    });
  });

  it("retries a status event after a transient write failure", async () => {
    const accountId = await insertAccount();
    const recorder = new SteamStatusEventRecorder(() => ({}));
    const status = { accountId, status: "online" as const };
    sqlite.exec(`
      CREATE TRIGGER reject_status_event
      BEFORE INSERT ON steam_event
      WHEN NEW.type = 'steam.status'
      BEGIN
        SELECT RAISE(ABORT, 'status event insert rejected');
      END;
    `);

    try {
      await expect(recorder.record(status)).resolves.toBeUndefined();
    } finally {
      sqlite.exec("DROP TRIGGER reject_status_event;");
    }

    await recorder.record(status);
    const events = await db
      .select()
      .from(steamEvent)
      .where(eq(steamEvent.accountId, accountId));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("steam.status");
  });

  it("redacts worker errors before storing or caching status messages", async () => {
    const accountId = await insertAccount();
    const recorder = new SteamStatusEventRecorder(() => ({}));
    const secret = "do-not-store-this";
    const status = {
      accountId,
      status: "error" as const,
      error: `refresh_token=${secret}`,
    };

    await recorder.record(status);
    await recorder.record(status);

    const events = await db
      .select()
      .from(steamEvent)
      .where(eq(steamEvent.accountId, accountId));
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe("error");
    expect(events[0]?.message).toContain("[redacted]");
    expect(events[0]?.message).not.toContain(secret);
  });

  it("opens one boost session and closes it on the next non-boosting status", async () => {
    const accountId = await insertAccount();
    const now = Date.now();
    await db.insert(steamAccountGame).values([
      {
        accountId,
        appId: 730,
        enabled: true,
        source: "manual",
        createdAt: now,
      },
      {
        accountId,
        appId: 570,
        enabled: false,
        source: "manual",
        createdAt: now,
      },
    ]);

    await trackBoostSession(accountId, "boosting");
    await trackBoostSession(accountId, "boosting");

    let sessions = await db
      .select()
      .from(boostSession)
      .where(eq(boostSession.accountId, accountId));
    expect(sessions).toHaveLength(1);
    expect(JSON.parse(sessions[0]?.appIdsJson ?? "[]")).toEqual([730]);
    expect(sessions[0]).toMatchObject({
      endedAt: null,
      stopReason: null,
    });

    await trackBoostSession(accountId, "paused_manual");

    sessions = await db
      .select()
      .from(boostSession)
      .where(eq(boostSession.accountId, accountId));
    expect(sessions[0]?.endedAt).toEqual(expect.any(Number));
    expect(sessions[0]?.stopReason).toBe("paused_manual");

    const events = await db
      .select()
      .from(steamEvent)
      .where(eq(steamEvent.accountId, accountId));
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "steam.boost.session.start",
        "steam.boost.session.end",
      ]),
    );
  });
});

async function insertAccount() {
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.insert(steamAccount).values({
    id,
    accountName: `manager-service-${id}`,
    status: "disconnected",
    desiredState: "stopped",
    personaState: 7,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
