import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "@steam-bee/contracts";
import Fastify, { LogController } from "fastify";
import type { FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { cleanupExpiredSessions, isSetupComplete } from "./auth/service.js";
import { initializeSetupToken } from "./auth/setup-token.js";
import { migrate } from "./db/client.js";
import { AppError } from "./http/errors.js";
import { registerPlugins } from "./http/plugins.js";
import { registerRoutes } from "./http/routes.js";
import { registerEventRetention } from "./http/events.js";
import { steamManager } from "./steam/manager.js";
import { errorLogFields, fastifyLoggerOptions } from "./util/logger.js";
import { safeErrorMessage } from "./util/redact.js";
import { notificationDispatcher } from "./notifications/dispatcher.js";
import {
  closeWithLeaseCleanup,
  IncompleteStartupCleanupError,
} from "./startup.js";

const maxCorrelationIdLength = 128;
const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export async function buildApp(options: { initSteam?: boolean } = {}) {
  migrate();
  initializeSetupToken(await isSetupComplete());
  await cleanupExpiredSessions();

  const app = Fastify({
    logger: config.logRequests ? fastifyLoggerOptions : false,
    logController: new LogController({
      disableRequestLogging: config.logQuietRequests
        ? shouldDisableRequestLogging
        : false,
    }),
    genReqId: (request) =>
      sanitizeCorrelationId(request.headers["x-correlation-id"]) ??
      randomUUID(),
    trustProxy: config.trustProxy,
  });

  try {
    app.setErrorHandler((error, request, reply) => {
      const httpError = error as { status?: number; statusCode?: number };
      const statusCode =
        error instanceof ZodError
          ? 400
          : (httpError.statusCode ?? httpError.status ?? 500);
      const normalizedStatusCode =
        statusCode >= 400 && statusCode < 600 ? statusCode : 500;

      if (normalizedStatusCode >= 500) {
        request.log.error(errorLogFields(error), "Unhandled API error");
      } else {
        request.log.warn(errorLogFields(error), "API request rejected");
      }

      return reply.code(normalizedStatusCode).send({
        error:
          normalizedStatusCode >= 500
            ? "Internal server error."
            : readableErrorMessage(error),
        code: errorCode(error, normalizedStatusCode),
      });
    });

    await registerPlugins(app);
    await registerRoutes(app);
    await registerEventRetention(app);
    app.addHook("onClose", async () => notificationDispatcher.stop());
    notificationDispatcher.start();

    const initSteam = options.initSteam ?? true;
    if (initSteam) {
      app.addHook("onClose", async () => {
        await steamManager.shutdown();
      });
      await steamManager.init();
    }

    return app;
  } catch (initializationError) {
    try {
      await closeWithLeaseCleanup(app, { release: () => undefined });
    } catch (cleanupError) {
      throw new IncompleteStartupCleanupError(
        initializationError,
        cleanupError,
      );
    }
    throw initializationError;
  }
}

function readableErrorMessage(error: unknown) {
  return error instanceof Error ? safeErrorMessage(error) : "Request failed.";
}

function errorCode(error: unknown, statusCode: number) {
  if (error instanceof AppError) return error.code;
  if (error instanceof ZodError) return ERROR_CODES.validation;
  if (statusCode === 401) return ERROR_CODES.unauthorized;
  if (statusCode === 404) return ERROR_CODES.notFound;
  if (statusCode === 429) return ERROR_CODES.rateLimited;
  return statusCode >= 500 ? ERROR_CODES.internal : ERROR_CODES.conflict;
}

function shouldDisableRequestLogging(request: FastifyRequest) {
  const url = request.url.split("?")[0] ?? request.url;
  return (
    url === "/healthz" ||
    url === "/readyz" ||
    url === "/favicon.ico" ||
    url.startsWith("/assets/") ||
    url.startsWith("/api/events")
  );
}

function sanitizeCorrelationId(value: string | string[] | undefined) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxCorrelationIdLength ||
    !correlationIdPattern.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}
