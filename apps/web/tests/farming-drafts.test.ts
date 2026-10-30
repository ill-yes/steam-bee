import { describe, expect, it } from "vitest";
import { parseDraftIds } from "../src/features/farming/drafts";

describe("farming AppID drafts", () => {
  it("ignores leading and trailing separators", () => {
    expect(parseDraftIds("730, 440,")).toEqual([730, 440]);
    expect(parseDraftIds(", 570")).toEqual([570]);
  });

  it("rejects non-numeric entries", () => {
    expect(parseDraftIds("730, abc")).toBeNull();
  });
});
