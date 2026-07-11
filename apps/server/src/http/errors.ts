import { ERROR_CODES, type ErrorCode } from "@steam-bee/contracts";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(message: string, statusCode: number, code: ErrorCode) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function appError(
  message: string,
  statusCode: number,
  code: ErrorCode = ERROR_CODES.conflict,
) {
  return new AppError(message, statusCode, code);
}
