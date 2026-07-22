import {
  type AccountHealth,
  type AccountSafetyPolicy,
  type RecoveryAction,
  type SafetyHoldReason,
  type SteamErrorClass,
} from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  accountHealthState,
  accountSafetyPolicy,
  steamAccountLibrary,
} from "../db/schema.js";

export type SafetyHoldOwner =
  | { kind: "unscheduled" }
  | { kind: "unknown" }
  | {
      kind: "scheduled";
      scheduleId: string;
      windowId: string;
    };

const unscheduledHoldOwner = { kind: "unscheduled" } as const;
const unknownHoldOwner = { kind: "unknown" } as const;

export async function ensureAccountOperations(accountId: string) {
  const now = Date.now();
  await db
    .insert(accountHealthState)
    .values({ accountId, updatedAt: now })
    .onConflictDoNothing();
  await db
    .insert(accountSafetyPolicy)
    .values({ accountId, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
}

export async function getAccountHealth(
  accountId: string,
): Promise<AccountHealth> {
  await ensureAccountOperations(accountId);
  const row = await db.query.accountHealthState.findFirst({
    where: eq(accountHealthState.accountId, accountId),
  });
  const imported = await db
    .select({ importedAt: steamAccountLibrary.importedAt })
    .from(steamAccountLibrary)
    .where(eq(steamAccountLibrary.accountId, accountId));
  return presentHealth(
    row,
    imported.reduce<number | null>(
      (latest, item) => Math.max(latest ?? 0, item.importedAt),
      null,
    ),
  );
}

export async function getAccountSafetyPolicy(
  accountId: string,
): Promise<AccountSafetyPolicy> {
  await ensureAccountOperations(accountId);
  const row = await db.query.accountSafetyPolicy.findFirst({
    where: eq(accountSafetyPolicy.accountId, accountId),
  });
  if (!row) throw new Error("Account safety policy could not be initialized.");
  return presentSafety(row);
}

export async function getAccountOperationMaps(accountIds: string[]) {
  await Promise.all(accountIds.map(ensureAccountOperations));
  const [healthRows, safetyRows, libraryRows] = await Promise.all([
    db.select().from(accountHealthState),
    db.select().from(accountSafetyPolicy),
    db
      .select({
        accountId: steamAccountLibrary.accountId,
        importedAt: steamAccountLibrary.importedAt,
      })
      .from(steamAccountLibrary),
  ]);
  const latestImport = new Map<string, number>();
  for (const row of libraryRows) {
    latestImport.set(
      row.accountId,
      Math.max(latestImport.get(row.accountId) ?? 0, row.importedAt),
    );
  }
  return {
    health: new Map(
      healthRows.map((row) => [
        row.accountId,
        presentHealth(row, latestImport.get(row.accountId) ?? null),
      ]),
    ),
    safety: new Map(
      safetyRows.map((row) => [row.accountId, presentSafety(row)]),
    ),
  };
}

export async function touchSteamContact(accountId: string, now = Date.now()) {
  await ensureAccountOperations(accountId);
  await db
    .update(accountHealthState)
    .set({ lastSteamContactAt: now, updatedAt: now })
    .where(eq(accountHealthState.accountId, accountId));
}

export async function setRecoveryHealth(
  accountId: string,
  input: {
    nextRetryAt: number | null;
    retryAttempt: number;
    errorClass: SteamErrorClass;
    errorCode: number | null;
    recoveryAction: RecoveryAction;
  },
) {
  await ensureAccountOperations(accountId);
  await db
    .update(accountHealthState)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(accountHealthState.accountId, accountId));
}

export async function clearRecoveryHealth(accountId: string) {
  await setRecoveryHealth(accountId, {
    nextRetryAt: null,
    retryAttempt: 0,
    errorClass: "none",
    errorCode: null,
    recoveryAction: "none",
  });
}

export async function updateSafetyPolicy(
  accountId: string,
  input: {
    maxSessionMinutes: number | null;
    maxDailyMinutes: number | null;
    maxWeeklyMinutes: number | null;
  },
) {
  await ensureAccountOperations(accountId);
  await db
    .update(accountSafetyPolicy)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(accountSafetyPolicy.accountId, accountId));
  return getAccountSafetyPolicy(accountId);
}

export async function setSafetyHold(
  accountId: string,
  holdReason: SafetyHoldReason,
  pauseUntil: number | null = null,
  owner: SafetyHoldOwner = unscheduledHoldOwner,
) {
  await ensureAccountOperations(accountId);
  const now = Date.now();
  await db
    .update(accountSafetyPolicy)
    .set({
      holdReason,
      pauseUntil,
      holdCreatedAt: now,
      holdScheduleId: owner.kind === "scheduled" ? owner.scheduleId : null,
      holdScheduleWindow: owner.kind === "scheduled" ? owner.windowId : null,
      holdScheduleOrigin: owner.kind,
      updatedAt: now,
    })
    .where(eq(accountSafetyPolicy.accountId, accountId));
}

export async function clearSafetyHold(accountId: string) {
  await ensureAccountOperations(accountId);
  await db
    .update(accountSafetyPolicy)
    .set({
      holdReason: null,
      pauseUntil: null,
      holdCreatedAt: null,
      holdScheduleId: null,
      holdScheduleWindow: null,
      holdScheduleOrigin: "unscheduled",
      updatedAt: Date.now(),
    })
    .where(eq(accountSafetyPolicy.accountId, accountId));
}

export async function getSafetyHoldOwner(
  accountId: string,
): Promise<SafetyHoldOwner> {
  await ensureAccountOperations(accountId);
  const row = await db.query.accountSafetyPolicy.findFirst({
    columns: {
      holdScheduleId: true,
      holdScheduleWindow: true,
      holdScheduleOrigin: true,
    },
    where: eq(accountSafetyPolicy.accountId, accountId),
  });
  if (row?.holdScheduleOrigin === "unknown") return unknownHoldOwner;
  if (row?.holdScheduleOrigin !== "scheduled") return unscheduledHoldOwner;
  if (!row.holdScheduleId || !row.holdScheduleWindow) return unknownHoldOwner;
  return {
    kind: "scheduled",
    scheduleId: row.holdScheduleId,
    windowId: row.holdScheduleWindow,
  };
}

export async function getActiveSafetyHold(accountId: string) {
  const policy = await getAccountSafetyPolicy(accountId);
  if (!policy.holdReason) return null;
  return {
    reason: policy.holdReason,
    until: policy.pauseUntil,
  };
}

export async function getActiveAutomationHold(accountId: string) {
  const safetyHold = await getActiveSafetyHold(accountId);
  if (safetyHold) return safetyHold;

  await ensureAccountOperations(accountId);
  const health = await db.query.accountHealthState.findFirst({
    columns: { recoveryAction: true },
    where: eq(accountHealthState.accountId, accountId),
  });
  if (
    health?.recoveryAction === "attention" ||
    health?.recoveryAction === "reauthenticate"
  ) {
    return {
      reason: `recovery_${health.recoveryAction}`,
      until: null,
    };
  }
  return null;
}

type HealthRow = typeof accountHealthState.$inferSelect | undefined;

function presentHealth(
  row: HealthRow,
  libraryImportedAt: number | null,
): AccountHealth {
  return {
    lastSteamContactAt: row?.lastSteamContactAt ?? null,
    nextRetryAt: row?.nextRetryAt ?? null,
    retryAttempt: row?.retryAttempt ?? 0,
    errorClass: isErrorClass(row?.errorClass) ? row.errorClass : "unknown",
    errorCode: row?.errorCode ?? null,
    recoveryAction: isRecoveryAction(row?.recoveryAction)
      ? row.recoveryAction
      : "none",
    libraryImportedAt,
  };
}

function presentSafety(
  row: typeof accountSafetyPolicy.$inferSelect,
): AccountSafetyPolicy {
  return {
    accountId: row.accountId,
    maxSessionMinutes: row.maxSessionMinutes,
    maxDailyMinutes: row.maxDailyMinutes,
    maxWeeklyMinutes: row.maxWeeklyMinutes,
    pauseUntil: row.pauseUntil,
    holdReason: isHoldReason(row.holdReason) ? row.holdReason : null,
    holdCreatedAt: row.holdCreatedAt,
    updatedAt: row.updatedAt,
  };
}

function isErrorClass(value: unknown): value is SteamErrorClass {
  return [
    "none",
    "transient",
    "rate_limited",
    "authentication",
    "session_replaced",
    "terminal",
    "unknown",
  ].includes(String(value));
}

function isRecoveryAction(value: unknown): value is RecoveryAction {
  return ["none", "wait", "retry", "reauthenticate", "attention"].includes(
    String(value),
  );
}

function isHoldReason(value: unknown): value is SafetyHoldReason {
  return [
    "manual",
    "pause_until",
    "session_limit",
    "daily_limit",
    "weekly_limit",
    "safety_failure",
  ].includes(String(value));
}
