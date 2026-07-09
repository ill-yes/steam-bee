import { describe, expect, it } from "vitest";
import {
  evaluateScheduleWindow,
  isValidTimeZone,
  selectScheduleWinner,
} from "../src/steam/scheduler.js";

describe("schedule evaluator", () => {
  it("marks a same-day window as active", () => {
    const state = evaluateScheduleWindow(
      {
        id: "schedule-1",
        weekdaysJson: JSON.stringify([3]),
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
      },
      new Date(Date.UTC(2026, 6, 8, 10, 30)),
    );

    expect(state).toEqual({
      active: true,
      windowId: "schedule-1:2026-07-08:10:00-11:00",
      windowStartedAt: Date.UTC(2026, 6, 8, 10, 0),
    });
  });

  it("keeps overnight windows tied to the previous start day", () => {
    const state = evaluateScheduleWindow(
      {
        id: "schedule-overnight",
        weekdaysJson: JSON.stringify([2]),
        startTime: "23:00",
        endTime: "02:00",
        timezone: "UTC",
      },
      new Date(Date.UTC(2026, 6, 8, 1, 30)),
    );

    expect(state).toEqual({
      active: true,
      windowId: "schedule-overnight:2026-07-07:23:00-02:00",
      windowStartedAt: Date.UTC(2026, 6, 7, 23, 0),
    });
  });

  it("returns inactive outside the configured weekday window", () => {
    const state = evaluateScheduleWindow(
      {
        id: "schedule-weekday",
        weekdaysJson: JSON.stringify([1]),
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
      },
      new Date(Date.UTC(2026, 6, 8, 10, 30)),
    );

    expect(state).toEqual({
      active: false,
      windowId: null,
      windowStartedAt: null,
    });
  });

  it("ignores malformed weekday JSON", () => {
    const state = evaluateScheduleWindow(
      {
        id: "schedule-broken",
        weekdaysJson: "{not-json",
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
      },
      new Date(Date.UTC(2026, 6, 8, 10, 30)),
    );

    expect(state).toEqual({
      active: false,
      windowId: null,
      windowStartedAt: null,
    });
  });

  it("validates IANA timezones and evaluates a DST window", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Europe/Not-A-City")).toBe(false);
    const state = evaluateScheduleWindow(
      {
        id: "dst-window",
        weekdaysJson: JSON.stringify([0]),
        startTime: "01:30",
        endTime: "04:00",
        timezone: "Europe/Berlin",
      },
      new Date("2026-03-29T01:30:00Z"),
    );
    expect(state.active).toBe(true);
    expect(state.windowId).toContain("2026-03-29:01:30-04:00");
  });

  it("selects the latest active window with deterministic ties", () => {
    const baseState = {
      active: true,
      windowId: "window",
      windowStartedAt: 100,
    };
    expect(
      selectScheduleWinner([
        {
          schedule: { id: "a", updatedAt: 20 },
          state: { ...baseState, windowStartedAt: 200 },
        },
        { schedule: { id: "z", updatedAt: 30 }, state: baseState },
      ])?.schedule.id,
    ).toBe("a");

    expect(
      selectScheduleWinner([
        { schedule: { id: "a", updatedAt: 30 }, state: baseState },
        { schedule: { id: "z", updatedAt: 30 }, state: baseState },
      ])?.schedule.id,
    ).toBe("z");
  });
});
