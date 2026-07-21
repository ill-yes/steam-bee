import { describe, expect, it } from "vitest";
import {
  classifySteamFailure,
  extractEResult,
} from "../src/steam/retry-policy.js";

describe("Steam retry policy", () => {
  it("stops automatic retries after session replacement", () => {
    expect(classifySteamFailure({ eresult: 34 })).toMatchObject({
      terminal: true,
      errorClass: "session_replaced",
      recoveryAction: "manual_resume",
    });
  });

  it("routes authentication errors to reauthentication", () => {
    expect(classifySteamFailure({ eresult: 5 })).toMatchObject({
      terminal: true,
      errorClass: "authentication",
      recoveryAction: "reauthenticate",
    });
  });

  it("delays rate limits and retries unknown network failures", () => {
    expect(classifySteamFailure({ eresult: 84 })).toMatchObject({
      terminal: false,
      errorClass: "rate_limited",
      minimumDelayMs: 15 * 60_000,
    });
    expect(classifySteamFailure(new Error("offline"))).toMatchObject({
      terminal: false,
      errorClass: "unknown",
      recoveryAction: "retry",
    });
    expect(extractEResult({ code: 20 })).toBe(20);
  });
});
