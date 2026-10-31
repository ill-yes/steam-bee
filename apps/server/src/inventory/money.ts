import type { MarketCurrency, MarketPriceSettings } from "@steam-bee/contracts";
import { appError } from "../http/errors.js";

type Rate = { numerator: bigint; denominator: bigint };
export type Wallet = {
  currency: MarketCurrency;
  country: string;
  minimum: number;
  increment: number;
  steamRate: Rate;
  publisherRate: Rate;
  steamBase: number;
};
const currencyCodes: Record<number, string> = {
  1: "USD",
  2: "GBP",
  3: "EUR",
  4: "CHF",
  5: "RUB",
  6: "PLN",
  7: "BRL",
  8: "JPY",
  9: "NOK",
  10: "IDR",
  11: "MYR",
  12: "PHP",
  13: "SGD",
  14: "THB",
  15: "VND",
  16: "KRW",
  17: "TRY",
  18: "UAH",
  19: "MXN",
  20: "CAD",
  21: "AUD",
  22: "NZD",
  23: "CNY",
  24: "INR",
  25: "CLP",
  26: "PEN",
  27: "COP",
  28: "ZAR",
  29: "HKD",
  30: "TWD",
  31: "SAR",
  32: "AED",
  33: "SEK",
  34: "ARS",
  35: "ILS",
  36: "BYN",
  37: "KZT",
  38: "KWD",
  39: "QAR",
  40: "CRC",
  41: "UYU",
  42: "BGN",
};
export function parseRate(value: unknown): Rate {
  const raw = String(value);
  if (!/^(?:0|1)(?:\.\d{1,8})?$/.test(raw))
    throw appError("Steam returned an unsupported market fee.", 502);
  const [whole, fraction = ""] = raw.split(".");
  const numerator = BigInt(whole! + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  if (numerator > denominator)
    throw appError("Steam returned an unsupported market fee.", 502);
  return { numerator, denominator };
}
export function integer(value: unknown, max = 1_000_000_000): number {
  if (!/^\d+$/.test(String(value)))
    throw appError("Steam returned an invalid integer amount.", 502);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max)
    throw appError("Steam returned an invalid integer amount.", 502);
  return result;
}
export function parseWallet(value: Record<string, unknown>): Wallet {
  const id = integer(value.wallet_currency, 1000);
  const code = currencyCodes[id];
  if (
    !code ||
    typeof value.wallet_country !== "string" ||
    !/^[A-Z]{2}$/.test(value.wallet_country)
  ) {
    throw appError(
      "Steam wallet currency or country is unavailable. Open the Steam Community Market first.",
      409,
    );
  }
  const minorUnit = new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
  }).resolvedOptions().maximumFractionDigits;
  if (minorUnit === undefined)
    throw appError("Steam wallet currency is unsupported.", 409);
  const minimum = integer(
    value.wallet_market_minimum ?? value.wallet_fee_minimum,
  );
  const increment = integer(value.wallet_currency_increment ?? 1);
  if (minimum < 1 || increment < 1 || minimum % increment !== 0)
    throw appError("Steam wallet price increments are unsupported.", 409);
  const wallet: Wallet = {
    currency: { id, code, minorUnit },
    country: value.wallet_country,
    minimum,
    increment,
    steamRate:
      value.wallet_fee === 0 || value.wallet_fee === "0"
        ? parseRate("0")
        : parseRate(value.wallet_fee_percent),
    publisherRate: parseRate(value.wallet_publisher_fee_percent_default),
    // New wallets express fee rounding via market_minimum / currency_increment.
    steamBase:
      value.wallet_market_minimum !== undefined
        ? 0
        : integer(value.wallet_fee_base ?? 0),
  };
  toMinorUnits(minimum, wallet.currency);
  wallet.currency = {
    ...wallet.currency,
    priceStep: toMinorUnits(increment, wallet.currency),
  };
  return wallet;
}
/** Steam's API counts hundredths even for zero- and three-decimal currencies. */
export function toMinorUnits(
  steamAmount: number,
  currency: MarketCurrency,
): number {
  assertMoneyInput(steamAmount, currency);
  const numerator = BigInt(steamAmount) * 10n ** BigInt(currency.minorUnit);
  if (numerator % 100n !== 0n)
    throw appError(
      "Steam returned a price outside the wallet currency precision.",
      409,
    );
  const amount = Number(numerator / 100n);
  if (!Number.isSafeInteger(amount))
    throw appError("Steam market price exceeds the supported limit.", 409);
  return amount;
}

/** Exact inverse of toMinorUnits, including signed price adjustments. */
export function fromMinorUnits(
  amount: number,
  currency: MarketCurrency,
): number {
  assertMoneyInput(amount, currency);
  const numerator = BigInt(amount) * 100n;
  const denominator = 10n ** BigInt(currency.minorUnit);
  if (numerator % denominator !== 0n)
    throw appError(
      "The price cannot be represented exactly in Steam's currency precision.",
      409,
    );
  const result = Number(numerator / denominator);
  if (!Number.isSafeInteger(result))
    throw appError("Steam market price exceeds the supported limit.", 409);
  return result;
}

function assertMoneyInput(amount: number, currency: MarketCurrency) {
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isInteger(currency.minorUnit) ||
    currency.minorUnit < 0 ||
    currency.minorUnit > 3
  )
    throw appError(
      "Market prices must be exact integer currency amounts.",
      409,
    );
}

/** Validate money against the current wallet before persisting or quoting it. */
export function validatePriceSettings(
  wallet: Wallet,
  settings: MarketPriceSettings,
) {
  const moneyCustomized =
    settings.adjustment !== 0 ||
    settings.minBuyerPrice !== null ||
    settings.maxBuyerPrice !== null;
  if (
    !["lowestSellOrder", "highestBuyOrder"].includes(settings.priceMode) ||
    !Number.isSafeInteger(settings.adjustment) ||
    Math.abs(settings.adjustment) > 1_000_000_000 ||
    !Number.isInteger(settings.delaySeconds) ||
    settings.delaySeconds < 1 ||
    settings.delaySeconds > 60 ||
    (settings.currencyId !== null &&
      (!Number.isInteger(settings.currencyId) ||
        settings.currencyId < 1 ||
        settings.currencyId > 1000)) ||
    [settings.minBuyerPrice, settings.maxBuyerPrice].some(
      (value) =>
        value !== null &&
        (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000),
    )
  )
    throw appError("Market price settings are invalid.", 400);
  if (moneyCustomized && settings.currencyId === null)
    throw appError(
      "Bind custom market prices to the current wallet currency.",
      409,
    );
  if (
    settings.currencyId !== null &&
    settings.currencyId !== wallet.currency.id
  )
    throw Object.assign(
      appError(
        "The saved market prices use a different wallet currency. Review the price settings.",
        409,
      ),
      { displayReason: "CURRENCY_MISMATCH" as const },
    );
  if (
    settings.minBuyerPrice !== null &&
    settings.maxBuyerPrice !== null &&
    settings.minBuyerPrice > settings.maxBuyerPrice
  )
    throw appError(
      "The minimum buyer price cannot exceed the maximum buyer price.",
      400,
    );
  for (const value of [
    settings.adjustment,
    settings.minBuyerPrice,
    settings.maxBuyerPrice,
  ]) {
    if (value === null) continue;
    const steamAmount = fromMinorUnits(value, wallet.currency);
    if (steamAmount % wallet.increment !== 0)
      throw appError(
        "Market prices must follow the wallet's price increments without rounding.",
        409,
      );
  }
}

/** Apply explicit buyer-price rules; never clamp or round a user's boundaries. */
export function quoteWithRules(
  referenceSteamPrice: number,
  wallet: Wallet,
  publisherFee: unknown,
  settings: MarketPriceSettings,
) {
  validatePriceSettings(wallet, settings);
  if (
    !Number.isSafeInteger(referenceSteamPrice) ||
    referenceSteamPrice < 1 ||
    referenceSteamPrice > 1_000_000_000 ||
    referenceSteamPrice % wallet.increment !== 0
  )
    throw appError(
      "Steam returned an unsupported reference market price.",
      409,
    );
  const buyerCap =
    referenceSteamPrice + fromMinorUnits(settings.adjustment, wallet.currency);
  if (
    !Number.isSafeInteger(buyerCap) ||
    buyerCap < 1 ||
    buyerCap > 1_000_000_000
  )
    throw appError(
      "The adjusted buyer price is outside the supported range.",
      409,
    );
  const checkBounds = (steamPrice: number) => {
    const amount = toMinorUnits(steamPrice, wallet.currency);
    if (
      (settings.minBuyerPrice !== null && amount < settings.minBuyerPrice) ||
      (settings.maxBuyerPrice !== null && amount > settings.maxBuyerPrice)
    )
      throw Object.assign(
        appError(
          "The buyer price is outside your saved price limits. No listing was submitted.",
          409,
        ),
        { displayReason: "OUTSIDE_PRICE_LIMITS" as const },
      );
  };
  checkBounds(buyerCap);
  const quote = quoteFromBuyerCap(buyerCap, wallet, publisherFee);
  // Steam's fee grid can leave an unrepresentable gap below the requested cap.
  // The accepted listing price must still honor the user's lower bound.
  checkBounds(quote.buyerPays);
  return { ...quote, buyerCap };
}
function fee(base: number, rate: Rate, wallet: Wallet): number {
  if (rate.numerator === 0n) return 0;
  const floor = Number((BigInt(base) * rate.numerator) / rate.denominator);
  if (floor <= wallet.minimum) return wallet.minimum;
  // Round on the wallet's price grid using integer arithmetic only.
  return (
    Number(
      (2n * BigInt(floor) + BigInt(wallet.increment)) /
        (2n * BigInt(wallet.increment)),
    ) * wallet.increment
  );
}
export function quoteFromBuyerCap(
  buyerCap: number,
  wallet: Wallet,
  publisherFee: unknown,
) {
  const publisherRate =
    publisherFee === null || publisherFee === undefined
      ? wallet.publisherRate
      : parseRate(publisherFee);
  const calculate = (base: number) => {
    const steamFee = fee(base, wallet.steamRate, wallet) + wallet.steamBase;
    const publisher = fee(base, publisherRate, wallet);
    return {
      base,
      steamFee,
      publisherFee: publisher,
      buyerPays: base + steamFee + publisher,
    };
  };
  let low = wallet.minimum / wallet.increment;
  let high = Math.floor(buyerCap / wallet.increment);
  let best: ReturnType<typeof calculate> | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const quote = calculate(middle * wallet.increment);
    if (quote.buyerPays <= buyerCap) {
      best = quote;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!best)
    throw Object.assign(
      appError(
        "The current market price cannot cover Steam's minimum fees.",
        409,
      ),
      { displayReason: "BELOW_MINIMUM_FEES" as const },
    );
  return best;
}
