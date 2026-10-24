import {
  DEFAULT_FARMING_CONFIG,
  type FarmingConfig,
} from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  accountFarmingConfig,
  steamAccountLibrary,
  steamAppCache,
} from "../db/schema.js";
import { appError } from "../http/errors.js";
import { communityRequest } from "../steam/community.js";
import { steamManager } from "../steam/manager.js";
import { appIdSchema } from "../steam/validation.js";
import {
  discoverBadgeDrops,
  enrichBadgeGames,
  MAX_BADGE_PAGE_BYTES,
} from "./badges.js";
import { FarmingController } from "./controller.js";

export const farmingConfigSchema = z
  .object({
    maxConcurrentGames: z.number().int().min(1).max(32),
    skipRefundable: z.boolean(),
    whitelist: z
      .array(appIdSchema)
      .max(500)
      .transform((ids) => [...new Set(ids)]),
    blacklist: z
      .array(appIdSchema)
      .max(500)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

export async function readFarmingConfig(
  accountId: string,
): Promise<FarmingConfig> {
  z.string().uuid().parse(accountId);
  try {
    const [stored] = await db
      .select()
      .from(accountFarmingConfig)
      .where(eq(accountFarmingConfig.accountId, accountId));
    return stored
      ? farmingConfigSchema.parse(JSON.parse(stored.configJson))
      : structuredClone(DEFAULT_FARMING_CONFIG);
  } catch {
    throw appError("Card farming settings could not be read.", 500);
  }
}

export async function saveFarmingConfig(
  accountId: string,
  input: FarmingConfig,
) {
  z.string().uuid().parse(accountId);
  const settings = farmingConfigSchema.parse(input);
  await db
    .insert(accountFarmingConfig)
    .values({
      accountId,
      configJson: JSON.stringify(settings),
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: accountFarmingConfig.accountId,
      set: { configJson: JSON.stringify(settings), updatedAt: Date.now() },
    });
  return settings;
}

export const farmingController = new FarmingController({
  availability: (accountId) => steamManager.getFarmingAvailability(accountId),
  begin: (accountId, shouldApply) =>
    steamManager.beginFarming(accountId, shouldApply),
  apply: (accountId, appIds, shouldApply) =>
    steamManager.applyFarmingGames(accountId, appIds, shouldApply),
  end: (accountId, shouldEnd) => steamManager.endFarming(accountId, shouldEnd),
  discover: async (accountId, shouldContinue) => {
    if (shouldContinue && !shouldContinue())
      throw new Error("Badge scan cancelled.");
    const { steamId } = await steamManager.getCommunitySession(accountId);
    if (!/^\d{17}$/.test(steamId))
      throw appError("A Steam profile is required for badge lookup.", 409);
    const discovery = await discoverBadgeDrops(async (page) => {
      if (shouldContinue && !shouldContinue())
        throw new Error("Badge scan cancelled.");
      const response = await communityRequest(
        accountId,
        `/profiles/${steamId}/badges/?l=english&p=${page}`,
      );
      if (!response.ok) throw appError("Steam badge lookup failed.", 502);
      return readBadgeResponse(response);
    });
    const library = await db
      .select({
        appId: steamAccountLibrary.appId,
        name: steamAppCache.name,
        playtimeMinutes: steamAccountLibrary.playtimeForever,
      })
      .from(steamAccountLibrary)
      .innerJoin(
        steamAppCache,
        eq(steamAppCache.appId, steamAccountLibrary.appId),
      )
      .where(eq(steamAccountLibrary.accountId, accountId));
    enrichBadgeGames(discovery.games, library);
    return discovery;
  },
});

async function readBadgeResponse(response: Response) {
  if (!response.body)
    throw appError("Steam returned an empty badge page.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BADGE_PAGE_BYTES) {
        await reader.cancel();
        throw appError("Steam returned an oversized badge page.", 502);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
