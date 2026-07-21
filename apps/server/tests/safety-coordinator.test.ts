import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, migrate, sqlite } from "../src/db/client.js";
import {
  accountSafetyPolicy,
  boostSession,
  steamAccount,
} from "../src/db/schema.js";
import { SafetyCoordinator } from "../src/steam/safety-coordinator.js";

describe("SafetyCoordinator", () => {
  beforeEach(() => {
    migrate();
    sqlite.exec("DELETE FROM steam_account;");
  });

  it("pauses an existing session once when its cap is reached", async () => {
    const now = Date.now();
    const accountId = crypto.randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `safety-${now}`,
      status: "boosting",
      desiredState: "running",
      personaState: 7,
      tokenKeyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(accountSafetyPolicy).values({
      accountId,
      resumePolicy: "automatic",
      resumeDelayMinutes: 15,
      maxSessionMinutes: 5,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(boostSession).values({
      id: crypto.randomUUID(),
      accountId,
      appIdsJson: "[730]",
      startedAt: now - 6 * 60_000,
      createdAt: now - 6 * 60_000,
    });
    const pause = vi.fn(async () => undefined);
    const recordInfo = vi.fn(async () => undefined);
    const coordinator = new SafetyCoordinator({
      runForAccount: async (_accountId, operation) => operation(),
      pause,
      recordInfo,
      onTickError: vi.fn(),
    });

    await coordinator.tick(now);
    await coordinator.tick(now + 60_000);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({ cap: "session_limit", source: "safety" }),
    );
    expect(recordInfo).toHaveBeenCalledWith(
      accountId,
      "steam.safety.cap",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("rechecks account state after entering serialized enforcement", async () => {
    const now = Date.now();
    const accountId = crypto.randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `safety-race-${now}`,
      status: "boosting",
      desiredState: "running",
      personaState: 7,
      tokenKeyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(accountSafetyPolicy).values({
      accountId,
      resumePolicy: "automatic",
      resumeDelayMinutes: 15,
      maxSessionMinutes: 5,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(boostSession).values({
      id: crypto.randomUUID(),
      accountId,
      appIdsJson: "[730]",
      startedAt: now - 6 * 60_000,
      createdAt: now - 6 * 60_000,
    });
    let continueEnforcement: (() => void) | undefined;
    const enforcementGate = new Promise<void>((resolve) => {
      continueEnforcement = resolve;
    });
    const pause = vi.fn(async () => undefined);
    const runForAccount = vi.fn(
      async (_accountId: string, operation: () => Promise<unknown>) => {
        await enforcementGate;
        return operation();
      },
    );
    const coordinator = new SafetyCoordinator({
      runForAccount,
      pause,
      recordInfo: vi.fn(async () => undefined),
      onTickError: vi.fn(),
    });

    const tick = coordinator.tick(now);
    await vi.waitFor(() => expect(runForAccount).toHaveBeenCalledTimes(1));
    await db
      .update(steamAccount)
      .set({ status: "disconnected", desiredState: "stopped" })
      .where(eq(steamAccount.id, accountId));
    continueEnforcement?.();
    await tick;

    expect(pause).not.toHaveBeenCalled();
    const policy = await db.query.accountSafetyPolicy.findFirst({
      where: eq(accountSafetyPolicy.accountId, accountId),
    });
    expect(policy?.holdReason).toBeNull();
  });

  it("resets daily limits at UTC midnight even in a non-UTC process timezone", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const now = Date.UTC(2026, 6, 20, 0, 5);
      const accountId = crypto.randomUUID();
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: `safety-daily-utc-${now}`,
        status: "boosting",
        desiredState: "running",
        personaState: 7,
        tokenKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(accountSafetyPolicy).values({
        accountId,
        resumePolicy: "automatic",
        resumeDelayMinutes: 15,
        maxDailyMinutes: 30,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSession).values([
        {
          id: crypto.randomUUID(),
          accountId,
          appIdsJson: "[730]",
          startedAt: Date.UTC(2026, 6, 19, 22, 0),
          endedAt: Date.UTC(2026, 6, 19, 23, 0),
          createdAt: Date.UTC(2026, 6, 19, 22, 0),
        },
        {
          id: crypto.randomUUID(),
          accountId,
          appIdsJson: "[730]",
          startedAt: Date.UTC(2026, 6, 20, 0, 1),
          createdAt: Date.UTC(2026, 6, 20, 0, 1),
        },
      ]);
      const pause = vi.fn(async () => undefined);
      const coordinator = new SafetyCoordinator({
        runForAccount: async (_accountId, operation) => operation(),
        pause,
        recordInfo: vi.fn(async () => undefined),
        onTickError: vi.fn(),
      });

      await coordinator.tick(now);

      expect(pause).not.toHaveBeenCalled();
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("resets weekly limits at UTC Monday even in a non-UTC process timezone", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const now = Date.UTC(2026, 6, 20, 0, 5);
      const accountId = crypto.randomUUID();
      await db.insert(steamAccount).values({
        id: accountId,
        accountName: `safety-weekly-utc-${now}`,
        status: "boosting",
        desiredState: "running",
        personaState: 7,
        tokenKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(accountSafetyPolicy).values({
        accountId,
        resumePolicy: "automatic",
        resumeDelayMinutes: 15,
        maxWeeklyMinutes: 30,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(boostSession).values([
        {
          id: crypto.randomUUID(),
          accountId,
          appIdsJson: "[730]",
          startedAt: Date.UTC(2026, 6, 19, 22, 0),
          endedAt: Date.UTC(2026, 6, 19, 23, 0),
          createdAt: Date.UTC(2026, 6, 19, 22, 0),
        },
        {
          id: crypto.randomUUID(),
          accountId,
          appIdsJson: "[730]",
          startedAt: Date.UTC(2026, 6, 20, 0, 1),
          createdAt: Date.UTC(2026, 6, 20, 0, 1),
        },
      ]);
      const pause = vi.fn(async () => undefined);
      const coordinator = new SafetyCoordinator({
        runForAccount: async (_accountId, operation) => operation(),
        pause,
        recordInfo: vi.fn(async () => undefined),
        onTickError: vi.fn(),
      });

      await coordinator.tick(now);

      expect(pause).not.toHaveBeenCalled();
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
