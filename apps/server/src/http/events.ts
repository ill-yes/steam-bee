import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "../config.js";
import { db, sqlite } from "../db/client.js";
import { steamEvent } from "../db/schema.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { redact } from "../util/redact.js";

export type EventPayload = {
  id?: number;
  accountId?: string | null;
  level: "info" | "warn" | "error";
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
};

type StoredEvent = {
  id?: number;
  accountId: string | null;
  level: "info" | "warn" | "error";
  type: string;
  message: string;
  metadataJson?: string | null;
  createdAt: number;
};

const clients = new Set<FastifyReply>();
const eventLogger = createLogger("events");
const heartbeatIntervalMs = 15_000;
const retentionCleanupIntervalMs = 24 * 60 * 60_000;
let heartbeatTimer: NodeJS.Timeout | null = null;

export async function recordEvent(event: EventPayload) {
  const createdAt = event.createdAt ?? Date.now();
  const metadata = redact(event.metadata ?? {});
  const result = await db
    .insert(steamEvent)
    .values({
      accountId: event.accountId ?? null,
      level: event.level,
      type: event.type,
      message: event.message,
      metadataJson: JSON.stringify(metadata),
      createdAt,
    })
    .returning();

  const row = result[0];
  const eventId = row?.id ?? event.id;
  const saved: StoredEvent = {
    ...(eventId === undefined ? {} : { id: eventId }),
    accountId: row?.accountId ?? event.accountId ?? null,
    level: event.level,
    type: row?.type ?? event.type,
    message: row?.message ?? event.message,
    metadataJson: row?.metadataJson ?? JSON.stringify(metadata),
    createdAt: row?.createdAt ?? createdAt,
  };
  broadcast("event", saved);
  logSavedEvent(saved, metadata);
  return saved;
}

export async function recordInfoEvent(event: Omit<EventPayload, "level">) {
  return recordEvent({ ...event, level: "info" });
}

export async function recordErrorEvent(event: Omit<EventPayload, "level">) {
  return recordEvent({ ...event, level: "error" });
}

export function broadcast(type: string, payload: unknown) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const reply of clients) {
    writeToClient(reply, data);
  }
}

export function registerSseClient(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write("retry: 3000\n\n");
  clients.add(reply);
  startHeartbeat();
  eventLogger.debug({ clientCount: clients.size }, "SSE client connected");
  const remove = () => removeClient(reply);
  reply.raw.on("close", remove);
  reply.raw.on("error", remove);
}

export function getSseClientCount() {
  return clients.size;
}

export async function registerEventRetention(app: FastifyInstance) {
  await cleanupRetainedEvents();
  if (config.eventRetentionDays === 0) return;

  const timer = setInterval(() => {
    void cleanupRetainedEvents().catch((error) => {
      eventLogger.error(
        errorLogFields(error),
        "Scheduled event retention cleanup failed",
      );
    });
  }, retentionCleanupIntervalMs);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}

export async function cleanupRetainedEvents(now = Date.now()) {
  if (config.eventRetentionDays === 0) return 0;
  const cutoff = now - config.eventRetentionDays * 24 * 60 * 60_000;
  const result = sqlite
    .prepare("DELETE FROM steam_event WHERE created_at < ?")
    .run(cutoff);
  if (result.changes > 0) {
    eventLogger.info(
      {
        deletedEvents: result.changes,
        retentionDays: config.eventRetentionDays,
      },
      "Expired events removed",
    );
  }
  return result.changes;
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const reply of clients) writeToClient(reply, ": heartbeat\n\n");
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();
}

function writeToClient(reply: FastifyReply, data: string) {
  if (reply.raw.destroyed || reply.raw.writableEnded) {
    removeClient(reply);
    return;
  }
  try {
    reply.raw.write(data);
  } catch (error) {
    eventLogger.debug(errorLogFields(error), "SSE client write failed");
    removeClient(reply);
  }
}

function removeClient(reply: FastifyReply) {
  if (!clients.delete(reply)) return;
  eventLogger.debug({ clientCount: clients.size }, "SSE client disconnected");
  if (clients.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function logSavedEvent(event: StoredEvent, metadata: unknown) {
  const fields = {
    accountId: event.accountId ?? null,
    eventId: event.id,
    eventType: event.type,
    metadata,
  };

  if (event.level === "error") {
    eventLogger.error(fields, event.message);
  } else if (event.level === "warn") {
    eventLogger.warn(fields, event.message);
  } else {
    eventLogger.info(fields, event.message);
  }
}

export function logEventFailure(error: unknown, fields = {}) {
  eventLogger.error(errorLogFields(error, fields), "Failed to record event");
}
