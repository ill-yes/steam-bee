import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  notificationDelivery,
  notificationRule,
  steamEvent,
} from "../src/db/schema.js";
import {
  isPublicIp,
  NotificationDispatcher,
  resolvePublicAddresses,
} from "../src/notifications/dispatcher.js";
import { encryptSecret } from "../src/util/crypto.js";

beforeEach(() => {
  migrate();
  sqlite.exec(`
    DELETE FROM notification_delivery;
    DELETE FROM notification_rule;
    DELETE FROM steam_event;
  `);
});

describe("webhook address policy", () => {
  it("rejects local and reserved destinations", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "fec0::1",
      "2001:db8::1",
      "::7f00:1",
      "::ffff:7f00:1",
      "::ffff:a00:1",
      "::ffff:a9fe:a9fe",
      "::ffff:c0a8:101",
      "64:ff9b::7f00:1",
      "64:ff9b:1::7f00:1",
      "100::1",
      "100:0:0:1::1",
      "2001::1",
      "2001:1::1",
      "2001:3::1",
      "2001:4:112::1",
      "2001:20::1",
      "2001:30::1",
      "2002:7f00:1::",
      "2620:4f:8000::1",
      "3fff::1",
      "5f00::1",
      "4000::1",
    ]) {
      expect(isPublicIp(address), address).toBe(false);
    }
    expect(isPublicIp("1.1.1.1")).toBe(true);
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIp("3000::1")).toBe(true);
    expect(isPublicIp("::ffff:808:808")).toBe(true);
  });

  it("accepts a bracketed public IPv6 literal without a DNS lookup", async () => {
    await expect(
      resolvePublicAddresses("[2606:4700:4700::1111]"),
    ).resolves.toEqual([{ address: "2606:4700:4700::1111", family: 6 }]);
    await expect(resolvePublicAddresses("[::1]")).rejects.toThrow(
      /private|reserved/i,
    );
    await expect(resolvePublicAddresses("[::ffff:7f00:1]")).rejects.toThrow(
      /private|reserved/i,
    );
  });

  it("deduplicates matching durable deliveries", async () => {
    const dispatcher = new NotificationDispatcher();
    await insertRule("steam.status.login_required");
    const event = await insertEvent("steam.status", {
      status: "login_required",
    });

    await dispatcher.enqueue(event);
    await dispatcher.enqueue(event);

    const deliveries = await db.select().from(notificationDelivery);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      eventId: event.id,
      status: "pending",
      attempts: 0,
    });
  });

  it("reconciles a committed event when enqueue was interrupted", async () => {
    const dispatcher = new NotificationDispatcher();
    const ruleId = await insertRule("steam.status.login_required");
    const event = await insertEvent("steam.status", {
      status: "login_required",
    });

    await dispatcher.reconcile();

    expect(await deliveryFor(event.id)).toMatchObject({
      ruleId,
      eventId: event.id,
      status: "pending",
      attempts: 0,
    });
  });

  it("uses an event ID boundary even when timestamps are identical", async () => {
    const occurredAt = Date.now();
    const oldEvent = await insertEvent("steam.status", {}, occurredAt);
    const ruleId = await insertRule("steam.status");
    await db
      .update(notificationRule)
      .set({ startAfterEventId: oldEvent.id })
      .where(eq(notificationRule.id, ruleId));
    const newEvent = await insertEvent("steam.status", {}, occurredAt);
    const dispatcher = new NotificationDispatcher();

    await dispatcher.reconcile();

    const deliveries = await db.select().from(notificationDelivery);
    expect(deliveries).toEqual([
      expect.objectContaining({ eventId: newEvent.id, ruleRevision: 1 }),
    ]);
  });

  it("does not let an in-flight old revision update a replacement rule", async () => {
    let releaseWebhook: (() => void) | undefined;
    const webhookGate = new Promise<void>((resolve) => {
      releaseWebhook = resolve;
    });
    const targets: string[] = [];
    const dispatcher = new NotificationDispatcher(async (target) => {
      targets.push(target);
      await webhookGate;
    });
    const ruleId = await insertRule("steam.status", "https://old.example/hook");
    const event = await insertEvent("steam.status");
    await dispatcher.enqueue(event);
    const delivery = await deliveryFor(event.id);

    const inFlight = deliver(dispatcher, delivery.id);
    await vi.waitFor(() =>
      expect(targets).toEqual(["https://old.example/hook"]),
    );
    await db
      .update(notificationRule)
      .set({ revision: 2, failureCount: 7, startAfterEventId: event.id })
      .where(eq(notificationRule.id, ruleId));
    await db
      .delete(notificationDelivery)
      .where(eq(notificationDelivery.ruleId, ruleId));
    releaseWebhook?.();
    await inFlight;

    const rule = await db.query.notificationRule.findFirst({
      where: eq(notificationRule.id, ruleId),
    });
    expect(rule).toMatchObject({ revision: 2, failureCount: 7 });
    expect(await db.select().from(notificationDelivery)).toEqual([]);
  });

  it("bounds retries and opens the rule circuit breaker", async () => {
    const dispatcher = new NotificationDispatcher();
    const ruleId = await insertRule("*", "http://127.0.0.1/hook");
    const firstEvent = await insertEvent("steam.safety.cap");
    await dispatcher.enqueue(firstEvent);
    const firstDelivery = await deliveryFor(firstEvent.id);

    await deliver(dispatcher, firstDelivery.id);
    await deliver(dispatcher, firstDelivery.id);
    await deliver(dispatcher, firstDelivery.id);

    expect(await deliveryFor(firstEvent.id)).toMatchObject({
      status: "failed",
      attempts: 3,
      nextAttemptAt: null,
    });

    const secondEvent = await insertEvent("steam.schedule.error");
    await dispatcher.enqueue(secondEvent);
    const secondDelivery = await deliveryFor(secondEvent.id);
    await deliver(dispatcher, secondDelivery.id);
    await deliver(dispatcher, secondDelivery.id);

    const rule = await db.query.notificationRule.findFirst({
      where: eq(notificationRule.id, ruleId),
    });
    expect(rule).toMatchObject({ failureCount: 5 });
    expect(rule?.disabledUntil).toBeGreaterThan(Date.now());

    await deliver(dispatcher, secondDelivery.id);
    const deferred = await deliveryFor(secondEvent.id);
    expect(deferred).toMatchObject({
      status: "retry",
      attempts: 2,
      nextAttemptAt: rule?.disabledUntil,
    });
  });

  it("keeps the original event timestamp stable across webhook retries", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    let attempt = 0;
    const dispatcher = new NotificationDispatcher(async (_target, payload) => {
      payloads.push(payload);
      attempt += 1;
      if (attempt === 1) throw new Error("temporary webhook failure");
    });
    await insertRule("steam.schedule.error");
    const occurredAt = 1_735_689_600_000;
    const event = await insertEvent("steam.schedule.error", {}, occurredAt);
    await dispatcher.enqueue(event);
    const delivery = await deliveryFor(event.id);

    await deliver(dispatcher, delivery.id);
    await deliver(dispatcher, delivery.id);

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual({
      source: "SteamBee",
      type: "event",
      eventId: event.id,
      eventType: event.type,
      createdAt: occurredAt,
    });
    expect(payloads[1]).toEqual(payloads[0]);
    expect(await deliveryFor(event.id)).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
  });

  it("aborts the active webhook and leaves later deliveries pending on stop", async () => {
    let observedSignal: AbortSignal | undefined;
    let sendCount = 0;
    const dispatcher = new NotificationDispatcher(
      async (_target, _payload, signal) => {
        sendCount += 1;
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    await insertRule("*");
    await dispatcher.enqueue(await insertEvent("steam.status"));
    await dispatcher.enqueue(await insertEvent("steam.schedule.error"));

    dispatcher.start();
    await vi.waitFor(() => expect(sendCount).toBe(1));
    await dispatcher.stop();

    expect(observedSignal?.aborted).toBe(true);
    expect(sendCount).toBe(1);
    expect(await db.select().from(notificationDelivery)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "pending", attempts: 0 }),
        expect.objectContaining({ status: "pending", attempts: 0 }),
      ]),
    );
  });
});

async function insertRule(
  eventType: string,
  target = "https://example.com/hook",
) {
  const encrypted = encryptSecret(target);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(notificationRule).values({
    id,
    name: "Test webhook",
    target: "webhook",
    enabled: true,
    eventTypesJson: JSON.stringify([eventType]),
    webhookCiphertext: encrypted.ciphertext,
    webhookIv: encrypted.iv,
    webhookAuthTag: encrypted.authTag,
    webhookKeyVersion: encrypted.keyVersion,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertEvent(
  type: string,
  metadata: Record<string, unknown> = {},
  createdAt = Date.now(),
) {
  const [row] = await db
    .insert(steamEvent)
    .values({
      accountId: null,
      level: "info",
      type,
      message: "redacted test event",
      metadataJson: JSON.stringify(metadata),
      createdAt,
    })
    .returning();
  if (!row) throw new Error("Test event was not inserted.");
  return {
    id: row.id,
    accountId: null,
    level: "info" as const,
    type,
    message: row.message,
    metadata,
    createdAt,
  };
}

async function deliveryFor(eventId: number) {
  const row = await db.query.notificationDelivery.findFirst({
    where: eq(notificationDelivery.eventId, eventId),
  });
  if (!row) throw new Error("Test delivery was not inserted.");
  return row;
}

function deliver(dispatcher: NotificationDispatcher, deliveryId: string) {
  return (
    dispatcher as unknown as {
      deliver(id: string): Promise<void>;
    }
  ).deliver(deliveryId);
}
