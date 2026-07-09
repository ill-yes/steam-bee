import pino, { type Logger, type LoggerOptions } from "pino";
import { config } from "../config.js";
import { redact, safeErrorMessage } from "./redact.js";

const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "password",
  "*.password",
  "body.password",
  "payload.password",
  "guardCode",
  "*.guardCode",
  "steamGuardCode",
  "*.steamGuardCode",
  "token",
  "*.token",
  "refreshToken",
  "*.refreshToken",
  "accessToken",
  "*.accessToken",
  "csrfToken",
  "*.csrfToken",
  "cookie",
  "*.cookie",
  "metadata.password",
  "metadata.token",
  "metadata.refreshToken",
  "metadata.guardCode",
];

export const fastifyLoggerOptions: LoggerOptions = {
  level: config.logLevel,
  base: {
    service: "steam-bee",
  },
  redact: {
    paths: REDACTED_LOG_PATHS,
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(fastifyLoggerOptions);

export function createLogger(
  component: string,
  bindings: Record<string, unknown> = {},
): Logger {
  return logger.child(redact({ component, ...bindings }) as object);
}

export function errorLogFields(
  error: unknown,
  fields: Record<string, unknown> = {},
) {
  return {
    ...(redact(fields) as Record<string, unknown>),
    err: serializeError(error),
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: safeErrorMessage(error),
    };
  }

  return {
    message: safeErrorMessage(error),
  };
}
