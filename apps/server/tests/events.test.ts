import { beforeEach, describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { db, migrate, sqlite } from "../src/db/client.js";
import { steamEvent } from "../src/db/schema.js";
import { config } from "../src/config.js";
import { cleanupRetainedEvents, recordEvent } from "../src/http/events.js";

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
