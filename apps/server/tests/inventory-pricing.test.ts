import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_MARKET_PRICE_SETTINGS,
  type MarketPriceSettings,
} from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, migrate, sqlite } from "../src/db/client.js";
import { accountMarketPriceSettings, steamAccount } from "../src/db/schema.js";
import {
  fromMinorUnits,
  parseWallet,
  quoteFromBuyerCap,
  quoteWithRules,
  toMinorUnits,
  validatePriceSettings,
} from "../src/inventory/money.js";
import {
  readMarketPriceSettings,
  settingsSchema,
  writeMarketPriceSettings,
} from "../src/inventory/settings.js";

function walletData(overrides: Record<string, unknown> = {}) {
  return {
    wallet_currency: 1,
    wallet_country: "US",
    wallet_fee: 1,
    wallet_fee_percent: "0.05",
    wallet_fee_minimum: 1,
    wallet_fee_base: 0,
    wallet_publisher_fee_percent_default: "0.10",
    ...overrides,
  };
}
const rules = (
  patch: Partial<MarketPriceSettings> = {},
): MarketPriceSettings => ({
  ...DEFAULT_MARKET_PRICE_SETTINGS,
  ...patch,
});

describe("exact market price rules", () => {
  const dollars = parseWallet(walletData());
  const yen = parseWallet(
    walletData({
      wallet_currency: 8,
      wallet_country: "JP",
      wallet_market_minimum: 100,
      wallet_currency_increment: 100,
    }),
  );
  const dinars = parseWallet(
    walletData({ wallet_currency: 38, wallet_country: "KW" }),
  );

  it.each([
    [dollars, 115, 115],
    [yen, 11500, 115],
    [dinars, 115, 1150],
    [dollars, -1, -1],
    [yen, -100, -1],
    [dinars, -1, -10],
  ])(
    "round-trips signed Steam and ISO minor units exactly %#",
    (wallet, steamAmount, amount) => {
      expect(toMinorUnits(steamAmount, wallet.currency)).toBe(amount);
      expect(fromMinorUnits(amount, wallet.currency)).toBe(steamAmount);
    },
  );

  it("rejects sub-Steam precision and unsafe or fractional money instead of rounding it", () => {
    expect(() => fromMinorUnits(1, dinars.currency)).toThrow(/exactly/);
    expect(() => fromMinorUnits(-1, dinars.currency)).toThrow(/exactly/);
    expect(() => toMinorUnits(1, yen.currency)).toThrow(/precision/);
    for (const amount of [
      Number.NaN,
      Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => fromMinorUnits(amount, dollars.currency)).toThrow(/integer/);
      expect(() => toMinorUnits(amount, dollars.currency)).toThrow(/integer/);
    }
    expect(() => fromMinorUnits(Number.MAX_SAFE_INTEGER, yen.currency)).toThrow(
      /limit/,
    );
    expect(() =>
      toMinorUnits(Number.MAX_SAFE_INTEGER, dinars.currency),
    ).toThrow(/limit/);
  });

  it("preserves existing fee quotes with default settings and records the adjusted cap", () => {
    expect(quoteWithRules(115, dollars, "0.10", rules())).toEqual({
      ...quoteFromBuyerCap(115, dollars, "0.10"),
      buyerCap: 115,
    });
    expect(
      quoteWithRules(
        115,
        dollars,
        "0.10",
        rules({ adjustment: 1, currencyId: 1 }),
      ),
    ).toEqual({
      base: 101,
      steamFee: 5,
      publisherFee: 10,
      buyerPays: 116,
      buyerCap: 116,
    });
    expect(
      quoteWithRules(
        115,
        dollars,
        "0.10",
        rules({ adjustment: -1, currencyId: 1 }),
      ),
    ).toEqual({
      base: 99,
      steamFee: 4,
      publisherFee: 9,
      buyerPays: 112,
      buyerCap: 114,
    });
  });

  it("uses ISO currency minor units for zero- and three-decimal adjustments", () => {
    const quoteYen = quoteWithRules(
      11500,
      yen,
      "0.10",
      rules({
        adjustment: -1,
        minBuyerPrice: 114,
        maxBuyerPrice: 114,
        currencyId: 8,
      }),
    );
    expect(quoteYen.buyerCap).toBe(11400);
    expect(toMinorUnits(quoteYen.buyerPays, yen.currency)).toBe(114);
    const quoteDinars = quoteWithRules(
      115,
      dinars,
      "0.10",
      rules({ adjustment: 10, currencyId: 38 }),
    );
    expect(quoteDinars.buyerCap).toBe(116);
    expect(toMinorUnits(quoteDinars.buyerPays, dinars.currency)).toBe(1160);
    expect(() =>
      validatePriceSettings(dinars, rules({ adjustment: 1, currencyId: 38 })),
    ).toThrow(/exactly/);
  });

  it("requires a matching currency binding for customized money", () => {
    expect(() => validatePriceSettings(dollars, rules())).not.toThrow();
    expect(() =>
      validatePriceSettings(dollars, rules({ priceMode: "highestBuyOrder" })),
    ).not.toThrow();
    expect(() =>
      validatePriceSettings(dollars, rules({ adjustment: -1 })),
    ).toThrow(/Bind/);
    expect(() =>
      validatePriceSettings(dollars, rules({ minBuyerPrice: 0 })),
    ).toThrow(/Bind/);
    expect(() =>
      validatePriceSettings(
        dollars,
        rules({ currencyId: 3, maxBuyerPrice: 100 }),
      ),
    ).toThrow(/different wallet currency/);
    expect(() =>
      validatePriceSettings(dollars, rules({ currencyId: 1 })),
    ).not.toThrow();
  });

  it("rejects adjustments, limits, and reference prices outside the wallet price grid", () => {
    const grid = parseWallet(
      walletData({ wallet_market_minimum: 5, wallet_currency_increment: 5 }),
    );
    for (const patch of [
      { adjustment: -1 },
      { minBuyerPrice: 101 },
      { maxBuyerPrice: 114 },
    ])
      expect(() =>
        validatePriceSettings(grid, rules({ ...patch, currencyId: 1 })),
      ).toThrow(/increments/);
    expect(() => quoteWithRules(114, grid, "0.10", rules())).toThrow(
      /reference/,
    );
    expect(() =>
      quoteWithRules(
        115,
        grid,
        "0.10",
        rules({ adjustment: -5, currencyId: 1 }),
      ),
    ).not.toThrow();
  });

  it("rejects out-of-range prices without clamping them to the user's limits", () => {
    expect(() =>
      quoteWithRules(
        115,
        dollars,
        "0.10",
        rules({ minBuyerPrice: 116, currencyId: 1 }),
      ),
    ).toThrow(/outside your saved price limits/);
    expect(() =>
      quoteWithRules(
        115,
        dollars,
        "0.10",
        rules({ maxBuyerPrice: 114, currencyId: 1 }),
      ),
    ).toThrow(/outside your saved price limits/);
    expect(() =>
      quoteWithRules(
        115,
        dollars,
        "0.10",
        rules({ adjustment: -115, currencyId: 1 }),
      ),
    ).toThrow(/outside the supported range/);
    expect(() =>
      quoteWithRules(
        115,
        dollars,
        "0.10",
        rules({ adjustment: 1_000_000_000, currencyId: 1 }),
      ),
    ).toThrow(/outside the supported range/);
    expect(() => quoteWithRules(2, dollars, "0.10", rules())).toThrow(
      /minimum fees/,
    );
  });

  it("checks the accepted price again after fee rounding creates a gap below the target", () => {
    expect(quoteFromBuyerCap(114, dollars, "0.10").buyerPays).toBe(112);
    expect(() =>
      quoteWithRules(
        114,
        dollars,
        "0.10",
        rules({ minBuyerPrice: 113, currencyId: 1 }),
      ),
    ).toThrow(/outside your saved price limits/);
    expect(
      quoteWithRules(
        115,
        dollars,
        "0.10",
        rules({ minBuyerPrice: 115, maxBuyerPrice: 115, currencyId: 1 }),
      ).buyerPays,
    ).toBe(115);
  });

  it("respects an item's publisher fee while preserving bounded buyer prices", () => {
    const quote = quoteWithRules(115, dollars, "0", rules());
    expect(quote.publisherFee).toBe(0);
    expect(quote.base).toBe(110);
    expect(quote.buyerPays).toBe(115);
    expect(() => quoteWithRules(115, dollars, "invalid", rules())).toThrow(
      /fee/,
    );
  });
});

describe("market price setting validation", () => {
  it.each([
    { priceMode: "median" },
    { adjustment: "1", currencyId: 1 },
    { adjustment: 0.1, currencyId: 1 },
    { adjustment: -1_000_000_001, currencyId: 1 },
    { adjustment: 1, currencyId: null },
    { minBuyerPrice: -1, currencyId: 1 },
    { maxBuyerPrice: 1_000_000_001, currencyId: 1 },
    { minBuyerPrice: 200, maxBuyerPrice: 100, currencyId: 1 },
    { delaySeconds: 0 },
    { delaySeconds: 61 },
    { delaySeconds: 1.5 },
    { currencyId: 0 },
    { currencyId: 1001 },
  ])("rejects unsafe or ambiguous settings %#", (patch) => {
    expect(
      settingsSchema.safeParse({ ...DEFAULT_MARKET_PRICE_SETTINGS, ...patch })
        .success,
    ).toBe(false);
    expect(() =>
      validatePriceSettings(parseWallet(walletData()), {
        ...DEFAULT_MARKET_PRICE_SETTINGS,
        ...patch,
      } as MarketPriceSettings),
    ).toThrow();
  });

  it("rejects unknown API controls rather than silently accepting an automatic sale option", () => {
    expect(
      settingsSchema.safeParse({
        ...DEFAULT_MARKET_PRICE_SETTINGS,
        autoSell: true,
      }).success,
    ).toBe(false);
  });
});

describe("persisted market price rules", () => {
  let accountId: string;
  beforeEach(async () => {
    migrate();
    accountId = randomUUID();
    await db.insert(steamAccount).values({
      id: accountId,
      accountName: `prices-${accountId}`,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  afterEach(async () => {
    await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
  });

  it("returns independent defaults without writing or changing any existing account state", async () => {
    const original = await db
      .select()
      .from(steamAccount)
      .where(eq(steamAccount.id, accountId));
    const initial = await readMarketPriceSettings(accountId);
    expect(initial).toEqual(DEFAULT_MARKET_PRICE_SETTINGS);
    initial.delaySeconds = 60;
    expect((await readMarketPriceSettings(accountId)).delaySeconds).toBe(10);
    expect(await db.select().from(accountMarketPriceSettings)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(steamAccount)
        .where(eq(steamAccount.id, accountId)),
    ).toEqual(original);
  });

  it("upserts account-scoped validated rules and preserves them in a SQLite backup", async () => {
    const saved = rules({
      priceMode: "highestBuyOrder",
      adjustment: -1,
      minBuyerPrice: 3,
      maxBuyerPrice: 10_000,
      delaySeconds: 15,
      currencyId: 1,
    });
    expect(await writeMarketPriceSettings(accountId, saved)).toEqual(saved);
    expect(await readMarketPriceSettings(accountId)).toEqual(saved);
    const changed = { ...saved, delaySeconds: 20 };
    await writeMarketPriceSettings(accountId, changed);
    expect(
      await db
        .select()
        .from(accountMarketPriceSettings)
        .where(eq(accountMarketPriceSettings.accountId, accountId)),
    ).toHaveLength(1);

    const directory = mkdtempSync(join(tmpdir(), "steam-bee-price-backup-"));
    const snapshotPath = join(directory, "snapshot.sqlite");
    let snapshot: Database.Database | undefined;
    try {
      await sqlite.backup(snapshotPath);
      snapshot = new Database(snapshotPath, { readonly: true });
      const row = snapshot
        .prepare(
          "SELECT settings_json FROM account_market_price_settings WHERE account_id = ?",
        )
        .get(accountId) as { settings_json: string };
      expect(JSON.parse(row.settings_json)).toEqual(changed);
    } finally {
      snapshot?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps malformed stored rules intact and rejects reads instead of reverting to a default sale policy", async () => {
    await writeMarketPriceSettings(accountId, rules());
    sqlite
      .prepare(
        "UPDATE account_market_price_settings SET settings_json = ? WHERE account_id = ?",
      )
      .run("invalid-json", accountId);
    await expect(readMarketPriceSettings(accountId)).rejects.toThrow(
      /could not be read/,
    );
    expect(
      (
        await db
          .select()
          .from(accountMarketPriceSettings)
          .where(eq(accountMarketPriceSettings.accountId, accountId))
      )[0]?.settingsJson,
    ).toBe("invalid-json");
    sqlite
      .prepare(
        "UPDATE account_market_price_settings SET settings_json = ? WHERE account_id = ?",
      )
      .run(
        JSON.stringify({ ...DEFAULT_MARKET_PRICE_SETTINGS, delaySeconds: 0 }),
        accountId,
      );
    await expect(readMarketPriceSettings(accountId)).rejects.toThrow(
      /could not be read/,
    );
  });

  it("cascades settings on account deletion and never creates rules for a missing account", async () => {
    await writeMarketPriceSettings(accountId, rules());
    await db.delete(steamAccount).where(eq(steamAccount.id, accountId));
    expect(
      await db
        .select()
        .from(accountMarketPriceSettings)
        .where(eq(accountMarketPriceSettings.accountId, accountId)),
    ).toHaveLength(0);
    await expect(readMarketPriceSettings(accountId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      writeMarketPriceSettings(accountId, rules()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
