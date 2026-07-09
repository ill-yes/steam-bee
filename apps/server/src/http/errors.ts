import { ERROR_CODES, type ErrorCode } from "@steam-bee/contracts";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode | string;

  constructor(message: string, statusCode: number, code: ErrorCode | string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function appError(
  message: string,
  statusCode: number,
  code: ErrorCode | string = ERROR_CODES.conflict,
) {
  return new AppError(message, statusCode, code);
}
