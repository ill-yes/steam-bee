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
import { fastifyLoggerOptions } from "./util/logger.js";

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
    requestIdHeader: "x-correlation-id",
    genReqId: (request) =>
      normalizeHeader(request.headers["x-correlation-id"]) ?? randomUUID(),
    trustProxy: config.trustProxy,
  });

  app.setErrorHandler((error, request, reply) => {
    const httpError = error as { status?: number; statusCode?: number };
    const statusCode =
      error instanceof ZodError
        ? 400
        : (httpError.statusCode ?? httpError.status ?? 500);
    const normalizedStatusCode =
      statusCode >= 400 && statusCode < 600 ? statusCode : 500;

    if (normalizedStatusCode >= 500) {
      request.log.error({ err: error }, "Unhandled API error");
    } else {
      request.log.warn({ err: error }, "API request rejected");
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

  const initSteam = options.initSteam ?? true;
  if (initSteam) {
    app.addHook("onClose", async () => {
      await steamManager.shutdown();
    });
    await steamManager.init();
  }

  return app;
}

function readableErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
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

function normalizeHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}
