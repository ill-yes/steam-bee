import { randomUUID } from "node:crypto";
import type { AccountStatus } from "@steam-bee/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  boostPreset,
  boostSession,
  steamAccount,
  steamAccountGame,
} from "../db/schema.js";
import { recordInfoEventSafely } from "../http/events.js";

export async function trackBoostSession(
  accountId: string,
  status: AccountStatus,
) {
  if (status === "boosting") {
    await startBoostSession(accountId);
    return;
  }
  await endBoostSession(accountId, status);
}

async function startBoostSession(accountId: string) {
  const existing = await db
    .select({ id: boostSession.id })
    .from(boostSession)
    .where(
      and(eq(boostSession.accountId, accountId), isNull(boostSession.endedAt)),
    )
    .limit(1);
  if (existing.length > 0) return;

  const [account] = await db
    .select({ activePresetId: steamAccount.activePresetId })
    .from(steamAccount)
    .where(eq(steamAccount.id, accountId))
    .limit(1);
  if (!account) return;

  let activePresetId = account.activePresetId;
  if (activePresetId) {
    const activePreset = await db.query.boostPreset.findFirst({
      where: and(
        eq(boostPreset.id, activePresetId),
        eq(boostPreset.accountId, accountId),
      ),
    });
    if (!activePreset) {
      activePresetId = null;
      await db
        .update(steamAccount)
        .set({ activePresetId: null, updatedAt: Date.now() })
        .where(eq(steamAccount.id, accountId));
    }
  }

  const games = await db
    .select({
      appId: steamAccountGame.appId,
      enabled: steamAccountGame.enabled,
    })
    .from(steamAccountGame)
    .where(eq(steamAccountGame.accountId, accountId));
  const appIds = games.filter((game) => game.enabled).map((game) => game.appId);
  const startedAt = Date.now();
  await db.insert(boostSession).values({
    id: randomUUID(),
    accountId,
    presetId: activePresetId,
    appIdsJson: JSON.stringify(appIds),
    startedAt,
    endedAt: null,
    stopReason: null,
    createdAt: startedAt,
  });
  await recordInfoEventSafely({
    accountId,
    type: "steam.boost.session.start",
    message: "Boost session started.",
    metadata: {
      appCount: appIds.length,
      presetId: activePresetId,
    },
  });
}

async function endBoostSession(accountId: string, reason: AccountStatus) {
  const openSessions = await db
    .select({ id: boostSession.id })
    .from(boostSession)
    .where(
      and(eq(boostSession.accountId, accountId), isNull(boostSession.endedAt)),
    );
  if (openSessions.length === 0) return;

  const endedAt = Date.now();
  for (const session of openSessions) {
    await db
      .update(boostSession)
      .set({ endedAt, stopReason: reason })
      .where(eq(boostSession.id, session.id));
  }
  await recordInfoEventSafely({
    accountId,
    type: "steam.boost.session.end",
    message: "Boost session ended.",
    metadata: {
      reason,
      sessionCount: openSessions.length,
    },
  });
}
