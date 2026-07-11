import { beforeEach, describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { db, migrate, sqlite } from "../src/db/client.js";
import { steamEvent } from "../src/db/schema.js";
import { config } from "../src/config.js";
import {
  cleanupRetainedEvents,
  recordEvent,
  recordInfoEventSafely,
} from "../src/http/events.js";

describe("event logging", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec("DELETE FROM steam_event;");
  });

  it("redacts sensitive event metadata before storage", async () => {
    await recordEvent({
      level: "info",
      type: "test.redaction",
      message: "Redaction test",
      metadata: {
        refreshToken: "header.payload.signature",
        nested: {
          guardCode: "12345",
          safeCount: 2,
        },
      },
    });

    const [event] = await db
      .select()
      .from(steamEvent)
      .orderBy(desc(steamEvent.createdAt))
      .limit(1);

    expect(JSON.parse(event.metadataJson)).toEqual({
      refreshToken: "[redacted]",
      nested: {
        guardCode: "[redacted]",
        safeCount: 2,
      },
    });
  });

  it("redacts Bearer tokens, JWTs and assigned secrets from event text", async () => {
    const bearerToken = "steam-access-token-1234567890";
    const jwt = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "very-secret-signature",
    ].join(".");
    const plainSecret = "do-not-store-this";
    const dottedSecret = `${"a".repeat(32)}.${"b".repeat(16)}`;

    const saved = await recordEvent({
      level: "error",
      type: "test.message-redaction",
      message: `Login failed with Bearer ${bearerToken}; jwt=${jwt}; secret=${plainSecret}; ${dottedSecret}`,
      metadata: {
        details: `Upstream returned Bearer ${bearerToken} and ${jwt}`,
      },
    });

    const [stored] = await db
      .select()
      .from(steamEvent)
      .orderBy(desc(steamEvent.createdAt))
      .limit(1);
    const serialized = JSON.stringify({
      message: stored.message,
      metadata: JSON.parse(stored.metadataJson),
    });

    expect(saved.message).toBe(stored.message);
    expect(saved.metadata).toEqual({
      details: expect.stringContaining("[redacted]"),
    });
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(bearerToken);
    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain(plainSecret);
    expect(serialized).not.toContain(dottedSecret);
  });

  it("keeps best-effort event failures from escaping", async () => {
    sqlite.exec(`
      CREATE TRIGGER reject_test_event
      BEFORE INSERT ON steam_event
      BEGIN
        SELECT RAISE(ABORT, 'event insert rejected');
      END;
    `);

    try {
      await expect(
        recordInfoEventSafely({
          type: "test.best-effort",
          message: "This event is expected to fail.",
        }),
      ).resolves.toBeNull();
    } finally {
      sqlite.exec("DROP TRIGGER reject_test_event;");
    }
  });

  it("removes only events older than the configured retention window", async () => {
    const originalRetentionDays = config.eventRetentionDays;
    config.eventRetentionDays = 90;
    const now = Date.UTC(2026, 6, 9);

    try {
      await recordEvent({
        level: "info",
        type: "test.retained",
        message: "Recent event",
        createdAt: now - 89 * 24 * 60 * 60_000,
      });
      await recordEvent({
        level: "info",
        type: "test.expired",
        message: "Expired event",
        createdAt: now - 91 * 24 * 60 * 60_000,
      });

      await expect(cleanupRetainedEvents(now)).resolves.toBe(1);
      const events = await db.select().from(steamEvent);
      expect(events.map((event) => event.type)).toEqual(["test.retained"]);
    } finally {
      config.eventRetentionDays = originalRetentionDays;
    }
  });
});
