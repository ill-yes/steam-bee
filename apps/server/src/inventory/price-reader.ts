import { integer, parseWallet, type Wallet } from "./money.js";

export type ReadPriceError =
  "NO_ORDERS" | "STEAM_UNAVAILABLE" | "RATE_LIMITED" | "UNSUPPORTED_PRICE";

const errorMessages: Record<ReadPriceError, string> = {
  NO_ORDERS: "No current market orders are available.",
  STEAM_UNAVAILABLE: "Steam market prices are currently unavailable.",
  RATE_LIMITED: "Steam market price requests are temporarily rate limited.",
  UNSUPPORTED_PRICE: "Steam returned unsupported market price data.",
};

export class PriceReadError extends Error {
  constructor(
    readonly code: ReadPriceError,
    readonly retryAt: number | null = null,
  ) {
    super(errorMessages[code]);
    this.name = "PriceReadError";
  }
}

type Dependencies = {
  request: (accountId: string, path: string) => Promise<Response>;
  now?: () => number;
};

type Observation = {
  lowestSellOrder: number | null;
  highestBuyOrder: number | null;
  observedAt: number;
  freshUntil: number;
  displayUntil: number;
  stale: boolean;
  error: ReadPriceError | null;
  retryAt: number | null;
};

type Flight<T> = { promise: Promise<T>; token: { active: boolean } };
const maxBodyBytes = 8 * 1024 * 1024;
const maxPublicEntries = 2000;
const maxWallets = 8;
const walletTtl = 30_000;
const itemIdTtl = 6 * 60 * 60_000;
const priceTtl = 60_000;
const displayTtl = 5 * 60_000;

function scrub(error: unknown): PriceReadError {
  return error instanceof PriceReadError
    ? error
    : new PriceReadError("STEAM_UNAVAILABLE");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PriceReadError("UNSUPPORTED_PRICE");
  return value as Record<string, unknown>;
}

/** Parse the data assignment without evaluating any of Steam's scripts. */
function walletJson(html: string): Record<string, unknown> {
  const variable = "g_rgWalletInfo";
  const start = html.indexOf(variable);
  const assignment =
    start < 0 ? null : html.slice(start + variable.length).match(/^\s*=\s*/);
  if (!assignment) throw new PriceReadError("STEAM_UNAVAILABLE");
  const offset = start + variable.length + assignment[0].length;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = offset; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return object(JSON.parse(html.slice(offset, index + 1)));
      } catch {
        throw new PriceReadError("STEAM_UNAVAILABLE");
      }
    } else if (depth === 0 && !/\s/.test(char ?? "")) break;
  }
  throw new PriceReadError("STEAM_UNAVAILABLE");
}

function orderPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === 0 || value === "0")
    return null;
  try {
    const price = integer(value);
    if (price < 1) throw new PriceReadError("UNSUPPORTED_PRICE");
    return price;
  } catch {
    throw new PriceReadError("UNSUPPORTED_PRICE");
  }
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value as K);
}

/** Display-only reads. Sale previews and confirmations must continue fetching fresh data. */
export class MarketPriceReader {
  private readonly now: () => number;
  private readonly wallets = new Map<
    string,
    { value: Wallet; until: number }
  >();
  private readonly walletFlights = new Map<string, Flight<Wallet>>();
  private readonly itemIds = new Map<
    string,
    { value: string; until: number }
  >();
  private readonly itemIdFlights = new Map<string, Promise<string>>();
  private readonly observations = new Map<string, Observation>();
  private readonly observationFlights = new Map<string, Promise<Observation>>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;
  private cooldownUntil = 0;
  private cooldownStep = 0;
  private generation = 0;

  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  private cooldown(): PriceReadError | null {
    return this.now() < this.cooldownUntil
      ? new PriceReadError("RATE_LIMITED", this.cooldownUntil)
      : null;
  }

  private rateLimited() {
    this.cooldownStep = Math.min(this.cooldownStep + 1, 4);
    this.cooldownUntil = Math.max(
      this.cooldownUntil,
      this.now() + Math.min(60_000 * 2 ** (this.cooldownStep - 1), 300_000),
    );
    return new PriceReadError("RATE_LIMITED", this.cooldownUntil);
  }

  private async schedule<T>(operation: () => Promise<T>): Promise<T> {
    const cooldown = this.cooldown();
    if (cooldown) throw cooldown;
    if (this.active >= 2 && this.waiting.length >= 40)
      throw new PriceReadError("RATE_LIMITED", this.now() + 1000);
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        const cooldown = this.cooldown();
        if (cooldown) {
          reject(cooldown);
          this.pump();
          return;
        }
        this.active++;
        void operation()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.pump();
          });
      };
      if (this.active < 2) start();
      else {
        let queued = true;
        let timer: ReturnType<typeof setTimeout>;
        const waiting = () => {
          if (!queued) return;
          queued = false;
          clearTimeout(timer);
          start();
        };
        timer = setTimeout(() => {
          if (!queued) return;
          queued = false;
          const index = this.waiting.indexOf(waiting);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new PriceReadError("RATE_LIMITED", this.now() + 1000));
        }, 20_000);
        timer.unref?.();
        this.waiting.push(waiting);
      }
    });
  }

  private pump() {
    while (this.active < 2 && this.waiting.length) this.waiting.shift()!();
  }

  private async read(
    accountId: string,
    path: string,
    isCurrent: () => boolean = () => true,
  ): Promise<string> {
    try {
      return await this.schedule(async () => {
        if (!isCurrent()) throw new PriceReadError("STEAM_UNAVAILABLE");
        const response = await this.dependencies.request(accountId, path);
        if (response.status === 429) {
          await response.body?.cancel().catch(() => undefined);
          throw this.rateLimited();
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new PriceReadError("STEAM_UNAVAILABLE");
        }
        if (!response.body) throw new PriceReadError("STEAM_UNAVAILABLE");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > maxBodyBytes)
              throw new PriceReadError("UNSUPPORTED_PRICE");
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        return Buffer.concat(chunks).toString("utf8");
      });
    } catch (error) {
      throw scrub(error);
    }
  }

  async wallet(accountId: string): Promise<Wallet> {
    const cached = this.wallets.get(accountId);
    if (cached && this.now() < cached.until) {
      remember(this.wallets, accountId, cached, maxWallets);
      return structuredClone(cached.value);
    }
    if (cached) this.wallets.delete(accountId);
    let flight = this.walletFlights.get(accountId);
    if (!flight) {
      const generation = this.generation;
      const token = { active: true };
      const isCurrent = () => token.active && generation === this.generation;
      const promise = (async () => {
        const html = await this.read(
          accountId,
          "/market/?l=english",
          isCurrent,
        );
        if (!isCurrent()) throw new PriceReadError("STEAM_UNAVAILABLE");
        let value: Wallet;
        const data = walletJson(html);
        try {
          value = parseWallet(data);
        } catch {
          throw new PriceReadError("UNSUPPORTED_PRICE");
        }
        if (!isCurrent()) throw new PriceReadError("STEAM_UNAVAILABLE");
        remember(
          this.wallets,
          accountId,
          { value, until: this.now() + walletTtl },
          maxWallets,
        );
        return value;
      })().finally(() => {
        if (this.walletFlights.get(accountId)?.token === token)
          this.walletFlights.delete(accountId);
      });
      const next = { promise, token };
      this.walletFlights.set(accountId, next);
      flight = next;
    }
    return structuredClone(await flight.promise);
  }

  private async itemId(accountId: string, marketHashName: string) {
    const cached = this.itemIds.get(marketHashName);
    if (cached && this.now() < cached.until) {
      remember(this.itemIds, marketHashName, cached, maxPublicEntries);
      return cached.value;
    }
    if (cached) this.itemIds.delete(marketHashName);
    const current = this.itemIdFlights.get(marketHashName);
    if (current) return current;
    const pending = (async () => {
      const html = await this.read(
        accountId,
        `/market/listings/753/${encodeURIComponent(marketHashName)}?l=english`,
      );
      const match = html.match(
        /Market_LoadOrderSpread\(\s*([1-9]\d{0,24})\s*\)/,
      );
      if (!match) throw new PriceReadError("UNSUPPORTED_PRICE");
      remember(
        this.itemIds,
        marketHashName,
        { value: match[1]!, until: this.now() + itemIdTtl },
        maxPublicEntries,
      );
      return match[1]!;
    })().finally(() => this.itemIdFlights.delete(marketHashName));
    this.itemIdFlights.set(marketHashName, pending);
    return pending;
  }

  async observation(
    accountId: string,
    marketHashName: string,
    wallet: Wallet,
  ): Promise<Observation> {
    if (
      typeof marketHashName !== "string" ||
      !marketHashName.length ||
      marketHashName.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(marketHashName)
    )
      throw new PriceReadError("UNSUPPORTED_PRICE");
    const key = JSON.stringify([
      marketHashName,
      wallet.currency.id,
      wallet.country,
    ]);
    let cached = this.observations.get(key);
    if (cached && this.now() >= cached.displayUntil) {
      this.observations.delete(key);
      cached = undefined;
    }
    if (cached && this.now() < cached.freshUntil) {
      remember(this.observations, key, cached, maxPublicEntries);
      return { ...cached };
    }
    const current = this.observationFlights.get(key);
    if (current) return { ...(await current) };
    const pending = (async () => {
      try {
        const itemId = await this.itemId(accountId, marketHashName);
        const query = new URLSearchParams({
          country: wallet.country,
          language: "english",
          currency: String(wallet.currency.id),
          item_nameid: itemId,
          two_factor: "0",
        });
        const body = await this.read(
          accountId,
          `/market/itemordershistogram?${query}`,
        );
        let data: Record<string, unknown>;
        try {
          data = object(JSON.parse(body));
        } catch {
          throw new PriceReadError("UNSUPPORTED_PRICE");
        }
        if (![true, 1, "1"].includes(data.success as boolean | number | string))
          throw new PriceReadError("STEAM_UNAVAILABLE");
        const observedAt = this.now();
        const value: Observation = {
          lowestSellOrder: orderPrice(data.lowest_sell_order),
          highestBuyOrder: orderPrice(data.highest_buy_order),
          observedAt,
          freshUntil: observedAt + priceTtl,
          displayUntil: observedAt + displayTtl,
          stale: false,
          error: null,
          retryAt: null,
        };
        if (this.now() >= this.cooldownUntil) {
          this.cooldownStep = 0;
          this.cooldownUntil = 0;
        }
        remember(this.observations, key, value, maxPublicEntries);
        return value;
      } catch (error) {
        const failure = scrub(error);
        if (cached && this.now() < cached.displayUntil)
          return {
            ...cached,
            stale: true,
            error: failure.code,
            retryAt: failure.retryAt,
          };
        throw failure;
      }
    })().finally(() => this.observationFlights.delete(key));
    this.observationFlights.set(key, pending);
    return { ...(await pending) };
  }

  clearAccount(accountId: string) {
    this.wallets.delete(accountId);
    const flight = this.walletFlights.get(accountId);
    if (flight) flight.token.active = false;
    this.walletFlights.delete(accountId);
  }

  shutdown() {
    this.generation++;
    this.wallets.clear();
    for (const flight of this.walletFlights.values())
      flight.token.active = false;
    this.walletFlights.clear();
  }
}
