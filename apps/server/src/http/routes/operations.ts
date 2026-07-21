import { randomUUID } from "node:crypto";
import {
  ACCOUNT_STATUS_CAPABILITIES,
  ERROR_CODES,
  NOTIFICATION_TARGETS,
  RESUME_POLICIES,
  type AccountGroup,
  type BulkAccountCommand,
  type BulkAccountCommandResult,
  type NotificationRule,
  type PlaytimeGoal,
} from "@steam-bee/contracts";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { createEncryptedBackup } from "../../backup/service.js";
import { db, sqlite } from "../../db/client.js";
import {
  accountGroup,
  accountGroupMember,
  notificationDelivery,
  notificationRule,
  playtimeGoal,
  scheduleException,
  steamAccount,
  steamAccountLibrary,
  steamAppCache,
} from "../../db/schema.js";
import { encryptSecret } from "../../util/crypto.js";
import { parseStringArray } from "../../util/json.js";
import { safeErrorMessage } from "../../util/redact.js";
import { getAccountOrThrow } from "../../steam/account-repository.js";
import { requireScheduleForAccount } from "../../steam/automation-repository.js";
import { steamManager } from "../../steam/manager.js";
import {
  getAccountSafetyPolicy,
  updateSafetyPolicy,
} from "../../steam/operations-repository.js";
import { buildSchedulePreview } from "../../steam/schedule-preview.js";
import {
  accountIdParams,
  accountScheduleParams,
} from "../../steam/validation.js";
import { requireAuth } from "../plugins.js";
import { operationContext } from "../operation-context.js";
import { recordInfoEventSafely } from "../events.js";
import { appError } from "../errors.js";

const nullableLimit = z
  .number()
  .int()
  .min(5)
  .max(7 * 24 * 60)
  .nullable();
const safetySchema = z.object({
  resumePolicy: z.enum(RESUME_POLICIES),
  resumeDelayMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  maxSessionMinutes: nullableLimit,
  maxDailyMinutes: nullableLimit,
  maxWeeklyMinutes: nullableLimit,
});
const groupSchema = z.object({
  name: z.string().trim().min(1).max(64),
  accountIds: z.array(z.string().uuid()).min(1).max(100),
});
const goalSchema = z.object({
  appId: z.number().int().positive(),
  targetMinutes: z.number().int().min(1).max(10_000_000),
});
const webhookUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine(hasWebhookProtocol, "Webhook URLs must use HTTP or HTTPS.")
  .refine(hasNoUrlCredentials, "Webhook URLs must not contain credentials.");
const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    target: z.enum(NOTIFICATION_TARGETS),
    enabled: z.boolean(),
    eventTypes: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(120)
          .regex(/^[a-zA-Z0-9.*_-]+$/),
      )
      .min(1)
      .max(30),
    webhookUrl: webhookUrlSchema.nullable().optional(),
  })
  .refine((value) => value.target !== "webhook" || Boolean(value.webhookUrl), {
    message: "Webhook rules require a target URL.",
  });

export async function registerOperationsRoutes(app: FastifyInstance) {
  registerSafetyRoutes(app);
  registerScheduleOperations(app);
  registerGroupRoutes(app);
  registerGoalRoutes(app);
  registerNotificationRoutes(app);
  registerBackupRoute(app);
}

function registerSafetyRoutes(app: FastifyInstance) {
  app.get(
    "/api/accounts/:id/safety",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      return getAccountSafetyPolicy(id);
    },
  );
  app.put(
    "/api/accounts/:id/safety",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const body = safetySchema.parse(request.body);
      return steamManager.runAccountOperation(id, async () => {
        await getAccountOrThrow(id);
        const policy = await updateSafetyPolicy(id, body);
        await recordInfoEventSafely({
          accountId: id,
          type: "steam.safety.update",
          message: "Session safety policy updated.",
          metadata: operationContext(request, "safety-update"),
        });
        return policy;
      });
    },
  );
  app.post(
    "/api/accounts/:id/safety/pause-until",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const { until } = pauseUntilSchema.parse(request.body);
      await getAccountOrThrow(id);
      await steamManager.pauseUntil(
        id,
        until,
        operationContext(request, "pause-until"),
      );
      return getAccountSafetyPolicy(id);
    },
  );
}

const pauseUntilSchema = z
  .object({ until: z.number().int() })
  .refine((value) => value.until >= Date.now() + 60_000, {
    path: ["until"],
    message: "Pause-until must be at least one minute in the future.",
  });

function registerScheduleOperations(app: FastifyInstance) {
  app.get(
    "/api/accounts/:id/schedules/preview",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const { days } = z
        .object({ days: z.coerce.number().int().min(1).max(14).default(7) })
        .parse(request.query);
      await getAccountOrThrow(id);
      return buildSchedulePreview(id, days);
    },
  );
  app.post(
    "/api/accounts/:id/schedules/:scheduleId/skip-next",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountScheduleParams.parse(request.params);
      return steamManager.runAccountOperation(params.id, async () => {
        await requireScheduleForAccount(params.id, params.scheduleId);
        const preview = await buildSchedulePreview(params.id, 14);
        const next = preview.items.find(
          (item) =>
            item.scheduleId === params.scheduleId &&
            !item.skipped &&
            item.startsAt >= preview.generatedAt,
        );
        if (!next)
          throw appError(
            "No upcoming schedule window is available.",
            409,
            ERROR_CODES.conflict,
          );
        await db
          .insert(scheduleException)
          .values({
            id: randomUUID(),
            scheduleId: params.scheduleId,
            accountId: params.id,
            windowId: next.windowId,
            action: "skip",
            createdAt: Date.now(),
          })
          .onConflictDoNothing();
        steamManager.invalidateSchedules(params.id);
        await recordInfoEventSafely({
          accountId: params.id,
          type: "steam.schedule.skip",
          message: "The next schedule window will be skipped.",
          metadata: {
            ...operationContext(request, "schedule-skip-next"),
            scheduleId: params.scheduleId,
            windowId: next.windowId,
          },
        });
        return { ok: true, windowId: next.windowId };
      });
    },
  );
}

function registerGroupRoutes(app: FastifyInstance) {
  app.get("/api/account-groups", { preHandler: requireAuth }, listGroups);
  app.post(
    "/api/account-groups",
    { preHandler: requireAuth },
    async (request) => {
      const body = groupSchema.parse(request.body);
      await requireAccounts(body.accountIds);
      const id = randomUUID();
      persistGroup(id, body.name, body.accountIds, Date.now(), false);
      return (await listGroups()).find((group) => group.id === id);
    },
  );
  app.put(
    "/api/account-groups/:groupId",
    { preHandler: requireAuth },
    async (request) => {
      const { groupId } = z
        .object({ groupId: z.string().uuid() })
        .parse(request.params);
      const body = groupSchema.parse(request.body);
      await requireGroup(groupId);
      await requireAccounts(body.accountIds);
      persistGroup(groupId, body.name, body.accountIds, Date.now(), true);
      return (await listGroups()).find((group) => group.id === groupId);
    },
  );
  app.delete(
    "/api/account-groups/:groupId",
    { preHandler: requireAuth },
    async (request) => {
      const { groupId } = z
        .object({ groupId: z.string().uuid() })
        .parse(request.params);
      await requireGroup(groupId);
      await db.delete(accountGroup).where(eq(accountGroup.id, groupId));
      return { ok: true };
    },
  );
  app.post(
    "/api/account-groups/:groupId/actions/:command",
    { preHandler: requireAuth },
    async (request) => {
      const { groupId, command } = z
        .object({
          groupId: z.string().uuid(),
          command: z.enum(["pause", "stop"]),
        })
        .parse(request.params);
      await requireGroup(groupId);
      const members = await db
        .select({ accountId: accountGroupMember.accountId })
        .from(accountGroupMember)
        .where(eq(accountGroupMember.groupId, groupId));
      const settled = await Promise.allSettled(
        members.map(async ({ accountId }) => {
          if (
            command === "pause" &&
            !ACCOUNT_STATUS_CAPABILITIES[steamManager.getStatus(accountId)]
              .canPause
          ) {
            throw new Error("Account has no active Steam session to pause.");
          }
          return command === "pause"
            ? steamManager.pause(accountId, {
                ...operationContext(request, "group-pause"),
                source: "account-group",
                groupId,
              })
            : steamManager.stop(accountId, {
                ...operationContext(request, "group-stop"),
                source: "account-group",
                groupId,
              });
        }),
      );
      return {
        groupId,
        command,
        results: settled.map((result, index) => ({
          accountId: members[index]!.accountId,
          ok: result.status === "fulfilled",
          error:
            result.status === "rejected"
              ? safeErrorMessage(result.reason)
              : null,
        })),
      } satisfies BulkAccountCommandResult;
    },
  );
}

async function listGroups(): Promise<AccountGroup[]> {
  const [groups, members] = await Promise.all([
    db.select().from(accountGroup),
    db.select().from(accountGroupMember),
  ]);
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    accountIds: members
      .filter((member) => member.groupId === group.id)
      .map((member) => member.accountId),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }));
}

function persistGroup(
  id: string,
  name: string,
  accountIds: string[],
  now: number,
  update: boolean,
) {
  const save = sqlite.transaction(() => {
    if (update) {
      sqlite
        .prepare(
          "UPDATE account_group SET name = ?, updated_at = ? WHERE id = ?",
        )
        .run(name, now, id);
      sqlite
        .prepare("DELETE FROM account_group_member WHERE group_id = ?")
        .run(id);
    } else {
      sqlite
        .prepare(
          "INSERT INTO account_group (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, name, now, now);
    }
    const insert = sqlite.prepare(
      "INSERT INTO account_group_member (group_id, account_id, created_at) VALUES (?, ?, ?)",
    );
    for (const accountId of [...new Set(accountIds)])
      insert.run(id, accountId, now);
  });
  save();
}

function registerGoalRoutes(app: FastifyInstance) {
  app.get(
    "/api/accounts/:id/goals",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      await getAccountOrThrow(id);
      return listGoals(id);
    },
  );
  app.put(
    "/api/accounts/:id/goals",
    { preHandler: requireAuth },
    async (request) => {
      const { id } = accountIdParams.parse(request.params);
      const body = goalSchema.parse(request.body);
      const libraryEntry = await db.query.steamAccountLibrary.findFirst({
        where: and(
          eq(steamAccountLibrary.accountId, id),
          eq(steamAccountLibrary.appId, body.appId),
        ),
      });
      if (!libraryEntry)
        throw appError(
          "Import the game before creating a goal.",
          409,
          ERROR_CODES.conflict,
        );
      const now = Date.now();
      await db
        .insert(playtimeGoal)
        .values({
          id: randomUUID(),
          accountId: id,
          ...body,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [playtimeGoal.accountId, playtimeGoal.appId],
          set: { targetMinutes: body.targetMinutes, updatedAt: now },
        });
      return listGoals(id);
    },
  );
  app.delete(
    "/api/accounts/:id/goals/:goalId",
    { preHandler: requireAuth },
    async (request) => {
      const { id, goalId } = z
        .object({ id: z.string().uuid(), goalId: z.string().uuid() })
        .parse(request.params);
      await db
        .delete(playtimeGoal)
        .where(
          and(eq(playtimeGoal.id, goalId), eq(playtimeGoal.accountId, id)),
        );
      return { ok: true };
    },
  );
}

async function listGoals(accountId: string): Promise<PlaytimeGoal[]> {
  const rows = await db
    .select({
      id: playtimeGoal.id,
      accountId: playtimeGoal.accountId,
      appId: playtimeGoal.appId,
      appName: steamAppCache.name,
      targetMinutes: playtimeGoal.targetMinutes,
      currentMinutes: steamAccountLibrary.playtimeForever,
      snapshotImportedAt: steamAccountLibrary.importedAt,
      createdAt: playtimeGoal.createdAt,
      updatedAt: playtimeGoal.updatedAt,
    })
    .from(playtimeGoal)
    .leftJoin(
      steamAccountLibrary,
      and(
        eq(steamAccountLibrary.accountId, playtimeGoal.accountId),
        eq(steamAccountLibrary.appId, playtimeGoal.appId),
      ),
    )
    .leftJoin(steamAppCache, eq(steamAppCache.appId, playtimeGoal.appId))
    .where(eq(playtimeGoal.accountId, accountId));
  return rows.map((row) => {
    const currentMinutes = row.currentMinutes ?? 0;
    return {
      ...row,
      appName: row.appName ?? `App ${row.appId}`,
      currentMinutes,
      progressPercent: Math.min(
        100,
        Math.round((currentMinutes / row.targetMinutes) * 100),
      ),
      reached: currentMinutes >= row.targetMinutes,
    };
  });
}

function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/api/notifications/rules", { preHandler: requireAuth }, listRules);
  app.post(
    "/api/notifications/rules",
    { preHandler: requireAuth },
    async (request) => {
      const body = ruleSchema.parse(request.body);
      const now = Date.now();
      if (body.target === "browser") {
        upsertBrowserRule(body, now);
        return listRules();
      }
      await db
        .insert(notificationRule)
        .values(ruleValues(randomUUID(), body, now));
      return listRules();
    },
  );
  app.put(
    "/api/notifications/rules/:ruleId",
    { preHandler: requireAuth },
    async (request) => {
      const { ruleId } = z
        .object({ ruleId: z.string().uuid() })
        .parse(request.params);
      const body = ruleSchema.parse(request.body);
      const existing = await db.query.notificationRule.findFirst({
        where: eq(notificationRule.id, ruleId),
      });
      if (!existing)
        throw appError(
          "Notification rule was not found.",
          404,
          ERROR_CODES.notFound,
        );
      const now = Date.now();
      const replaceRuleConfiguration = sqlite.transaction(() => {
        sqlite
          .prepare("DELETE FROM notification_delivery WHERE rule_id = ?")
          .run(ruleId);
        const values = ruleValues(ruleId, body, now);
        sqlite
          .prepare(
            `UPDATE notification_rule
             SET name = ?, target = ?, enabled = ?, event_types_json = ?,
                 webhook_ciphertext = ?, webhook_iv = ?, webhook_auth_tag = ?,
                 webhook_key_version = ?, failure_count = ?, disabled_until = ?,
                 created_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            values.name,
            values.target,
            values.enabled ? 1 : 0,
            values.eventTypesJson,
            values.webhookCiphertext,
            values.webhookIv,
            values.webhookAuthTag,
            values.webhookKeyVersion,
            values.failureCount,
            values.disabledUntil,
            values.createdAt,
            values.updatedAt,
            ruleId,
          );
      });
      replaceRuleConfiguration();
      return listRules();
    },
  );
  app.delete(
    "/api/notifications/rules/:ruleId",
    { preHandler: requireAuth },
    async (request) => {
      const { ruleId } = z
        .object({ ruleId: z.string().uuid() })
        .parse(request.params);
      await db.delete(notificationRule).where(eq(notificationRule.id, ruleId));
      return { ok: true };
    },
  );
}

const upsertBrowserRule = sqlite.transaction(
  (body: z.infer<typeof ruleSchema>, now: number) => {
    const existing = sqlite
      .prepare(
        `SELECT id
         FROM notification_rule
         WHERE target = 'browser'
         ORDER BY created_at, id
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    const ruleId = existing?.id ?? randomUUID();
    const values = ruleValues(ruleId, body, now);
    if (existing) {
      sqlite
        .prepare("DELETE FROM notification_delivery WHERE rule_id = ?")
        .run(ruleId);
      sqlite
        .prepare(
          `UPDATE notification_rule
           SET name = ?, target = ?, enabled = ?, event_types_json = ?,
               webhook_ciphertext = ?, webhook_iv = ?, webhook_auth_tag = ?,
               webhook_key_version = ?, failure_count = ?, disabled_until = ?,
               created_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          values.name,
          values.target,
          values.enabled ? 1 : 0,
          values.eventTypesJson,
          values.webhookCiphertext,
          values.webhookIv,
          values.webhookAuthTag,
          values.webhookKeyVersion,
          values.failureCount,
          values.disabledUntil,
          values.createdAt,
          values.updatedAt,
          ruleId,
        );
      return;
    }
    sqlite
      .prepare(
        `INSERT INTO notification_rule (
           id, name, target, enabled, event_types_json, webhook_ciphertext,
           webhook_iv, webhook_auth_tag, webhook_key_version, failure_count,
           disabled_until, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        values.id,
        values.name,
        values.target,
        values.enabled ? 1 : 0,
        values.eventTypesJson,
        values.webhookCiphertext,
        values.webhookIv,
        values.webhookAuthTag,
        values.webhookKeyVersion,
        values.failureCount,
        values.disabledUntil,
        values.createdAt,
        values.updatedAt,
      );
  },
);

async function listRules(): Promise<NotificationRule[]> {
  const rows = await db.select().from(notificationRule);
  const retryRows = sqlite
    .prepare(
      `SELECT rule_id AS ruleId, MIN(next_attempt_at) AS nextRetryAt
       FROM notification_delivery
       WHERE status = 'retry' AND next_attempt_at IS NOT NULL
       GROUP BY rule_id`,
    )
    .all() as Array<{ ruleId: string; nextRetryAt: number }>;
  const nextRetryByRule = new Map(
    retryRows.map((row) => [row.ruleId, row.nextRetryAt]),
  );
  const now = Date.now();
  return rows.map((rule) => ({
    ...notificationRuleHealth(rule, nextRetryByRule.get(rule.id) ?? null, now),
    id: rule.id,
    name: rule.name,
    target: rule.target === "webhook" ? "webhook" : "browser",
    enabled: rule.enabled,
    eventTypes: parseStringArray(rule.eventTypesJson),
    webhookConfigured: Boolean(rule.webhookCiphertext),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }));
}

function notificationRuleHealth(
  rule: typeof notificationRule.$inferSelect,
  nextRetryAt: number | null,
  now: number,
): Pick<
  NotificationRule,
  | "effectiveEnabled"
  | "effectiveStatus"
  | "failureCount"
  | "suspendedUntil"
  | "nextRetryAt"
> {
  const suspendedUntil =
    rule.disabledUntil !== null && rule.disabledUntil > now
      ? rule.disabledUntil
      : null;
  const effectiveStatus = !rule.enabled
    ? "disabled"
    : suspendedUntil !== null
      ? "suspended"
      : nextRetryAt !== null
        ? "retrying"
        : rule.failureCount > 0
          ? "failed"
          : "active";
  return {
    effectiveEnabled: rule.enabled && suspendedUntil === null,
    effectiveStatus,
    failureCount: rule.failureCount,
    suspendedUntil,
    nextRetryAt,
  };
}

function ruleValues(
  id: string,
  body: z.infer<typeof ruleSchema>,
  now: number,
  createdAt = now,
) {
  const encrypted =
    body.target === "webhook" && body.webhookUrl
      ? encryptSecret(body.webhookUrl)
      : null;
  return {
    id,
    name: body.name,
    target: body.target,
    enabled: body.enabled,
    eventTypesJson: JSON.stringify([...new Set(body.eventTypes)]),
    webhookCiphertext: encrypted?.ciphertext ?? null,
    webhookIv: encrypted?.iv ?? null,
    webhookAuthTag: encrypted?.authTag ?? null,
    webhookKeyVersion: encrypted?.keyVersion ?? 1,
    failureCount: 0,
    disabledUntil: null,
    createdAt,
    updatedAt: now,
  };
}

function registerBackupRoute(app: FastifyInstance) {
  app.post(
    "/api/admin/backup",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { passphrase } = z
        .object({ passphrase: z.string().min(12).max(256) })
        .parse(request.body);
      const backup = await createEncryptedBackup(passphrase);
      const date = new Date().toISOString().slice(0, 10);
      return reply
        .header("content-type", "application/vnd.steam-bee.backup")
        .header(
          "content-disposition",
          `attachment; filename="steam-bee-${date}.sbb"`,
        )
        .send(backup);
    },
  );
}

async function requireAccounts(accountIds: string[]) {
  const unique = [...new Set(accountIds)];
  const rows = await db
    .select({ id: steamAccount.id })
    .from(steamAccount)
    .where(inArray(steamAccount.id, unique));
  if (rows.length !== unique.length)
    throw appError(
      "One or more accounts were not found.",
      404,
      ERROR_CODES.accountNotFound,
    );
}

async function requireGroup(groupId: string) {
  const group = await db.query.accountGroup.findFirst({
    where: eq(accountGroup.id, groupId),
  });
  if (!group)
    throw appError("Account group was not found.", 404, ERROR_CODES.notFound);
  return group;
}

function hasWebhookProtocol(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function hasNoUrlCredentials(value: string) {
  try {
    const url = new URL(value);
    return !url.username && !url.password;
  } catch {
    return false;
  }
}
