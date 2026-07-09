import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createSession,
  deleteSession,
  isSetupComplete,
  setupAdmin,
} from "../../auth/service.js";
import { isSetupTokenRequired } from "../../auth/setup-token.js";
import { config } from "../../config.js";
import { passwordSchema } from "../../steam/validation.js";
import { requireAuth } from "../plugins.js";

const loginSchema = z.object({ password: passwordSchema });
const setupSchema = loginSchema.extend({
  setupToken: z.string().min(1).max(256),
});
const authRateLimit = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: "1 minute",
      groupId: "admin-auth",
      keyGenerator: () => "admin-auth",
    },
  },
};

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/me", async (request) => {
    const setupComplete = await isSetupComplete();
    return {
      setupComplete,
      setupTokenRequired: !setupComplete && isSetupTokenRequired(),
      authenticated: Boolean(request.session),
      csrfToken: request.session?.csrfToken ?? null,
    };
  });

  app.post("/api/setup", authRateLimit, async (request, reply) => {
    const body = setupSchema.parse(request.body);
    await setupAdmin(body.password, body.setupToken);
    const session = await createSession(body.password);
    setSessionCookie(reply, session.token, session.expiresAt);
    return { ok: true, csrfToken: session.csrfToken };
  });

  app.post("/api/login", authRateLimit, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const session = await createSession(body.password);
    setSessionCookie(reply, session.token, session.expiresAt);
    return { ok: true, csrfToken: session.csrfToken };
  });

  app.post(
    "/api/logout",
    { preHandler: requireAuth },
    async (request, reply) => {
      await deleteSession(request.cookies.session);
      reply.clearCookie("session", { path: "/" });
      return { ok: true };
    },
  );
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: number,
) {
  reply.setCookie("session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    path: "/",
    expires: new Date(expiresAt),
  });
}
