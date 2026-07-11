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

export function isErrorCode(value: unknown): value is ErrorCode {
  return Object.values(ERROR_CODES).includes(value as ErrorCode);
}

export type ApiErrorResponse = {
  error: string;
  code: ErrorCode;
};
