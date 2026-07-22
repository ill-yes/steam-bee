import { describe, expect, it } from "vitest";
import {
  classifySteamFailure,
  extractEResult,
  sessionConflictDelay,
} from "../src/steam/retry-policy.js";

describe("Steam retry policy", () => {
  it.each([6, 34, 50])(
    "retries Steam session conflict result %i automatically",
    (eresult) => {
      expect(classifySteamFailure({ eresult })).toMatchObject({
        terminal: false,
        errorClass: "session_replaced",
        recoveryAction: "retry",
        minimumDelayMs: 5 * 60_000,
      });
    },
  );

  it("uses two five-minute retries followed by a one-hour cooldown", () => {
    expect([1, 2, 3, 1].map(sessionConflictDelay)).toEqual([
      5 * 60_000,
      5 * 60_000,
      60 * 60_000,
      5 * 60_000,
    ]);
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
