import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { SteamEvent } from "@steam-bee/contracts";
import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  notificationDelivery,
  notificationRule,
  steamEvent,
} from "../db/schema.js";
import { decryptSecret } from "../util/crypto.js";
import { parseJsonRecord, parseStringArray } from "../util/json.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { safeErrorMessage } from "../util/redact.js";

const maxAttempts = 3;
const deliveryTimeoutMs = 8_000;
const maximumResponseBytes = 64 * 1024;
const logger = createLogger("notifications");
const blockedWebhookAddresses = createWebhookBlockList();
const ipv4MappedWebhookAddresses = createIpv4MappedBlockList();
const globallyAllocatedIpv6Addresses = createGlobalIpv6BlockList();
type WebhookSender = (
  target: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<void>;

export class NotificationDispatcher {
  private running = false;
  private drainInFlight: Promise<void> | null = null;
  private reconcileInFlight: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private activeWebhookAbortController: AbortController | null = null;

  constructor(private readonly webhookSender: WebhookSender = sendWebhook) {}

  start() {
    this.running = true;
    this.scheduleDrain(0);
    void this.reconcile().catch((error) => {
      logger.error(
        errorLogFields(error),
        "Notification startup reconciliation failed",
      );
    });
  }

  async stop() {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.activeWebhookAbortController?.abort(
      new Error("Notification dispatcher is stopping."),
    );
    await Promise.all([
      this.reconcileInFlight?.catch(() => undefined),
      this.drainInFlight?.catch(() => undefined),
    ]);
  }

  async enqueue(event: SteamEvent) {
    const rules = await db
      .select()
      .from(notificationRule)
      .where(
        and(
          eq(notificationRule.enabled, true),
          eq(notificationRule.target, "webhook"),
        ),
      );
    await this.enqueueForRules(event, rules);
    this.scheduleDrain(0);
  }

  reconcile() {
    if (this.reconcileInFlight) return this.reconcileInFlight;
    const reconciliation = this.reconcileNow().finally(() => {
      if (this.reconcileInFlight === reconciliation) {
        this.reconcileInFlight = null;
      }
    });
    this.reconcileInFlight = reconciliation;
    return reconciliation;
  }

  private async reconcileNow() {
    const rules = await db
      .select()
      .from(notificationRule)
      .where(
        and(
          eq(notificationRule.enabled, true),
          eq(notificationRule.target, "webhook"),
        ),
      );
    for (const rule of rules) {
      const events = await db
        .select()
        .from(steamEvent)
        .where(gt(steamEvent.id, rule.startAfterEventId));
      await this.enqueueForRules(
        events.map((event) => ({
          id: event.id,
          type: event.type,
          metadata: parseJsonRecord(event.metadataJson),
        })),
        [rule],
      );
    }
    this.scheduleDrain(0);
  }

  private async enqueueForRules(
    eventOrEvents:
      | Pick<SteamEvent, "id" | "type" | "metadata">
      | Array<Pick<SteamEvent, "id" | "type" | "metadata">>,
    rules: Array<typeof notificationRule.$inferSelect>,
  ) {
    const events = Array.isArray(eventOrEvents)
      ? eventOrEvents
      : [eventOrEvents];
    const now = Date.now();
    for (const rule of rules) {
      for (const event of events) {
        if (!matchesRule(rule.eventTypesJson, event)) continue;
        await db
          .insert(notificationDelivery)
          .values({
            id: randomUUID(),
            ruleId: rule.id,
            ruleRevision: rule.revision,
            eventId: event.id,
            status: "pending",
            attempts: 0,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
    }
  }

  private scheduleDrain(delayMs: number) {
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain().catch((error) => {
        logger.error(errorLogFields(error), "Notification drain failed");
        this.scheduleDrain(30_000);
      });
    }, delayMs);
    this.retryTimer.unref();
  }

  private drain() {
    if (this.drainInFlight) return this.drainInFlight;
    const drain = this.drainNow().finally(() => {
      if (this.drainInFlight === drain) this.drainInFlight = null;
    });
    this.drainInFlight = drain;
    return drain;
  }

  private async drainNow() {
    const now = Date.now();
    const deliveries = await db
      .select()
      .from(notificationDelivery)
      .where(
        and(
          inArray(notificationDelivery.status, ["pending", "retry"]),
          or(
            lte(notificationDelivery.nextAttemptAt, now),
            isNull(notificationDelivery.nextAttemptAt),
          ),
        ),
      )
      .limit(20);

    for (const delivery of deliveries) {
      if (!this.running) break;
      await this.deliver(delivery.id, true);
    }
    if (!this.running) return;
    const next = await db
      .select({ nextAttemptAt: notificationDelivery.nextAttemptAt })
      .from(notificationDelivery)
      .where(inArray(notificationDelivery.status, ["pending", "retry"]))
      .orderBy(asc(notificationDelivery.nextAttemptAt))
      .limit(1);
    if (next[0]?.nextAttemptAt !== undefined) {
      this.scheduleDrain(
        Math.max(1_000, (next[0].nextAttemptAt ?? now + 30_000) - Date.now()),
      );
    }
  }

  private async deliver(deliveryId: string, stopSensitive = false) {
    const delivery = await db.query.notificationDelivery.findFirst({
      where: eq(notificationDelivery.id, deliveryId),
    });
    if (!delivery || (stopSensitive && !this.running)) return;
    const rule = await db.query.notificationRule.findFirst({
      where: eq(notificationRule.id, delivery.ruleId),
    });
    if (stopSensitive && !this.running) return;
    if (
      !rule ||
      rule.revision !== delivery.ruleRevision ||
      !rule.enabled ||
      rule.target !== "webhook"
    ) {
      await db
        .update(notificationDelivery)
        .set({
          status: "failed",
          nextAttemptAt: null,
          lastError: "Notification rule is no longer active.",
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(notificationDelivery.id, delivery.id),
            eq(notificationDelivery.ruleRevision, delivery.ruleRevision),
          ),
        );
      return;
    }
    if (rule.disabledUntil && rule.disabledUntil > Date.now()) {
      await db
        .update(notificationDelivery)
        .set({
          status: "retry",
          nextAttemptAt: rule.disabledUntil,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(notificationDelivery.id, delivery.id),
            eq(notificationDelivery.ruleRevision, delivery.ruleRevision),
          ),
        );
      return;
    }
    if (!rule.webhookCiphertext || !rule.webhookIv || !rule.webhookAuthTag) {
      await this.fail(delivery, rule.id, "Webhook target is missing.");
      return;
    }

    try {
      const url = decryptSecret({
        ciphertext: rule.webhookCiphertext,
        iv: rule.webhookIv,
        authTag: rule.webhookAuthTag,
        keyVersion: rule.webhookKeyVersion,
      });
      const event = await db.query.steamEvent.findFirst({
        where: (row, { eq: equal }) => equal(row.id, delivery.eventId),
      });
      if (!event) throw new Error("Notification event is no longer available.");
      if (stopSensitive && !this.running) return;
      const abortController = new AbortController();
      this.activeWebhookAbortController = abortController;
      try {
        await this.webhookSender(
          url,
          {
            source: "SteamBee",
            type: "event",
            eventId: delivery.eventId,
            eventType: event.type,
            createdAt: event.createdAt,
          },
          abortController.signal,
        );
      } finally {
        if (this.activeWebhookAbortController === abortController) {
          this.activeWebhookAbortController = null;
        }
      }
      await db
        .update(notificationDelivery)
        .set({
          status: "delivered",
          attempts: delivery.attempts + 1,
          nextAttemptAt: null,
          lastError: null,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(notificationDelivery.id, delivery.id),
            eq(notificationDelivery.ruleRevision, delivery.ruleRevision),
          ),
        );
      await db
        .update(notificationRule)
        .set({ failureCount: 0, disabledUntil: null, updatedAt: Date.now() })
        .where(
          and(
            eq(notificationRule.id, rule.id),
            eq(notificationRule.revision, delivery.ruleRevision),
          ),
        );
    } catch (error) {
      if (!this.running && errorIsAbort(error)) return;
      await this.fail(delivery, rule.id, safeErrorMessage(error));
    }
  }

  private async fail(
    delivery: typeof notificationDelivery.$inferSelect,
    ruleId: string,
    message: string,
  ) {
    const attempts = delivery.attempts + 1;
    const terminal = attempts >= maxAttempts;
    const now = Date.now();
    const rule = await db.query.notificationRule.findFirst({
      where: and(
        eq(notificationRule.id, ruleId),
        eq(notificationRule.revision, delivery.ruleRevision),
      ),
    });
    if (!rule) return;
    const failureCount = (rule?.failureCount ?? 0) + 1;
    await db
      .update(notificationDelivery)
      .set({
        status: terminal ? "failed" : "retry",
        attempts,
        nextAttemptAt: terminal ? null : now + 30_000 * 2 ** (attempts - 1),
        lastError: message,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDelivery.id, delivery.id),
          eq(notificationDelivery.ruleRevision, delivery.ruleRevision),
        ),
      );
    await db
      .update(notificationRule)
      .set({
        failureCount,
        disabledUntil: failureCount >= 5 ? now + 60 * 60_000 : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationRule.id, ruleId),
          eq(notificationRule.revision, delivery.ruleRevision),
        ),
      );
  }
}

export async function sendWebhook(
  target: string,
  payload: Record<string, unknown>,
  externalSignal?: AbortSignal,
) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error("Webhook request timed out.")),
    deliveryTimeoutMs,
  );
  timeout.unref();
  const combined = combineAbortSignals(
    [externalSignal, timeoutController.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    ),
  );
  try {
    const url = new URL(target);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Webhook URL must use HTTP or HTTPS.");
    }
    if (url.username || url.password) {
      throw new Error("Webhook URL must not contain credentials.");
    }
    const addresses = await raceWithAbort(
      resolvePublicAddresses(url.hostname),
      combined.signal,
    );
    const selected = addresses[0];
    if (!selected) throw new Error("Webhook host did not resolve.");

    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    await new Promise<void>((resolve, reject) => {
      if (combined.signal.aborted) {
        reject(abortReason(combined.signal));
        return;
      }
      const outgoing = request(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(body.length),
            "user-agent": "SteamBee notifications",
          },
          lookup: (_hostname, _options, callback) =>
            callback(null, selected.address, selected.family),
          signal: combined.signal,
        },
        (response) => {
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > maximumResponseBytes) {
              outgoing.destroy(new Error("Webhook response was too large."));
            }
          });
          response.on("end", () => {
            if (
              response.statusCode !== undefined &&
              response.statusCode >= 200 &&
              response.statusCode < 300
            ) {
              resolve();
            } else {
              reject(
                new Error(
                  `Webhook returned HTTP ${response.statusCode ?? "unknown"}.`,
                ),
              );
            }
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end(body);
    });
  } finally {
    clearTimeout(timeout);
    combined.cleanup();
  }
}

function combineAbortSignals(signals: AbortSignal[]) {
  const controller = new AbortController();
  const listeners = signals.map((signal) => {
    const onAbort = () => controller.abort(abortReason(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    return { signal, onAbort };
  });
  return {
    signal: controller.signal,
    cleanup() {
      for (const { signal, onAbort } of listeners) {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject<T>(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Webhook request was aborted.");
}

function errorIsAbort(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "Notification dispatcher is stopping.")
  );
}

export async function resolvePublicAddresses(hostname: string) {
  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  const literalFamily = isIP(normalizedHostname);
  const addresses = literalFamily
    ? [{ address: normalizedHostname, family: literalFamily }]
    : await lookup(normalizedHostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIp(address))
  ) {
    throw new Error(
      "Webhook target resolves to a private or reserved address.",
    );
  }
  return addresses;
}

export function isPublicIp(address: string) {
  const family = isIP(address);
  if (family === 0) return false;
  if (
    family === 6 &&
    !ipv4MappedWebhookAddresses.check(address, "ipv6") &&
    !globallyAllocatedIpv6Addresses.check(address, "ipv6")
  ) {
    return false;
  }
  return !blockedWebhookAddresses.check(
    address,
    family === 4 ? "ipv4" : "ipv6",
  );
}

function createWebhookBlockList() {
  const list = new BlockList();
  const ipv4Subnets: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.31.196.0", 24],
    ["192.52.193.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["192.175.48.0", 24],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 3],
  ];
  const ipv6Subnets: Array<[string, number]> = [
    ["::", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["100:0:0:1::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["2620:4f:8000::", 48],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
  ];
  for (const [network, prefix] of ipv4Subnets) {
    list.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of ipv6Subnets) {
    list.addSubnet(network, prefix, "ipv6");
  }
  return list;
}

function createIpv4MappedBlockList() {
  const list = new BlockList();
  list.addSubnet("::ffff:0:0", 96, "ipv6");
  return list;
}

function createGlobalIpv6BlockList() {
  const list = new BlockList();
  // IANA currently allocates public IPv6 global unicast addresses from 2000::/3.
  list.addSubnet("2000::", 3, "ipv6");
  return list;
}

function matchesRule(
  eventTypesJson: string,
  event: Pick<SteamEvent, "type" | "metadata">,
) {
  const eventTypes = parseStringArray(eventTypesJson);
  const status = event.metadata.status;
  const eventKeys = [
    event.type,
    ...(typeof status === "string" ? [`${event.type}.${status}`] : []),
  ];
  return (
    eventTypes.includes("*") ||
    eventKeys.some((eventKey) => eventTypes.includes(eventKey))
  );
}

export const notificationDispatcher = new NotificationDispatcher();
