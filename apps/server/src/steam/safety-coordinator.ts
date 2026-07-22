import type { SafetyHoldReason } from "@steam-bee/contracts";
import { eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  accountSafetyPolicy,
  boostSession,
  steamAccount,
} from "../db/schema.js";
import type { OperationContext } from "../operation-context.js";
import { setSafetyHold } from "./operations-repository.js";

type SafetyPorts = {
  runForAccount: <T>(
    accountId: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
  pause: (accountId: string, context: OperationContext) => Promise<void>;
  recordInfo: (
    accountId: string,
    type: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  onTickError: (error: unknown) => void;
};

const safetyIntervalMs = 60_000;

export class SafetyCoordinator {
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight: Promise<void> | null = null;

  constructor(private readonly ports: SafetyPorts) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(this.ports.onTickError);
    }, safetyIntervalMs);
    this.timer.unref();
    void this.tick().catch(this.ports.onTickError);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.tickInFlight?.catch(() => undefined);
  }

  tick(now = Date.now()) {
    if (this.tickInFlight) return this.tickInFlight;
    const tick = this.tickNow(now).finally(() => {
      if (this.tickInFlight === tick) this.tickInFlight = null;
    });
    this.tickInFlight = tick;
    return tick;
  }

  private async tickNow(now: number) {
    const policies = await db
      .select({
        accountId: accountSafetyPolicy.accountId,
        maxSessionMinutes: accountSafetyPolicy.maxSessionMinutes,
        maxDailyMinutes: accountSafetyPolicy.maxDailyMinutes,
        maxWeeklyMinutes: accountSafetyPolicy.maxWeeklyMinutes,
        holdReason: accountSafetyPolicy.holdReason,
        status: steamAccount.status,
        desiredState: steamAccount.desiredState,
      })
      .from(accountSafetyPolicy)
      .innerJoin(
        steamAccount,
        eq(steamAccount.id, accountSafetyPolicy.accountId),
      )
      .where(isNull(accountSafetyPolicy.holdReason));

    for (const policy of policies) {
      if (policy.status !== "boosting" || policy.desiredState !== "running") {
        continue;
      }
      const cap = await exceededCap(policy, now);
      if (!cap) continue;

      await this.ports.runForAccount(policy.accountId, async () => {
        const current = await safetyPolicyForAccount(policy.accountId);
        if (
          !current ||
          current.status !== "boosting" ||
          current.desiredState !== "running" ||
          current.holdReason !== null
        ) {
          return;
        }
        const currentCap = await exceededCap(current, now);
        if (!currentCap) return;

        await setSafetyHold(policy.accountId, currentCap.reason);
        const context = {
          source: "safety",
          action: "safety-cap",
          cap: currentCap.reason,
          consumedMinutes: Math.ceil(currentCap.consumedMs / 60_000),
          limitMinutes: currentCap.limitMinutes,
        } satisfies OperationContext;
        await this.ports.pause(policy.accountId, context);
        await this.ports.recordInfo(
          policy.accountId,
          "steam.safety.cap",
          "A configured safety limit paused the Steam session.",
          context,
        );
      });
    }
  }
}

async function safetyPolicyForAccount(accountId: string) {
  const [policy] = await db
    .select({
      accountId: accountSafetyPolicy.accountId,
      maxSessionMinutes: accountSafetyPolicy.maxSessionMinutes,
      maxDailyMinutes: accountSafetyPolicy.maxDailyMinutes,
      maxWeeklyMinutes: accountSafetyPolicy.maxWeeklyMinutes,
      holdReason: accountSafetyPolicy.holdReason,
      status: steamAccount.status,
      desiredState: steamAccount.desiredState,
    })
    .from(accountSafetyPolicy)
    .innerJoin(steamAccount, eq(steamAccount.id, accountSafetyPolicy.accountId))
    .where(eq(accountSafetyPolicy.accountId, accountId));
  return policy;
}

async function exceededCap(
  policy: {
    accountId: string;
    maxSessionMinutes: number | null;
    maxDailyMinutes: number | null;
    maxWeeklyMinutes: number | null;
  },
  now: number,
) {
  if (
    policy.maxSessionMinutes === null &&
    policy.maxDailyMinutes === null &&
    policy.maxWeeklyMinutes === null
  ) {
    return null;
  }

  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  const weekday = (startOfWeek.getUTCDay() + 6) % 7;
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - weekday);

  const sessions = await db
    .select({
      startedAt: boostSession.startedAt,
      endedAt: boostSession.endedAt,
    })
    .from(boostSession)
    .where(eq(boostSession.accountId, policy.accountId));

  const open = sessions.find((session) => session.endedAt === null);
  const sessionMs = open ? Math.max(0, now - open.startedAt) : 0;
  const dailyMs = sumOverlap(sessions, startOfDay.getTime(), now);
  const weeklyMs = sumOverlap(sessions, startOfWeek.getTime(), now);

  return (
    capResult("session_limit", sessionMs, policy.maxSessionMinutes) ??
    capResult("daily_limit", dailyMs, policy.maxDailyMinutes) ??
    capResult("weekly_limit", weeklyMs, policy.maxWeeklyMinutes)
  );
}

function capResult(
  reason: SafetyHoldReason,
  consumedMs: number,
  limitMinutes: number | null,
) {
  if (limitMinutes === null || consumedMs < limitMinutes * 60_000) return null;
  return { reason, consumedMs, limitMinutes };
}

function sumOverlap(
  sessions: Array<{ startedAt: number; endedAt: number | null }>,
  rangeStart: number,
  rangeEnd: number,
) {
  return sessions.reduce((total, session) => {
    const start = Math.max(session.startedAt, rangeStart);
    const end = Math.min(session.endedAt ?? rangeEnd, rangeEnd);
    return total + Math.max(0, end - start);
  }, 0);
}
