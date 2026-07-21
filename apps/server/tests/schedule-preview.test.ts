import { beforeEach, describe, expect, it } from "vitest";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  boostPreset,
  boostSchedule,
  scheduleException,
  steamAccount,
} from "../src/db/schema.js";
import { buildSchedulePreview } from "../src/steam/schedule-preview.js";

describe("schedule preview", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec("DELETE FROM steam_account;");
  });

  it("uses scheduler windows and marks the winner at each window start", async () => {
    const now = Date.UTC(2026, 6, 20, 11, 45);
    const accountId = crypto.randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: "preview-account",
      status: "disconnected",
      desiredState: "stopped",
      personaState: 7,
      tokenKeyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const presets = [crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(boostPreset).values(
      presets.map((id, index) => ({
        id,
        accountId,
        name: `Preset ${index}`,
        personaState: 7,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const schedules = [crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(boostSchedule).values(
      schedules.map((id, index) => ({
        id,
        accountId,
        presetId: presets[index]!,
        name: `Schedule ${index}`,
        enabled: true,
        weekdaysJson: "[1]",
        startTime: index === 0 ? "11:00" : "11:30",
        endTime: "12:30",
        timezone: "UTC",
        createdAt: now,
        updatedAt: now + index,
      })),
    );

    const preview = await buildSchedulePreview(accountId, 1, now);
    expect(preview.items).toHaveLength(2);
    expect(
      preview.items.every((item) => item.conflictScheduleIds.length === 1),
    ).toBe(true);
    expect(preview.items.filter((item) => item.winner)).toHaveLength(2);

    const first = preview.items[0]!;
    await db.insert(scheduleException).values({
      id: crypto.randomUUID(),
      scheduleId: first.scheduleId,
      accountId,
      windowId: first.windowId,
      action: "skip",
      createdAt: now,
    });
    const skipped = await buildSchedulePreview(accountId, 1, now);
    expect(
      skipped.items.find((item) => item.windowId === first.windowId)?.skipped,
    ).toBe(true);
  });
});
