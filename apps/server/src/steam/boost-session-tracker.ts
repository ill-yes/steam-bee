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
import { parseIntegerArray } from "../util/json.js";

export type BoostActivitySnapshot = {
  activityMode?: "idle" | "manual" | "farming";
  activeAppIds?: number[];
};

export async function trackBoostSession(
  accountId: string,
  status: AccountStatus,
  activity?: BoostActivitySnapshot,
) {
  if (status === "boosting" && activity?.activityMode !== "idle") {
    await startBoostSession(accountId, activity);
    return;
  }
  await endBoostSession(
    accountId,
    activity?.activityMode === "idle" && status === "boosting"
      ? "idle"
      : status,
  );
}

async function startBoostSession(
  accountId: string,
  activity?: BoostActivitySnapshot,
) {
  const existing = await db
    .select({
      id: boostSession.id,
      presetId: boostSession.presetId,
      appIdsJson: boostSession.appIdsJson,
    })
    .from(boostSession)
    .where(
      and(eq(boostSession.accountId, accountId), isNull(boostSession.endedAt)),
    );

  const [account] = await db
    .select({ activePresetId: steamAccount.activePresetId })
    .from(steamAccount)
    .where(eq(steamAccount.id, accountId))
    .limit(1);
  if (!account) return;

  // A farming payload is independent of the saved manual selection/preset.
  // Never attribute its time to that selection while processing a queued status.
  let activePresetId =
    activity?.activityMode === "farming" ? null : account.activePresetId;
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

  let appIds: number[];
  if (activity?.activeAppIds !== undefined) {
    appIds = normalizeAppIds(activity.activeAppIds);
  } else if (activity?.activityMode === "farming") {
    // Missing reported IDs must not fall back to unrelated manual configuration.
    appIds = [];
  } else {
    const games = await db
      .select({
        appId: steamAccountGame.appId,
        enabled: steamAccountGame.enabled,
      })
      .from(steamAccountGame)
      .where(eq(steamAccountGame.accountId, accountId));
    appIds = normalizeAppIds(
      games.filter((game) => game.enabled).map((game) => game.appId),
    );
  }
  const open = existing[0];
  if (
    existing.length === 1 &&
    open?.presetId === activePresetId &&
    JSON.stringify(normalizeAppIds(parseIntegerArray(open.appIdsJson))) ===
      JSON.stringify(appIds)
  )
    return;
  const startedAt = Date.now();
  if (existing.length > 0)
    await endBoostSession(accountId, "selection_changed", startedAt);
  await db.insert(boostSession).values({
    id: randomUUID(),
    accountId,
    presetId: activePresetId,
    appIdsJson: JSON.stringify(appIds),
    startedAt,
    endedAt: null,
    stopReason: null,
    lastSeenAt: startedAt,
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

// Open sessions are stamped while the server runs so a crash can be told apart
// from boosting: on the next start they end at the last stamp, not at "now".
export async function markOpenBoostSessionsSeen(seenAt = Date.now()) {
  await db
    .update(boostSession)
    .set({ lastSeenAt: seenAt })
    .where(isNull(boostSession.endedAt));
}

export async function closeInterruptedBoostSessions() {
  const openSessions = await db
    .select({
      id: boostSession.id,
      accountId: boostSession.accountId,
      startedAt: boostSession.startedAt,
      lastSeenAt: boostSession.lastSeenAt,
    })
    .from(boostSession)
    .where(isNull(boostSession.endedAt));
  const accounts = new Map<string, number>();
  for (const session of openSessions) {
    await db
      .update(boostSession)
      .set({
        endedAt: Math.max(
          session.startedAt,
          session.lastSeenAt ?? session.startedAt,
        ),
        stopReason: "interrupted",
      })
      .where(eq(boostSession.id, session.id));
    accounts.set(session.accountId, (accounts.get(session.accountId) ?? 0) + 1);
  }
  for (const [accountId, sessionCount] of accounts) {
    await recordInfoEventSafely({
      accountId,
      type: "steam.boost.session.end",
      message: "Boost session ended by an unexpected server stop.",
      metadata: { reason: "interrupted", sessionCount },
    });
  }
  return openSessions.length;
}

async function endBoostSession(
  accountId: string,
  reason: AccountStatus | "selection_changed" | "idle",
  endedAt = Date.now(),
) {
  const openSessions = await db
    .select({ id: boostSession.id })
    .from(boostSession)
    .where(
      and(eq(boostSession.accountId, accountId), isNull(boostSession.endedAt)),
    );
  if (openSessions.length === 0) return;

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

function normalizeAppIds(appIds: number[]) {
  return [...new Set(appIds)].sort((left, right) => left - right);
}
