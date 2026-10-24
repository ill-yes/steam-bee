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
