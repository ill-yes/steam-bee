import {
  DEFAULT_FARMING_CONFIG,
  FARMING_ORDERS,
  type FarmingConfig,
} from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  accountFarmingConfig,
  accountFarmingResume,
  steamAccountLibrary,
  steamAppCache,
} from "../db/schema.js";
import { appError } from "../http/errors.js";
import { communityRequest } from "../steam/community.js";
import { steamManager } from "../steam/manager.js";
import { appIdSchema } from "../steam/validation.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import {
  discoverBadgeDrops,
  enrichBadgeGames,
  MAX_BADGE_PAGE_BYTES,
} from "./badges.js";
import {
  cardSearchPath,
  readCardValueResponse,
  type CardValue,
} from "./card-values.js";
import { FarmingController } from "./controller.js";

const CARD_VALUE_GAP_MS = 1_500;

const logger = createLogger("farming");

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
    // Settings saved before this option existed resume by default.
    autoResume: z.boolean().default(true),
    order: z.enum(FARMING_ORDERS).default("default"),
    priority: z
      .array(appIdSchema)
      .max(500)
      .default([])
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
  remember: (accountId, resume) => {
    try {
      if (resume)
        db.insert(accountFarmingResume)
          .values({ accountId, requestedAt: Date.now() })
          .onConflictDoUpdate({
            target: accountFarmingResume.accountId,
            set: { requestedAt: Date.now() },
          })
          .run();
      else
        db.delete(accountFarmingResume)
          .where(eq(accountFarmingResume.accountId, accountId))
          .run();
    } catch (error) {
      logger.warn(
        errorLogFields(error, { accountId }),
        "Card farming resume state could not be saved",
      );
    }
  },
  cardValues: async (accountId, appIds, shouldContinue) => {
    const values = new Map<number, CardValue | null>();
    // One market search per game, spaced out, at most 60 games per pass.
    for (const [index, appId] of appIds.slice(0, 60).entries()) {
      if (!shouldContinue()) break;
      if (index > 0)
        await new Promise((resolve) => setTimeout(resolve, CARD_VALUE_GAP_MS));
      let response: Response;
      try {
        response = await communityRequest(accountId, cardSearchPath(appId));
      } catch (error) {
        // Keep the prices read so far; the next pass retries the rest.
        logger.warn(
          errorLogFields(error, { accountId }),
          "Card prices unavailable",
        );
        break;
      }
      if (response.status === 429 || response.status >= 500) break;
      values.set(appId, await readCardValueResponse(response));
    }
    return values;
  },
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
    try {
      const acquired = await steamManager.getAcquisitionTimes(
        accountId,
        discovery.games.map((game) => game.appId),
      );
      for (const game of discovery.games)
        game.acquiredAt = acquired.get(game.appId) ?? null;
    } catch (error) {
      // Unknown dates keep the refund guard conservative.
      logger.warn(errorLogFields(error), "Steam license dates unavailable");
    }
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

/** Synchronous for shutdown: whether this account's farming will resume. */
export function farmingResumesAfterRestart(accountId: string) {
  try {
    const pending = db
      .select()
      .from(accountFarmingResume)
      .where(eq(accountFarmingResume.accountId, accountId))
      .get();
    if (!pending) return false;
    const stored = db
      .select()
      .from(accountFarmingConfig)
      .where(eq(accountFarmingConfig.accountId, accountId))
      .get();
    return stored
      ? farmingConfigSchema.parse(JSON.parse(stored.configJson)).autoResume
      : DEFAULT_FARMING_CONFIG.autoResume;
  } catch {
    return false;
  }
}

/** Restart farming that a restart or a brief Steam disconnect interrupted. */
export async function resumeInterruptedFarming(accountId: string) {
  const [pending] = await db
    .select()
    .from(accountFarmingResume)
    .where(eq(accountFarmingResume.accountId, accountId));
  if (!pending) return;
  const config = await readFarmingConfig(accountId);
  if (!config.autoResume) return;
  const phase = farmingController.snapshot(accountId).phase;
  if (["scanning", "warming", "farming"].includes(phase)) return;
  if (!(await steamManager.getFarmingAvailability(accountId)).allowed) return;
  logger.info({ accountId }, "Resuming interrupted card farming");
  await farmingController.start(accountId, config, undefined, true);
}
