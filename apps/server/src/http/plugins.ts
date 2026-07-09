import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ERROR_CODES } from "@steam-bee/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { validateSession } from "../auth/service.js";

export async function registerPlugins(app: FastifyInstance) {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "base-uri": ["'self'"],
        "connect-src": ["'self'"],
        "default-src": ["'self'"],
        "font-src": ["'self'", "data:"],
        "frame-ancestors": ["'none'"],
        "img-src": ["'self'", "data:", "https:"],
        "object-src": ["'none'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
      },
    },
    frameguard: {
      action: "deny",
    },
  });
  await app.register(cors, {
    origin: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  app.decorateRequest("session", null);
  app.addHook("preHandler", async (request) => {
    request.session = await validateSession(request.cookies.session);
  });

  app.addHook("onSend", async (request, reply) => {
    if (isApiRequest(request)) reply.header("cache-control", "no-store");
    reply.header("x-correlation-id", request.id);
  });
}

function isApiRequest(request: FastifyRequest) {
  const pathname = request.url.split("?")[0] ?? request.url;
  return pathname === "/api" || pathname.startsWith("/api/");
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.session) {
    return reply
      .code(401)
      .send({ error: "Not signed in.", code: ERROR_CODES.unauthorized });
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const csrfHeader = request.headers["x-csrf-token"];
    if (csrfHeader !== request.session.csrfToken) {
      return reply.code(403).send({
        error: "CSRF token is invalid.",
        code: ERROR_CODES.invalidCsrf,
      });
    }
  }
}

declare module "fastify" {
  interface FastifyRequest {
    session: {
      id: string;
      tokenHash: string;
      csrfToken: string;
      expiresAt: number;
      createdAt: number;
      lastSeenAt: number;
    } | null;
  }
}
