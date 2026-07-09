export const ERROR_CODES = {
  internal: "INTERNAL_ERROR",
  validation: "VALIDATION_ERROR",
  notFound: "NOT_FOUND",
  unauthorized: "AUTH_REQUIRED",
  invalidCsrf: "CSRF_INVALID",
  setupRequired: "SETUP_REQUIRED",
  setupComplete: "SETUP_ALREADY_COMPLETE",
  setupTokenInvalid: "SETUP_TOKEN_INVALID",
  loginInvalid: "LOGIN_INVALID",
  currentPasswordInvalid: "CURRENT_PASSWORD_INVALID",
  currentSessionProtected: "CURRENT_SESSION_PROTECTED",
  accountNotFound: "ACCOUNT_NOT_FOUND",
  presetNotFound: "PRESET_NOT_FOUND",
  scheduleNotFound: "SCHEDULE_NOT_FOUND",
  steamNotConnected: "STEAM_NOT_CONNECTED",
  conflict: "CONFLICT",
  rateLimited: "RATE_LIMITED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type ApiErrorResponse = {
  error: string;
  code: ErrorCode | string;
};

export const ACCOUNT_STATUSES = [
  "disconnected",
  "connecting",
  "online",
  "boosting",
  "error",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const DESIRED_STATES = ["stopped", "running"] as const;
export type DesiredState = (typeof DESIRED_STATES)[number];

export type BuildMetadata = {
  version: string;
  revision: string;
  buildDate: string;
};

export const SYSTEM_STATUS_CODES = {
  ready: "SYSTEM_READY",
  attention: "SYSTEM_ATTENTION_REQUIRED",
  migrationsPending: "SYSTEM_MIGRATIONS_PENDING",
} as const;

export type SystemStatusCode =
  (typeof SYSTEM_STATUS_CODES)[keyof typeof SYSTEM_STATUS_CODES];

export type MeResponse = {
  setupComplete: boolean;
  setupTokenRequired: boolean;
  authenticated: boolean;
  csrfToken: string | null;
};
