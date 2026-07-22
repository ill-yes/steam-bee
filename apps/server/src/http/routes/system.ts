import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  ACCOUNT_STATUS_CAPABILITIES,
  SYSTEM_STATUS_CODES,
  isAccountStatus,
  type SystemStatus,
  type SystemStatusCode,
} from "@steam-bee/contracts";
import { config } from "../../config.js";
import { checkDatabaseReady, db, getMigrationState } from "../../db/client.js";
import { steamAccount, steamEvent } from "../../db/schema.js";
import { steamManager } from "../../steam/manager.js";
import {
  getSseClientCount,
  presentSteamEvent,
  registerSseClient,
} from "../events.js";
import { requireAuth } from "../plugins.js";
import { instanceLease } from "../../runtime-instance-lease.js";

const systemReadRateLimit = {
  max: 60,
  timeWindow: "1 minute",
  groupId: "system-read",
};

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (_request, reply) => {
    const readiness = checkDatabaseReady();
    if (!readiness.ok) {
      if (readiness.migrationState.unsupported.length > 0) {
        return reply.code(503).send({
          ok: false,
          code: "UNSUPPORTED_DATABASE_SCHEMA",
          unsupported: readiness.migrationState.unsupported,
        });
      }
      return reply.code(503).send({
        ok: false,
        code: "MIGRATIONS_PENDING",
        pending: readiness.migrationState.pending,
      });
    }
    return { ok: true, code: "READY" };
  });

  app.get(
    "/api/diagnostics",
    {
      preHandler: requireAuth,
      config: { rateLimit: systemReadRateLimit },
    },
    async () => {
      const recentEvents = await db
        .select({
          level: steamEvent.level,
          type: steamEvent.type,
          createdAt: steamEvent.createdAt,
        })
        .from(steamEvent)
        .orderBy(desc(steamEvent.createdAt))
        .limit(500);
      const accounts = await db.select().from(steamAccount);

      return {
        build: config.build,
        logging: {
          level: config.logLevel,
          requests: config.logRequests,
          quietRequests: config.logQuietRequests,
        },
        runtime: {
          dataDir: config.dataDir,
          publicDir: config.publicDir,
          sseClients: getSseClientCount(),
          instanceLease: instanceLease.status(),
        },
        migrations: getMigrationState(),
        events: summarizeEvents(recentEvents),
        accounts: {
          total: accounts.length,
          desiredRunning: accounts.filter(
            (account) => account.desiredState === "running",
          ).length,
        },
      };
    },
  );

  app.get(
    "/api/events/recent",
    {
      preHandler: requireAuth,
      config: { rateLimit: systemReadRateLimit },
    },
    async () => {
      const events = await db
        .select()
        .from(steamEvent)
        .orderBy(desc(steamEvent.createdAt))
        .limit(100);
      return events.map(presentSteamEvent);
    },
  );

  app.get(
    "/api/system/status",
    {
      preHandler: requireAuth,
      config: { rateLimit: systemReadRateLimit },
    },
    getSystemStatus,
  );

  app.get(
    "/api/events",
    { preHandler: requireAuth },
    async (_request, reply) => {
      registerSseClient(reply);
      return reply;
    },
  );

  if (existsSync(config.publicDir)) {
    await app.register(fastifyStatic, {
      root: config.publicDir,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found.", code: "NOT_FOUND" });
      }
      return reply.sendFile("index.html");
    });
  }
}

async function getSystemStatus() {
  const migrations = getMigrationState();
  const accounts = await db.select().from(steamAccount);
  const recentErrors = await db
    .select({ id: steamEvent.id })
    .from(steamEvent)
    .where(
      and(
        eq(steamEvent.level, "error"),
        gte(steamEvent.createdAt, Date.now() - 24 * 60 * 60_000),
      ),
    )
    .orderBy(desc(steamEvent.createdAt))
    .limit(10);
  const accountErrors = accounts.filter((account) => {
    const runtimeStatus = steamManager.getStatus(account.id);
    return (
      ACCOUNT_STATUS_CAPABILITIES[runtimeStatus].attention ||
      !isAccountStatus(account.status) ||
      ACCOUNT_STATUS_CAPABILITIES[account.status].attention ||
      Boolean(account.lastError)
    );
  });

  if (migrations.unsupported.length > 0) {
    return status(
      SYSTEM_STATUS_CODES.migrationsPending,
      "Unsupported database schema",
      "danger",
      `${migrations.unsupported.length} unsupported migration found.`,
      0,
      accountErrors.length,
      recentErrors.length,
    );
  }
  if (migrations.pending.length > 0) {
    return status(
      SYSTEM_STATUS_CODES.migrationsPending,
      "Migration pending",
      "warn",
      `${migrations.pending.length} migration pending.`,
      migrations.pending.length,
      accountErrors.length,
      recentErrors.length,
    );
  }
  if (accountErrors.length > 0 || recentErrors.length > 0) {
    return status(
      SYSTEM_STATUS_CODES.attention,
      "Review errors",
      "danger",
      accountErrors.length > 0
        ? `${accountErrors.length} account needs attention.`
        : `${recentErrors.length} errors in the log.`,
      0,
      accountErrors.length,
      recentErrors.length,
    );
  }
  return status(
    SYSTEM_STATUS_CODES.ready,
    "System ok",
    "good",
    "API, database and workers are ready.",
    0,
    0,
    0,
  );
}

function status(
  code: SystemStatusCode,
  label: string,
  tone: "good" | "danger" | "warn",
  detail: string,
  pendingMigrations: number,
  accountErrors: number,
  recentErrors: number,
): SystemStatus {
  return {
    code,
    label,
    tone,
    detail,
    pendingMigrations,
    accountErrors,
    recentErrors,
    checkedAt: Date.now(),
  };
}

function summarizeEvents(
  events: Array<{ level: string; type: string; createdAt: number }>,
) {
  return {
    sampleSize: events.length,
    lastEventAt: events[0]?.createdAt ?? null,
    byLevel: countBy(events, (event) => event.level),
    byCategory: countBy(events, (event) => eventCategory(event.type)),
  };
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function eventCategory(type: string) {
  if (type.includes("library")) return "library";
  if (type === "steam.status") return "status";
  if (type.includes("login")) return "login";
  return "action";
}
