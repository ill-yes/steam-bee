import { describe, expect, it } from "vitest";
import {
  eventDisplay,
  libraryFilterModes,
  selectionApplyCopy,
} from "../src/lib/status";
import { t } from "../src/i18n";

describe("status copy helpers", () => {
  it("names preset, schedule and boost-session events explicitly", () => {
    expect(
      eventDisplay(
        {
          id: 1,
          accountId: "account-1",
          level: "info",
          type: "steam.preset.apply",
          message: "Preset applied.",
          createdAt: Date.now(),
        },
        t,
      ).title,
    ).toBe("Preset applied");

    expect(
      eventDisplay(
        {
          id: 2,
          accountId: "account-1",
          level: "info",
          type: "steam.schedule.start",
          message: "Schedule started.",
          createdAt: Date.now(),
        },
        t,
      ).title,
    ).toBe("Schedule started");

    expect(
      eventDisplay(
        {
          id: 3,
          accountId: "account-1",
          level: "info",
          type: "steam.boost.session.start",
          message: "Boost-Session gestartet.",
          createdAt: Date.now(),
        },
        t,
      ).title,
    ).toBe("Boost session started");
  });

  it("keeps library filter labels compact for dense dashboard use", () => {
    expect(libraryFilterModes(t).map((mode) => mode.label)).toEqual([
      "All",
      "Selected",
      "Unselected",
      "With time",
      "No time",
      "Favorites",
      "Hidden",
    ]);
  });

  it("distinguishes dirty boost selection from applied selection", () => {
    expect(selectionApplyCopy("boosting", 2, 3, true, false, t)).toMatchObject({
      label: "Draft open",
      tone: "dirty",
    });
    expect(selectionApplyCopy("boosting", 2, 2, false, false, t)).toMatchObject(
      {
        label: "Applied",
        tone: "applied",
      },
    );
  });
});
