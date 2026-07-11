import { describe, expect, it } from "vitest";
import {
  formatBoostRunningSince,
  formatDurationMs,
  formatWeekdays,
  weekdayLabels,
} from "../src/lib/format";
import { t } from "../src/i18n";

describe("format helpers", () => {
  it("formats minute and hour durations consistently", () => {
    expect(formatDurationMs(30 * 60_000, t, "en-US")).toBe("30 min");
    expect(formatDurationMs(90 * 60_000, t, "en-US")).toBe("1.5 h");
  });

  it("keeps weekday labels in the UI order while formatting arbitrary sets", () => {
    expect(weekdayLabels("en-US").map((day) => day.value)).toEqual([
      1, 2, 3, 4, 5, 6, 0,
    ]);
    expect(formatWeekdays([1, 3, 5], "en-US")).toBe("Mon, Wed, Fri");
  });

  it("uses the shared inactive copy for a boost without a start time", () => {
    expect(formatBoostRunningSince(null, t, "en-US")).toBe(t.format.notActive);
  });
});
