import { createHash } from "node:crypto";
import {
  ERROR_CODES,
  marketRulesFingerprint,
  type InventoryPriceOverview,
  type InventoryPriceOverviewError,
  type InventoryPriceOverviewRow,
  type MarketPriceSettings,
} from "@steam-bee/contracts";
import { appError } from "../http/errors.js";
import { quoteWithRules, toMinorUnits, type Wallet } from "./money.js";
import { MarketPriceReader, PriceReadError } from "./price-reader.js";

export type PriceVariant = {
  variantId: string;
  marketHashName: string | null;
  publisherFee: unknown;
  marketable: boolean;
};
type Context = {
  fetchedAt: number;
  expiresAt: number;
  variants: Map<string, PriceVariant>;
  tooLarge: boolean;
};
type Dependencies = {
  request: (accountId: string, path: string) => Promise<Response>;
  settings: (accountId: string) => Promise<MarketPriceSettings>;
  now?: () => number;
};

export const priceContextTtl = 5 * 60_000;
export const maxPriceContextAccounts = 8;
// At least the complete supported 40,000-asset inventory must fit on its own.
export const maxPriceContextVariants = 50_000;
export const inventoryVariantIdPattern =
  /^753:6:[1-9]\d{0,24}:(?:0|[1-9]\d{0,24})$/;

function unavailable(
  variantId: string,
  error: InventoryPriceOverviewError,
): InventoryPriceOverviewRow {
  return {
    variantId,
    rawReferenceBuyerPrice: null,
    estimate: null,
    observedAt: null,
    freshUntil: null,
    displayUntil: null,
    stale: false,
    error,
    retryAt: null,
  };
}
function displayError(error: unknown): InventoryPriceOverviewError {
  if (error instanceof PriceReadError) return error.code;
  const reason = (error as { displayReason?: unknown } | null)?.displayReason;
  if (
    reason === "CURRENCY_MISMATCH" ||
    reason === "OUTSIDE_PRICE_LIMITS" ||
    reason === "BELOW_MINIMUM_FEES"
  )
    return reason;
  return "UNSUPPORTED_PRICE";
}
function fingerprintWallet(wallet: Wallet) {
  return createHash("sha256")
    .update(
      JSON.stringify(wallet, (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    )
    .digest("hex");
}

/** Display-only metadata and quotes. No intents, asset reservations, listings or jobs. */
export class InventoryPriceOverviewService {
  private readonly contexts = new Map<string, Context>();
  private readonly epochs = new Map<string, number>();
  private epoch = 0;
  private readonly now: () => number;
  private readonly reader: MarketPriceReader;

  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
    this.reader = new MarketPriceReader({
      request: dependencies.request,
      now: this.now,
    });
  }

  seed(accountId: string, items: readonly PriceVariant[], fetchedAt: number) {
    this.prune();
    const variants = new Map(
      items.map((item) => [
        item.variantId,
        {
          variantId: item.variantId,
          marketHashName: item.marketHashName,
          marketable: item.marketable,
          publisherFee: item.publisherFee,
        },
      ]),
    );
    this.contexts.delete(accountId);
    const tooLarge = variants.size > maxPriceContextVariants;
    const context = {
      fetchedAt,
      expiresAt: this.now() + priceContextTtl,
      variants: tooLarge ? new Map<string, PriceVariant>() : variants,
      tooLarge,
    };
    while (
      this.contexts.size >= maxPriceContextAccounts ||
      [...this.contexts.values()].reduce(
        (sum, entry) => sum + entry.variants.size,
        0,
      ) +
        context.variants.size >
        maxPriceContextVariants
    ) {
      const oldest = this.contexts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.contexts.delete(oldest);
    }
    this.contexts.set(accountId, context);
  }
  private prune() {
    for (const [accountId, context] of this.contexts)
      if (context.expiresAt <= this.now()) this.contexts.delete(accountId);
  }
  private contextExpired(): never {
    throw appError(
      "Inventory price context expired. Refresh the inventory before loading prices.",
      409,
      ERROR_CODES.inventoryPriceContextExpired,
    );
  }

  async read(
    accountId: string,
    variantIds: string[],
  ): Promise<InventoryPriceOverview> {
    if (
      !variantIds.length ||
      variantIds.length > 10 ||
      new Set(variantIds).size !== variantIds.length ||
      variantIds.some((id) => !inventoryVariantIdPattern.test(id))
    )
      throw appError(
        "Choose between one and ten distinct inventory variants.",
        400,
        ERROR_CODES.validation,
      );
    this.prune();
    const context = this.contexts.get(accountId);
    if (!context) this.contextExpired();
    if (context.tooLarge)
      throw appError(
        "This inventory exceeds the price overview context limit.",
        409,
        ERROR_CODES.inventoryPriceContextTooLarge,
      );
    this.contexts.delete(accountId);
    this.contexts.set(accountId, context);
    const accountEpoch = this.epochs.get(accountId) ?? 0;
    const epoch = this.epoch;
    const assertCurrent = () => {
      if (
        (this.epochs.get(accountId) ?? 0) !== accountEpoch ||
        epoch !== this.epoch
      )
        this.contextExpired();
    };
    const eligible = variantIds.filter((id) => {
      const variant = context.variants.get(id);
      return variant?.marketable && variant.marketHashName;
    });
    let wallet: Wallet | null = null;
    let walletError: unknown;
    if (eligible.length) {
      try {
        wallet = await this.reader.wallet(accountId);
      } catch (error) {
        walletError = error;
      }
    }
    assertCurrent();
    const observations = new Map<
      string,
      Awaited<ReturnType<MarketPriceReader["observation"]>> | Error
    >();
    if (wallet) {
      const currentWallet = wallet;
      await Promise.all(
        eligible.map(async (id) => {
          const variant = context.variants.get(id)!;
          try {
            observations.set(
              id,
              await this.reader.observation(
                accountId,
                variant.marketHashName!,
                currentWallet,
              ),
            );
          } catch (error) {
            observations.set(
              id,
              error instanceof Error
                ? error
                : new PriceReadError("STEAM_UNAVAILABLE", null),
            );
          }
        }),
      );
    }
    assertCurrent();
    // Read after network work so a rules save during loading is reflected in every row.
    const settings = await this.dependencies.settings(accountId);
    assertCurrent();
    const rows = variantIds.map((variantId) => {
      const variant = context.variants.get(variantId);
      if (!variant) return unavailable(variantId, "UNKNOWN_VARIANT");
      if (!variant.marketable || !variant.marketHashName)
        return unavailable(variantId, "NOT_MARKETABLE");
      if (!wallet) {
        const row = unavailable(
          variantId,
          walletError instanceof PriceReadError
            ? walletError.code
            : "STEAM_UNAVAILABLE",
        );
        row.retryAt =
          walletError instanceof PriceReadError ? walletError.retryAt : null;
        return row;
      }
      const observation = observations.get(variantId);
      if (!observation || observation instanceof Error) {
        const row = unavailable(variantId, displayError(observation));
        row.retryAt =
          observation instanceof PriceReadError ? observation.retryAt : null;
        return row;
      }
      const row: InventoryPriceOverviewRow = {
        ...unavailable(variantId, "NO_ORDERS"),
        observedAt: observation.observedAt,
        freshUntil: observation.freshUntil,
        displayUntil: observation.displayUntil,
        stale: observation.stale,
        error: observation.error,
        retryAt: observation.retryAt,
      };
      const reference = observation[settings.priceMode];
      if (reference === null || reference < 1) {
        row.error = "NO_ORDERS";
        return row;
      }
      try {
        row.rawReferenceBuyerPrice = toMinorUnits(reference, wallet.currency);
      } catch {
        row.error = "UNSUPPORTED_PRICE";
        return row;
      }
      try {
        const quote = quoteWithRules(
          reference,
          wallet,
          variant.publisherFee,
          settings,
        );
        row.estimate = {
          buyerPaysPerItem: toMinorUnits(quote.buyerPays, wallet.currency),
          sellerReceivesPerItem: toMinorUnits(quote.base, wallet.currency),
        };
      } catch (error) {
        row.error = displayError(error);
      }
      return row;
    });
    return {
      accountId,
      inventoryFetchedAt: context.fetchedAt,
      currency: wallet?.currency ?? null,
      priceMode: settings.priceMode,
      rulesFingerprint: marketRulesFingerprint(settings),
      walletFingerprint: wallet ? fingerprintWallet(wallet) : null,
      rows,
    };
  }
  clearAccount(accountId: string) {
    this.epochs.set(accountId, (this.epochs.get(accountId) ?? 0) + 1);
    this.contexts.delete(accountId);
    this.reader.clearAccount(accountId);
  }
  shutdown() {
    this.epoch++;
    this.contexts.clear();
    this.reader.shutdown();
  }
}
