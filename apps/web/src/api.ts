import type { ApiErrorResponse, MeResponse } from "@steam-bee/contracts";
import { isErrorCode } from "@steam-bee/contracts";
import type { Messages } from "./i18n";

export type Me = MeResponse;
export type {
  Account,
  AdminOverview,
  AdminSession,
  BoostAnalytics,
  BoostPreset,
  BoostSchedule,
  Diagnostics,
  SteamApp,
  SteamEvent,
  SteamProfile,
  SystemStatus,
} from "@steam-bee/contracts";

let csrfToken: string | null = null;
export const authExpiredEvent = "steam-bee:auth-expired";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (
    csrfToken &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(init.method ?? "GET")
  ) {
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      if (!response.ok) {
        throw new ApiError(
          "The server returned an invalid response.",
          "INVALID_RESPONSE",
          response.status,
        );
      }
      throw new ApiError(
        "The server returned an invalid response.",
        "INVALID_RESPONSE",
        502,
      );
    }
  }
  if (!response.ok) {
    const payload = isApiErrorResponse(data) ? data : null;
    if (response.status === 401 && path !== "/api/login") {
      window.dispatchEvent(new CustomEvent(authExpiredEvent));
    }
    throw new ApiError(
      payload?.error ?? "Request failed.",
      payload?.code ?? `HTTP_${response.status}`,
      response.status,
    );
  }

  return data as T;
}

export function apiErrorMessage(error: unknown, messages: Messages) {
  if (error instanceof ApiError) {
    const localized = messages.errors[error.code as keyof Messages["errors"]];
    return localized ?? error.message;
  }
  return error instanceof Error ? error.message : messages.admin.actionFailed;
}

export function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    "code" in value &&
    isErrorCode(value.code)
  );
}
