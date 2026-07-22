import type { RecoveryAction, SteamErrorClass } from "@steam-bee/contracts";

export type RetryDecision = {
  terminal: boolean;
  errorClass: SteamErrorClass;
  errorCode: number | null;
  recoveryAction: RecoveryAction;
  minimumDelayMs: number;
};

const authenticationResults = new Set([
  5, 17, 18, 26, 27, 43, 51, 63, 65, 66, 71, 73, 74, 77, 80, 83,
]);
const rateLimitedResults = new Set([25, 84]);
const sessionConflictResults = new Set([6, 34, 50]);
export const sessionConflictRetryDelayMs = 5 * 60_000;
export const sessionConflictCooldownMs = 60 * 60_000;

export function sessionConflictDelay(attempt: number) {
  return attempt >= 3 ? sessionConflictCooldownMs : sessionConflictRetryDelayMs;
}

export function classifySteamFailure(value: unknown): RetryDecision {
  const errorCode = extractEResult(value);
  if (errorCode !== null && sessionConflictResults.has(errorCode)) {
    return {
      terminal: false,
      errorClass: "session_replaced",
      errorCode,
      recoveryAction: "retry",
      minimumDelayMs: sessionConflictRetryDelayMs,
    };
  }
  if (errorCode !== null && authenticationResults.has(errorCode)) {
    return {
      terminal: true,
      errorClass: "authentication",
      errorCode,
      recoveryAction: "reauthenticate",
      minimumDelayMs: 0,
    };
  }
  if (errorCode !== null && rateLimitedResults.has(errorCode)) {
    return {
      terminal: false,
      errorClass: "rate_limited",
      errorCode,
      recoveryAction: "wait",
      minimumDelayMs: 15 * 60_000,
    };
  }
  return {
    terminal: false,
    errorClass: errorCode === null ? "unknown" : "transient",
    errorCode,
    recoveryAction: "retry",
    minimumDelayMs: 0,
  };
}

export function extractEResult(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "object" || value === null) return null;
  for (const key of ["eresult", "result", "code"] as const) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      return candidate;
    }
  }
  return null;
}
