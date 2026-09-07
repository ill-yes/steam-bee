import { describe, expect, it } from "vitest";
import {
  enforceGameLimit,
  libraryMetaSchema,
  presetSchema,
  scheduleSchema,
  scheduleUpdateSchema,
} from "../src/steam/validation.js";

describe("Steam input validation", () => {
  it("allows 32 games without custom title and reserves one slot for a title", () => {
    const appIds = Array.from({ length: 32 }, (_, index) => index + 1);

    expect(() => enforceGameLimit(appIds, null)).not.toThrow();
    expect(() => enforceGameLimit(appIds.slice(0, 31), "Idle")).not.toThrow();
    expect(() => enforceGameLimit(appIds, "Idle")).toThrow(/at most 31/);
  });

  it("validates preset payloads at the API boundary", () => {
    expect(
      presetSchema.safeParse({
        name: "Evening",
        appIds: [730, 4000],
        personaState: 7,
        customTitle: null,
      }).success,
    ).toBe(true);

    expect(
      presetSchema.safeParse({
        name: "",
        appIds: [0],
        personaState: 9,
        customTitle: null,
      }).success,
    ).toBe(false);
  });

  it("validates schedule time windows and weekdays", () => {
    expect(
      scheduleSchema.safeParse({
        name: "Werktag",
        presetId: crypto.randomUUID(),
        enabled: true,
        weekdays: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "18:00",
        timezone: "Europe/Berlin",
      }).success,
    ).toBe(true);

    expect(
      scheduleSchema.safeParse({
        name: "Invalid",
        presetId: crypto.randomUUID(),
        enabled: true,
        weekdays: [8],
        startTime: "09:00",
        endTime: "09:00",
        timezone: "Europe/Berlin",
      }).success,
    ).toBe(false);
  });

  it("only defaults enabled when creating a schedule, not on partial updates", () => {
    const schedule = {
      name: "Evening",
      presetId: crypto.randomUUID(),
      weekdays: [1],
      startTime: "18:00",
      endTime: "19:00",
      timezone: "Europe/Berlin",
    };
    expect(scheduleSchema.parse(schedule).enabled).toBe(true);
    expect(scheduleUpdateSchema.parse({ name: "Renamed" })).toEqual({
      name: "Renamed",
    });
    expect(scheduleUpdateSchema.parse({})).toEqual({});
    expect(scheduleUpdateSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(scheduleUpdateSchema.parse({ enabled: true })).toEqual({
      enabled: true,
    });
  });

  it("keeps library metadata bounded", () => {
    expect(
      libraryMetaSchema.safeParse({
        appId: 730,
        favorite: true,
        hidden: false,
        tags: ["fps", "idle"],
      }).success,
    ).toBe(true);

    expect(
      libraryMetaSchema.safeParse({
        appId: 730,
        tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`),
      }).success,
    ).toBe(false);
  });
});
