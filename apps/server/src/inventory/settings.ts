import {
  DEFAULT_MARKET_PRICE_SETTINGS,
  type MarketPriceSettings,
} from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { accountMarketPriceSettings } from "../db/schema.js";
import { appError } from "../http/errors.js";
import { getAccountOrThrow } from "../steam/account-repository.js";

const amount = z.number().int().min(0).max(1_000_000_000);
export const settingsSchema = z
  .object({
    priceMode: z.enum(["lowestSellOrder", "highestBuyOrder"]),
    adjustment: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    minBuyerPrice: amount.nullable(),
    maxBuyerPrice: amount.nullable(),
    delaySeconds: z.number().int().min(1).max(60),
    currencyId: z.number().int().min(1).max(1000).nullable(),
  })
  .strict()
  .superRefine((settings, context) => {
    if (
      settings.minBuyerPrice !== null &&
      settings.maxBuyerPrice !== null &&
      settings.minBuyerPrice > settings.maxBuyerPrice
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxBuyerPrice"],
        message:
          "The maximum buyer price must be at least the minimum buyer price.",
      });
    }
    if (
      (settings.adjustment !== 0 ||
        settings.minBuyerPrice !== null ||
        settings.maxBuyerPrice !== null) &&
      settings.currencyId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["currencyId"],
        message: "Custom market prices require a wallet currency.",
      });
    }
  });

export async function readMarketPriceSettings(
  accountId: string,
): Promise<MarketPriceSettings> {
  z.string().uuid().parse(accountId);
  await getAccountOrThrow(accountId);
  try {
    const [stored] = await db
      .select()
      .from(accountMarketPriceSettings)
      .where(eq(accountMarketPriceSettings.accountId, accountId));
    return stored
      ? settingsSchema.parse(JSON.parse(stored.settingsJson))
      : structuredClone(DEFAULT_MARKET_PRICE_SETTINGS);
  } catch {
    // Preserve malformed settings so that a read never silently changes sale rules.
    throw appError("Market price settings could not be read.", 500);
  }
}

/** Wallet-specific validation is performed by the service before this write. */
export async function writeMarketPriceSettings(
  accountId: string,
  input: MarketPriceSettings,
): Promise<MarketPriceSettings> {
  z.string().uuid().parse(accountId);
  const settings = settingsSchema.parse(input);
  await getAccountOrThrow(accountId);
  try {
    await db
      .insert(accountMarketPriceSettings)
      .values({
        accountId,
        settingsJson: JSON.stringify(settings),
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: accountMarketPriceSettings.accountId,
        set: { settingsJson: JSON.stringify(settings), updatedAt: Date.now() },
      });
  } catch {
    throw appError("Market price settings could not be saved.", 500);
  }
  return settings;
}
