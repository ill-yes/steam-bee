import { describe, expect, it } from "vitest";
import type { BoostSchedule } from "../src/api";
import {
  weekBlocks,
  zoneOffsetMinutes,
} from "../src/features/accounts/detail/SchedulePanel";

const winter = Date.UTC(2026, 0, 14, 12);

function schedule(overrides: Partial<BoostSchedule>): BoostSchedule {
  return {
    id: "s1",
    name: "Night",
    presetId: "p1",
    presetName: "Preset",
    enabled: true,
    weekdays: [1],
    startTime: "23:00",
    endTime: "01:00",
    timezone: "UTC",
    ...overrides,
  } as BoostSchedule;
}

describe("schedule week grid", () => {
  it("reads zone offsets", () => {
    expect(zoneOffsetMinutes("UTC", winter)).toBe(0);
    expect(zoneOffsetMinutes("Europe/Berlin", winter)).toBe(60);
    expect(zoneOffsetMinutes("America/New_York", winter)).toBe(-300);
  });

  it("keeps blocks in place when the schedule uses the viewer's zone", () => {
    const blocks = weekBlocks([schedule({})], "UTC", winter);
    expect(blocks.get(1)?.map(({ start, end }) => [start, end])).toEqual([
      [23 * 60, 24 * 60],
    ]);
    expect(blocks.get(2)?.map(({ start, end }) => [start, end])).toEqual([
      [0, 60],
    ]);
  });

  it("shifts a schedule saved in another zone into the viewer's zone", () => {
    const blocks = weekBlocks([schedule({})], "Europe/Berlin", winter);
    expect(blocks.get(1)).toEqual([]);
    expect(blocks.get(2)?.map(({ start, end }) => [start, end])).toEqual([
      [0, 120],
    ]);
  });

  it("wraps Sunday night into Monday", () => {
    const blocks = weekBlocks(
      [schedule({ weekdays: [0], startTime: "22:00", endTime: "23:30" })],
      "Europe/Berlin",
      winter,
    );
    expect(blocks.get(0)?.map(({ start, end }) => [start, end])).toEqual([
      [23 * 60, 24 * 60],
    ]);
    expect(blocks.get(1)?.map(({ start, end }) => [start, end])).toEqual([
      [0, 30],
    ]);
  });
});
