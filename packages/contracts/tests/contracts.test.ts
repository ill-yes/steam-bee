import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_CAPABILITIES,
  DESIRED_STATES,
  MAX_GAMES,
  MAX_GAMES_WITH_CUSTOM_TITLE,
  PERSONA_STATE_VALUES,
  gameSelectionLimit,
} from "../src/index.js";

describe("shared domain contracts", () => {
  it("defines one capability entry for every account status", () => {
    expect(Object.keys(ACCOUNT_STATUS_CAPABILITIES).sort()).toEqual(
      [...ACCOUNT_STATUSES].sort(),
    );
    expect(ACCOUNT_STATUS_CAPABILITIES.connecting).toMatchObject({
      busy: true,
      adminCommand: null,
      canPause: false,
      canStop: false,
    });
    expect(ACCOUNT_STATUS_CAPABILITIES.paused_manual.adminCommand).toBe(
      "resume",
    );
  });

  it("covers persisted desired and persona states", () => {
    expect(DESIRED_STATES).toContain("paused");
    expect(PERSONA_STATE_VALUES).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("reserves one Steam slot for a custom title", () => {
    expect(gameSelectionLimit(null)).toBe(MAX_GAMES);
    expect(gameSelectionLimit("Idle")).toBe(MAX_GAMES_WITH_CUSTOM_TITLE);
  });
});
