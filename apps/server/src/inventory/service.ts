import { randomUUID } from "node:crypto";
import type {
  InventoryItem,
  InventorySnapshot,
  MarketActionResult,
  MarketCancelPreview,
  MarketListing,
  MarketListings,
  MarketSalePreview,
  MarketPriceSettings,
  MarketBatchPreview,
  MarketBatchJob,
  InventoryPriceOverview,
} from "@steam-bee/contracts";
import { DEFAULT_MARKET_PRICE_SETTINGS } from "@steam-bee/contracts";
import { appError } from "../http/errors.js";
import { inventoryMetadata } from "./metadata.js";
import { InventoryPriceOverviewService } from "./price-overview.js";
import {
  MarketBatchQueue,
  stoppedBeforeSubmission,
  uncertainSubmission,
  type BatchCommand,
} from "./batch.js";
import {
  integer,
  parseWallet,
  quoteWithRules,
  validatePriceSettings,
  toMinorUnits,
  type Wallet,
} from "./money.js";
import { parseListingOrderBook } from "./order-book.js";

type Json = Record<string, unknown>;
type RequestInit = {
  method?: "GET" | "POST";
  form?: Record<string, string>;
  shouldContinue?: () => boolean;
};
type Dependencies = {
  request: (
    accountId: string,
    path: string,
    init?: RequestInit,
  ) => Promise<Response>;
  steamId: (accountId: string) => Promise<string> | string;
  now?: () => number;
  settings?: (accountId: string) => Promise<MarketPriceSettings>;
  mutate?: <T>(accountId: string, operation: () => Promise<T>) => Promise<T>;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};
type Item = InventoryItem & {
  variantId: string;
  group: string;
  publisherFee: unknown;
};
type Sale = {
  kind: "sale";
  accountId: string;
  actor: string;
  preview: MarketSalePreview;
  apiPrice: number;
  buyerCap: number;
  wallet: string;
  settings: MarketPriceSettings;
};
type Cancellation = {
  kind: "cancel";
  accountId: string;
  actor: string;
  preview: MarketCancelPreview;
};
type Intent = Sale | Cancellation;
const maxInventoryPages = 20;
const maxInventoryItems = 40_000;
const maxListingPages = 20;
const previewTtl = 60_000;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw appError("Steam returned an invalid response.", 502);
  return value as Json;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,24}$/.test(value))
    throw appError("Steam returned an invalid item identifier.", 502);
  return value;
}
function instanceId(value: unknown): string {
  const result = String(value ?? "0");
  if (!/^(?:0|[1-9]\d{0,24})$/.test(result))
    throw appError("Steam returned an invalid item instance identifier.", 502);
  return result;
}
function text(value: unknown, fallback = "Steam item"): string {
  return typeof value === "string" ? value.slice(0, 500) : fallback;
}
function success(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
async function responseText(response: Response): Promise<string> {
  if (!response.ok)
    throw appError(
      response.status === 429
        ? "Steam is rate limiting requests. Try again later."
        : "Steam Community is unavailable or the session has expired.",
      response.status === 429 ? 429 : 502,
    );
  if (!response.body) throw appError("Steam returned an empty response.", 502);
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8 * 1024 * 1024)
        throw appError("Steam response exceeded the supported size.", 502);
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function responseJson(response: Response): Promise<Json> {
  const body = await responseText(response);
  try {
    return object(JSON.parse(body));
  } catch {
    throw appError(
      "Steam returned invalid data or the Community session has expired.",
      502,
    );
  }
}
/** Extract JSON data only; never execute script received from Steam. */
export function assignedJson(html: string, variable: string): Json {
  const start = html.indexOf(variable);
  if (start < 0)
    throw appError(
      "Steam market wallet information is unavailable. Open the Community Market in Steam first.",
      409,
    );
  const assignment = html.slice(start + variable.length).match(/^\s*=\s*/);
  if (!assignment)
    throw appError("Steam returned unsupported market data.", 502);
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
        throw appError("Steam returned unsupported market data.", 502);
      }
    } else if (depth === 0 && !/\s/.test(char ?? "")) break;
  }
  throw appError("Steam market wallet information is unavailable.", 409);
}
function walletFingerprint(wallet: Wallet): string {
  return JSON.stringify(wallet, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

export class InventoryMarketService {
  private readonly intents = new Map<string, Intent>();
  private readonly locks = new Map<string, Promise<unknown>>();
  // Retain uncertain/accepted submissions for this process. Never blindly retry a sale.
  private readonly submitted = new Map<string, Map<string, number>>();
  private readonly now: () => number;
  private readonly batches: MarketBatchQueue;
  private readonly accountEpoch = new Map<string, number>();
  private shutdownEpoch = 0;
  private readonly settingsWrites = new Set<string>();
  private readonly priceOverviewService: InventoryPriceOverviewService;
  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
    this.batches = new MarketBatchQueue({
      now: this.now,
      ...(dependencies.wait ? { wait: dependencies.wait } : {}),
    });
    this.priceOverviewService = new InventoryPriceOverviewService({
      request: (accountId, path) => dependencies.request(accountId, path),
      settings: (accountId) => this.priceSettings(accountId),
      now: this.now,
    });
  }

  private async serial<T>(
    accountId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    this.locks.set(accountId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(accountId) === next) this.locks.delete(accountId);
    }
  }
  private captureGuard(accountId: string) {
    const epoch = this.accountEpoch.get(accountId) ?? 0;
    const shutdownEpoch = this.shutdownEpoch;
    return () =>
      (this.accountEpoch.get(accountId) ?? 0) === epoch &&
      shutdownEpoch === this.shutdownEpoch;
  }
  private async json(
    accountId: string,
    path: string,
    init?: RequestInit,
  ): Promise<Json> {
    return responseJson(await this.dependencies.request(accountId, path, init));
  }
  private async html(accountId: string, path: string): Promise<string> {
    return responseText(await this.dependencies.request(accountId, path));
  }
  private async loadInventory(accountId: string): Promise<Item[]> {
    const steamId = id(await this.dependencies.steamId(accountId));
    const assets = new Map<string, Json>();
    const descriptions = new Map<string, Json>();
    const seenCursors = new Set<string>();
    let cursor = "";
    let finished = false;
    let expectedTotal: number | null = null;
    for (let page = 0; page < maxInventoryPages; page++) {
      const query = new URLSearchParams({ l: "english", count: "2000" });
      if (cursor) query.set("start_assetid", cursor);
      const data = await this.json(
        accountId,
        `/inventory/${steamId}/753/6?${query}`,
      );
      if (!success(data.success))
        throw appError(
          "Steam inventory is private, unavailable, or the session has expired.",
          409,
        );
      const total = integer(data.total_inventory_count, maxInventoryItems);
      if (expectedTotal !== null && total !== expectedTotal)
        throw appError(
          "Steam inventory changed during pagination. Refresh before selling.",
          409,
        );
      expectedTotal = total;
      if (!Array.isArray(data.assets) && total !== 0)
        throw appError("Steam returned an incomplete inventory.", 502);
      for (const raw of Array.isArray(data.descriptions)
        ? data.descriptions
        : []) {
        const description = object(raw);
        descriptions.set(
          `${id(description.classid)}_${instanceId(description.instanceid)}`,
          description,
        );
      }
      for (const raw of Array.isArray(data.assets) ? data.assets : []) {
        const asset = object(raw);
        if (integer(asset.appid) !== 753 || String(asset.contextid) !== "6")
          throw appError(
            "Steam returned an item from an unexpected inventory.",
            502,
          );
        assets.set(id(asset.assetid), asset);
        if (assets.size > maxInventoryItems)
          throw appError("Inventory is too large to validate safely.", 409);
      }
      if (!success(data.more_items)) {
        finished = true;
        break;
      }
      cursor = id(data.last_assetid);
      if (seenCursors.has(cursor))
        throw appError("Steam inventory pagination did not advance.", 502);
      seenCursors.add(cursor);
    }
    if (!finished)
      throw appError(
        "Inventory exceeds the supported pagination limit; no partial inventory is used for sales.",
        409,
      );
    if (assets.size !== expectedTotal)
      throw appError(
        "Steam returned an incomplete inventory. Refresh before selling.",
        409,
      );
    const items: Item[] = [];
    const kept = new Set<string>();
    for (const [assetId, asset] of assets) {
      const classId = id(asset.classid);
      const itemInstanceId = instanceId(asset.instanceid);
      const group = `${classId}_${itemInstanceId}`;
      const description = descriptions.get(group);
      if (!description)
        throw appError(
          "Steam returned an item without its description; refresh before selling.",
          502,
        );
      const quantity = integer(asset.amount, 1_000_000);
      if (quantity < 1)
        throw appError("Steam returned an invalid inventory quantity.", 502);
      const duplicateQuantity = quantity - (kept.has(group) ? 0 : 1);
      kept.add(group);
      const icon = description.icon_url;
      items.push({
        assetId,
        variantId: `753:6:${classId}:${itemInstanceId}`,
        name: text(description.name),
        marketHashName:
          typeof description.market_hash_name === "string"
            ? description.market_hash_name.slice(0, 500)
            : null,
        type: text(description.type, ""),
        iconUrl: economyIconUrl(icon),
        quantity,
        duplicateQuantity,
        marketable: success(description.marketable),
        tradable: success(description.tradable),
        ...inventoryMetadata(description),
        group,
        publisherFee: description.market_fee ?? null,
      });
    }
    return items;
  }
  async inventory(accountId: string): Promise<InventorySnapshot> {
    const isCurrent = this.captureGuard(accountId);
    const items = await this.loadInventory(accountId);
    const fetchedAt = this.now();
    if (isCurrent())
      this.priceOverviewService.seed(accountId, items, fetchedAt);
    return {
      appId: 753,
      contextId: "6",
      fetchedAt,
      items: items.map(
        ({ group: _group, publisherFee: _fee, ...item }) => item,
      ),
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      duplicateQuantity: items.reduce(
        (sum, item) => sum + item.duplicateQuantity,
        0,
      ),
    };
  }
  async priceOverview(
    accountId: string,
    variantIds: string[],
  ): Promise<InventoryPriceOverview> {
    return this.priceOverviewService.read(accountId, variantIds);
  }
  private async wallet(accountId: string): Promise<Wallet> {
    return parseWallet(
      assignedJson(
        await this.html(accountId, "/market/?l=english"),
        "g_rgWalletInfo",
      ),
    );
  }
  private async loadListings(
    accountId: string,
    wallet: Wallet,
  ): Promise<MarketListing[]> {
    const listings = new Map<string, MarketListing>();
    const activeIds = new Set<string>();
    let start = 0;
    let finished = false;
    for (let page = 0; page < maxListingPages; page++) {
      const data = await this.json(
        accountId,
        `/market/mylistings?norender=1&start=${start}&count=100`,
      );
      if (!success(data.success))
        throw appError(
          "Steam market listings are unavailable or the session has expired.",
          409,
        );
      const total = integer(
        data.num_active_listings ?? data.total_count,
        100_000,
      );
      const rawListings = data.listings ?? data.listinginfo;
      if (rawListings === undefined)
        throw appError("Steam returned incomplete market listings.", 502);
      const active = Array.isArray(rawListings)
        ? rawListings
        : Object.values(object(rawListings ?? {}));
      for (const raw of active) {
        const listingId = id(String(object(raw).listingid));
        if (activeIds.has(listingId))
          throw appError(
            "Steam market listing pagination did not advance.",
            502,
          );
        activeIds.add(listingId);
      }
      const held = Array.isArray(data.listings_on_hold)
        ? data.listings_on_hold
        : [];
      const confirmations = Array.isArray(data.listings_to_confirm)
        ? data.listings_to_confirm
        : [];
      for (const [raw, pending] of [
        ...active.map((entry) => [entry, false] as const),
        ...held.map((entry) => [entry, true] as const),
        ...confirmations.map((entry) => [entry, true] as const),
      ]) {
        const listing = object(raw);
        const asset = object(listing.asset);
        if (integer(asset.appid) !== 753 || String(asset.contextid) !== "6")
          continue;
        const listingId = id(String(listing.listingid));
        const assetId = id(String(asset.id ?? asset.assetid));
        let details: Json = asset;
        if (data.assets && !Array.isArray(data.assets)) {
          const appAssets = object(object(data.assets)["753"] ?? {});
          const contextAssets = object(appAssets["6"] ?? {});
          if (contextAssets[assetId]) details = object(contextAssets[assetId]);
        }
        const currencyId = integer(listing.currencyid, 3000) % 1000;
        const converted = currencyId !== wallet.currency.id;
        if (
          converted &&
          integer(listing.converted_currencyid, 3000) % 1000 !==
            wallet.currency.id
        )
          throw appError(
            "Steam listing currency does not match the wallet.",
            409,
          );
        const base = integer(
          converted ? listing.converted_price : listing.price,
        );
        const fees = integer(converted ? listing.converted_fee : listing.fee);
        listings.set(listingId, {
          listingId,
          assetId,
          name: text(details.name ?? details.market_hash_name),
          type: text(details.type, ""),
          iconUrl: economyIconUrl(details.icon_url),
          quantity: integer(asset.amount ?? 1, 1_000_000),
          sellerReceives: toMinorUnits(base, wallet.currency),
          buyerPays: toMinorUnits(base + fees, wallet.currency),
          pendingConfirmation: pending,
        });
      }
      start += active.length;
      if (start >= total) {
        if (activeIds.size !== total)
          throw appError("Steam returned incomplete market listings.", 502);
        finished = true;
        break;
      }
      if (active.length === 0)
        throw appError("Steam market pagination did not advance.", 502);
    }
    if (!finished)
      throw appError(
        "Market listings exceed the supported pagination limit.",
        409,
      );
    return [...listings.values()];
  }
  async listings(accountId: string): Promise<MarketListings> {
    const wallet = await this.wallet(accountId);
    return {
      fetchedAt: this.now(),
      currency: wallet.currency,
      listings: await this.loadListings(accountId, wallet),
    };
  }
  private async priceSettings(accountId: string): Promise<MarketPriceSettings> {
    return this.dependencies.settings
      ? this.dependencies.settings(accountId)
      : { ...DEFAULT_MARKET_PRICE_SETTINGS };
  }
  async validateSettings(accountId: string, settings: MarketPriceSettings) {
    this.batches.assertIdle(accountId);
    validatePriceSettings(await this.wallet(accountId), settings);
    this.batches.assertIdle(accountId);
  }
  async saveSettings<T>(
    accountId: string,
    settings: MarketPriceSettings,
    write: () => Promise<T>,
  ): Promise<T> {
    if (this.settingsWrites.has(accountId))
      throw appError(
        "Price settings are already being saved for this account.",
        409,
      );
    this.settingsWrites.add(accountId);
    try {
      return await this.serial(accountId, async () => {
        await this.validateSettings(accountId, settings);
        return this.mutate(
          accountId,
          () => true,
          async () => {
            this.batches.assertIdle(accountId);
            return write();
          },
        );
      });
    } finally {
      this.settingsWrites.delete(accountId);
    }
  }
  private async listingOrderBook(
    accountId: string,
    html: string,
    wallet: Wallet,
  ): Promise<Json> {
    const book = parseListingOrderBook(html);
    if (book) {
      if (book.currencyId !== wallet.currency.id)
        throw appError(
          "Steam returned prices in another currency. No sale was submitted.",
          409,
        );
      return {
        success: 1,
        lowest_sell_order: book.lowestSellOrder,
        highest_buy_order: book.highestBuyOrder,
      };
    }
    const match = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
    if (!match)
      throw appError(
        "Steam did not provide an authoritative order book for this item.",
        409,
      );
    const query = new URLSearchParams({
      country: wallet.country,
      language: "english",
      currency: String(wallet.currency.id),
      item_nameid: match[1]!,
      two_factor: "0",
    });
    return this.json(accountId, `/market/itemordershistogram?${query}`);
  }
  private async quote(
    accountId: string,
    item: Item,
    wallet: Wallet,
    settings: MarketPriceSettings,
  ) {
    if (!item.marketable || !item.marketHashName)
      throw appError(
        "This item cannot be sold on the Steam Community Market.",
        409,
      );
    const html = await this.html(
      accountId,
      `/market/listings/753/${encodeURIComponent(item.marketHashName)}?l=english`,
    );
    const data = await this.listingOrderBook(accountId, html, wallet);
    const reference =
      settings.priceMode === "highestBuyOrder"
        ? data.highest_buy_order
        : data.lowest_sell_order;
    if (!success(data.success) || reference === null || reference === undefined)
      throw appError(
        "No current Steam sell price is available. No sale was submitted.",
        409,
      );
    const referencePrice = integer(reference);
    const buyerCap = referencePrice;
    if (buyerCap < 1)
      throw appError("No current Steam sell price is available.", 409);
    return {
      ...quoteWithRules(referencePrice, wallet, item.publisherFee, settings),
    };
  }
  private pruneIntents() {
    for (const [token, intent] of this.intents)
      if (intent.preview.expiresAt <= this.now()) this.intents.delete(token);
    if (this.intents.size >= 1000)
      throw appError(
        "Too many pending market previews. Wait a minute and try again.",
        429,
      );
  }
  private assertSellable(
    accountId: string,
    items: Item[],
    assetId: string,
    quantity: number,
  ): Item {
    const item = items.find((entry) => entry.assetId === assetId);
    if (
      !item ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 100 ||
      quantity > item.quantity
    )
      throw appError(
        "This item or quantity is no longer available. Refresh the inventory.",
        409,
      );
    if (this.submitted.get(accountId)?.has(assetId))
      throw appError(
        "This asset has already been submitted or its submission is uncertain. Check Steam's listings before retrying.",
        409,
      );
    const groupQuantity = items
      .filter((entry) => entry.group === item.group)
      .reduce(
        (sum, entry) =>
          sum +
          entry.quantity -
          Math.min(
            entry.quantity,
            this.submitted.get(accountId)?.get(entry.assetId) ?? 0,
          ),
        0,
      );
    if (groupQuantity - quantity < 1)
      throw appError(
        "Keep one copy: only duplicate items can be sold here.",
        409,
      );
    return item;
  }
  async previewSale(
    accountId: string,
    actor: string,
    assetId: string,
    quantity: number,
  ): Promise<MarketSalePreview> {
    this.batches.assertIdle(accountId);
    const isCurrent = this.captureGuard(accountId);
    return this.serial(accountId, async () => {
      if (!isCurrent()) throw stoppedBeforeSubmission();
      this.pruneIntents();
      const item = this.assertSellable(
        accountId,
        await this.loadInventory(accountId),
        assetId,
        quantity,
      );
      const wallet = await this.wallet(accountId);
      const listings = await this.loadListings(accountId, wallet);
      if (listings.some((listing) => listing.assetId === assetId))
        throw appError(
          "This asset already has an active or pending market listing.",
          409,
        );
      const settings = await this.priceSettings(accountId);
      const quote = await this.quote(accountId, item, wallet, settings);
      if (!isCurrent()) throw stoppedBeforeSubmission();
      const convert = (amount: number) => toMinorUnits(amount, wallet.currency);
      const preview: MarketSalePreview = {
        token: randomUUID(),
        expiresAt: this.now() + previewTtl,
        assetId,
        name: item.name,
        quantity,
        buyerPaysPerItem: convert(quote.buyerPays),
        sellerReceivesPerItem: convert(quote.base),
        steamFeePerItem: convert(quote.steamFee),
        publisherFeePerItem: convert(quote.publisherFee),
        totalBuyerPays: convert(quote.buyerPays * quantity),
        totalSellerReceives: convert(quote.base * quantity),
        currency: wallet.currency,
      };
      this.intents.set(preview.token, {
        kind: "sale",
        accountId,
        actor,
        preview,
        apiPrice: quote.base,
        buyerCap: quote.buyerCap,
        wallet: walletFingerprint(wallet),
        settings: structuredClone(settings),
      });
      return preview;
    });
  }
  private takeIntent(
    accountId: string,
    actor: string,
    token: string,
    kind: Intent["kind"],
  ): Intent {
    const intent = this.intents.get(token);
    if (
      !intent ||
      intent.accountId !== accountId ||
      intent.actor !== actor ||
      intent.kind !== kind
    )
      throw appError("Market preview is invalid. Create a new preview.", 409);
    this.intents.delete(token);
    if (intent.preview.expiresAt <= this.now())
      throw appError(
        "Market preview expired. Review a fresh price before confirming.",
        409,
      );
    return intent;
  }
  async confirmSale(
    accountId: string,
    actor: string,
    token: string,
  ): Promise<MarketActionResult> {
    this.batches.assertIdle(accountId);
    const isCurrent = this.captureGuard(accountId);
    return this.serial(accountId, async () => {
      if (!isCurrent()) throw stoppedBeforeSubmission();
      return this.executeSale(
        this.takeIntent(accountId, actor, token, "sale") as Sale,
        isCurrent,
      );
    });
  }
  private async mutate<T>(
    accountId: string,
    shouldContinue: () => boolean,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    const guarded = async () => {
      if (!shouldContinue()) throw stoppedBeforeSubmission();
      return operation();
    };
    return this.dependencies.mutate
      ? this.dependencies.mutate(accountId, guarded)
      : guarded();
  }
  private async executeSale(
    intent: Sale,
    shouldContinue: () => boolean,
  ): Promise<MarketActionResult> {
    const { accountId } = intent;
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    const { assetId, quantity } = intent.preview;
    const item = this.assertSellable(
      accountId,
      await this.loadInventory(accountId),
      assetId,
      quantity,
    );
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    const wallet = await this.wallet(accountId);
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    const settings = await this.priceSettings(accountId);
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    if (
      walletFingerprint(wallet) !== intent.wallet ||
      JSON.stringify(settings) !== JSON.stringify(intent.settings)
    ) {
      throw Object.assign(
        appError(
          "Steam wallet currency or fees changed, or price settings changed. Review a new preview.",
          409,
        ),
        { stopBatch: true },
      );
    }
    const listings = await this.loadListings(accountId, wallet);
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    if (listings.some((listing) => listing.assetId === assetId))
      throw appError(
        "This asset already has an active or pending market listing.",
        409,
      );
    const quote = await this.quote(accountId, item, wallet, settings);
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    if (
      quote.buyerCap !== intent.buyerCap ||
      quote.base !== intent.apiPrice ||
      toMinorUnits(quote.buyerPays, wallet.currency) !==
        intent.preview.buyerPaysPerItem
    )
      throw appError(
        "Steam market prices changed. Review a fresh preview before selling.",
        409,
      );
    return this.mutate(accountId, shouldContinue, async () => {
      if (
        JSON.stringify(await this.priceSettings(accountId)) !==
        JSON.stringify(intent.settings)
      )
        throw Object.assign(
          appError("Price settings changed. Review a new preview.", 409),
          { stopBatch: true },
        );
      if (!shouldContinue()) throw stoppedBeforeSubmission();
      // Reserve before calling Steam: an interrupted HTTP response must never cause a blind retry.
      const submitted =
        this.submitted.get(accountId) ?? new Map<string, number>();
      submitted.set(assetId, quantity);
      this.submitted.set(accountId, submitted);
      let data: Json;
      try {
        data = await this.json(accountId, "/market/sellitem/", {
          method: "POST",
          shouldContinue,
          form: {
            appid: "753",
            contextid: "6",
            assetid: assetId,
            amount: String(quantity),
            price: String(intent.apiPrice),
          },
        });
      } catch (error) {
        if ((error as { notSubmitted?: unknown }).notSubmitted === true) {
          submitted.delete(assetId);
          throw error;
        }
        throw uncertainSubmission();
      }
      if (!success(data.success)) {
        // A definite rejection created no listing, so the asset may be retried after fixing the cause.
        submitted.delete(assetId);
        throw appError(
          "Steam rejected the listing. Check market eligibility, trade holds, and Steam Guard in Steam before retrying.",
          409,
        );
      }
      const pendingConfirmation =
        success(data.needs_mobile_confirmation) ||
        success(data.needs_email_confirmation);
      return {
        ok: true,
        listingId:
          typeof data.listingid === "string" && /^\d+$/.test(data.listingid)
            ? data.listingid
            : null,
        pendingConfirmation,
        message: pendingConfirmation
          ? "Listing submitted. Confirm it in the Steam mobile app or confirmation email."
          : "Listing submitted to the Steam Community Market.",
      };
    });
  }
  async previewCancellation(
    accountId: string,
    actor: string,
    listingId: string,
  ): Promise<MarketCancelPreview> {
    this.batches.assertIdle(accountId);
    const isCurrent = this.captureGuard(accountId);
    return this.serial(accountId, async () => {
      if (!isCurrent()) throw stoppedBeforeSubmission();
      this.pruneIntents();
      const listing = (await this.listings(accountId)).listings.find(
        (entry) => entry.listingId === listingId,
      );
      if (!isCurrent()) throw stoppedBeforeSubmission();
      if (!listing)
        throw appError(
          "This listing no longer belongs to the account or is unavailable.",
          409,
        );
      const preview = {
        token: randomUUID(),
        expiresAt: this.now() + previewTtl,
        listingId,
        name: listing.name,
      };
      this.intents.set(preview.token, {
        kind: "cancel",
        accountId,
        actor,
        preview,
      });
      return preview;
    });
  }
  async confirmCancellation(
    accountId: string,
    actor: string,
    token: string,
  ): Promise<MarketActionResult> {
    this.batches.assertIdle(accountId);
    const isCurrent = this.captureGuard(accountId);
    return this.serial(accountId, () => {
      if (!isCurrent()) throw stoppedBeforeSubmission();
      return this.executeCancellation(
        this.takeIntent(accountId, actor, token, "cancel") as Cancellation,
        isCurrent,
      );
    });
  }
  private async executeCancellation(
    intent: Cancellation,
    shouldContinue: () => boolean,
  ): Promise<MarketActionResult> {
    const { accountId } = intent;
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    const listing = (await this.listings(accountId)).listings.find(
      (entry) => entry.listingId === intent.preview.listingId,
    );
    if (!shouldContinue()) throw stoppedBeforeSubmission();
    if (!listing)
      throw appError(
        "This listing no longer belongs to the account or was already removed.",
        409,
      );
    await this.mutate(accountId, shouldContinue, async () => {
      let response: Response;
      try {
        response = await this.dependencies.request(
          accountId,
          `/market/removelisting/${listing.listingId}`,
          { method: "POST", form: {}, shouldContinue },
        );
      } catch (error) {
        if ((error as { notSubmitted?: unknown }).notSubmitted === true)
          throw error;
        throw uncertainSubmission();
      }
      if (response.status >= 500) {
        // A server/gateway error can arrive after Steam committed the removal.
        // Treat it like a lost response and stop the remaining batch.
        await response.body?.cancel().catch(() => undefined);
        throw uncertainSubmission();
      }
      if (!response.ok)
        throw appError(
          "Steam did not accept the cancellation. Refresh the current listings.",
          response.status === 429 ? 429 : 409,
        );
      try {
        if (response.body) await responseText(response);
      } catch {
        throw uncertainSubmission();
      }
    });
    try {
      if (
        (await this.listings(accountId)).listings.some(
          (entry) => entry.listingId === listing.listingId,
        )
      )
        throw Object.assign(
          appError(
            "Steam has not confirmed that the listing was removed. Refresh the current listings before taking further action.",
            409,
          ),
          { stopBatch: true },
        );
    } catch (error) {
      if ((error as { stopBatch?: unknown }).stopBatch === true) throw error;
      throw uncertainSubmission();
    }
    return {
      ok: true,
      listingId: listing.listingId,
      pendingConfirmation: false,
      message:
        "Market listing cancelled. Steam will return the item to the inventory.",
    };
  }

  async previewBatch(
    accountId: string,
    actor: string,
    input:
      | { kind: "sale"; items: { assetId: string; quantity: number }[] }
      | { kind: "cancel"; listingIds: string[] },
  ): Promise<MarketBatchPreview> {
    this.batches.assertIdle(accountId);
    const isCurrent = this.captureGuard(accountId);
    return this.serial(accountId, async () => {
      this.batches.assertIdle(accountId);
      const wallet = await this.wallet(accountId);
      if (!isCurrent()) throw stoppedBeforeSubmission();
      const settings = await this.priceSettings(accountId);
      if (!isCurrent()) throw stoppedBeforeSubmission();
      if (input.kind === "sale") validatePriceSettings(wallet, settings);
      const listings = await this.loadListings(accountId, wallet);
      if (!isCurrent()) throw stoppedBeforeSubmission();
      const commands: BatchCommand[] = [];
      if (input.kind === "cancel") {
        if (
          !input.listingIds.length ||
          input.listingIds.length > 50 ||
          new Set(input.listingIds).size !== input.listingIds.length
        )
          throw appError(
            "Choose between one and 50 distinct market listings.",
            400,
          );
        for (const listingId of input.listingIds) {
          id(listingId);
          const listing = listings.find(
            (entry) => entry.listingId === listingId,
          );
          const row = {
            assetId: listing?.assetId ?? null,
            listingId,
            name: listing?.name ?? `Listing ${listingId}`,
            quantity: listing?.quantity ?? 1,
            // Listings carry unit prices; preview rows carry row totals.
            buyerPays: listing ? listing.buyerPays * listing.quantity : null,
            sellerReceives: listing
              ? listing.sellerReceives * listing.quantity
              : null,
            steamFee: null,
            publisherFee: null,
            status: listing ? ("ready" as const) : ("unavailable" as const),
            message: listing
              ? null
              : "This listing no longer belongs to this account or is unavailable.",
          };
          const intent: Cancellation = {
            kind: "cancel",
            accountId,
            actor,
            preview: {
              token: randomUUID(),
              expiresAt: this.now() + previewTtl,
              listingId,
              name: row.name,
            },
          };
          commands.push({
            row,
            execute: listing
              ? (guard) =>
                  this.serial(accountId, () =>
                    this.executeCancellation(intent, guard),
                  )
              : null,
          });
        }
      } else {
        if (
          !input.items.length ||
          input.items.length > 50 ||
          new Set(input.items.map((item) => item.assetId)).size !==
            input.items.length
        )
          throw appError(
            "Choose between one and 50 distinct inventory assets.",
            400,
          );
        const inventory = await this.loadInventory(accountId);
        if (!isCurrent()) throw stoppedBeforeSubmission();
        const planned = new Map<string, number>();
        const quotes = new Map<
          string,
          Promise<Awaited<ReturnType<InventoryMarketService["quote"]>>>
        >();
        for (const selected of input.items) {
          if (!isCurrent()) throw stoppedBeforeSubmission();
          id(selected.assetId);
          const source = inventory.find(
            (item) => item.assetId === selected.assetId,
          );
          const unavailable = (message: string): BatchCommand => ({
            row: {
              assetId: selected.assetId,
              ...(source ? { variantId: source.variantId } : {}),
              listingId: null,
              name: source?.name ?? `Asset ${selected.assetId}`,
              quantity: selected.quantity,
              buyerPays: null,
              sellerReceives: null,
              steamFee: null,
              publisherFee: null,
              status: "unavailable",
              message,
            },
            execute: null,
          });
          try {
            const item = this.assertSellable(
              accountId,
              inventory,
              selected.assetId,
              selected.quantity,
            );
            if (listings.some((listing) => listing.assetId === item.assetId))
              throw appError(
                "This asset already has an active or pending market listing.",
                409,
              );
            const availableGroup = inventory
              .filter((entry) => entry.group === item.group)
              .reduce(
                (sum, entry) =>
                  sum +
                  entry.quantity -
                  Math.min(
                    entry.quantity,
                    this.submitted.get(accountId)?.get(entry.assetId) ?? 0,
                  ),
                0,
              );
            if (
              availableGroup -
                (planned.get(item.group) ?? 0) -
                selected.quantity <
              1
            )
              throw appError(
                "Keep one copy: this batch would sell the last remaining copy.",
                409,
              );
            const key = `${item.marketHashName}:${String(item.publisherFee)}`;
            let pendingQuote = quotes.get(key);
            if (!pendingQuote) {
              pendingQuote = this.quote(accountId, item, wallet, settings);
              quotes.set(key, pendingQuote);
            }
            const quote = await pendingQuote;
            planned.set(
              item.group,
              (planned.get(item.group) ?? 0) + selected.quantity,
            );
            const convert = (amount: number) =>
              toMinorUnits(amount, wallet.currency);
            const preview: MarketSalePreview = {
              token: randomUUID(),
              expiresAt: this.now() + previewTtl,
              assetId: item.assetId,
              name: item.name,
              quantity: selected.quantity,
              buyerPaysPerItem: convert(quote.buyerPays),
              sellerReceivesPerItem: convert(quote.base),
              steamFeePerItem: convert(quote.steamFee),
              publisherFeePerItem: convert(quote.publisherFee),
              totalBuyerPays: convert(quote.buyerPays * selected.quantity),
              totalSellerReceives: convert(quote.base * selected.quantity),
              currency: wallet.currency,
            };
            const intent: Sale = {
              kind: "sale",
              accountId,
              actor,
              preview,
              apiPrice: quote.base,
              buyerCap: quote.buyerCap,
              wallet: walletFingerprint(wallet),
              settings: structuredClone(settings),
            };
            commands.push({
              row: {
                assetId: item.assetId,
                variantId: item.variantId,
                listingId: null,
                name: item.name,
                quantity: selected.quantity,
                buyerPays: preview.totalBuyerPays,
                sellerReceives: preview.totalSellerReceives,
                steamFee: preview.steamFeePerItem * selected.quantity,
                publisherFee: preview.publisherFeePerItem * selected.quantity,
                status: "ready",
                message: null,
              },
              execute: (guard) =>
                this.serial(accountId, () => this.executeSale(intent, guard)),
            });
          } catch (error) {
            commands.push(
              unavailable(
                error instanceof Error
                  ? error.message.slice(0, 500)
                  : "A current market quote is unavailable for this item.",
              ),
            );
          }
        }
      }
      if (!isCurrent()) throw stoppedBeforeSubmission();
      return this.batches.create(
        accountId,
        actor,
        input.kind,
        wallet.currency,
        commands,
        settings.delaySeconds,
      );
    });
  }

  stopAccountBatches(accountId: string) {
    this.priceOverviewService.clearAccount(accountId);
    this.accountEpoch.set(
      accountId,
      (this.accountEpoch.get(accountId) ?? 0) + 1,
    );
    for (const [token, intent] of this.intents)
      if (intent.accountId === accountId) this.intents.delete(token);
    this.batches.stopAccount(accountId);
  }
  shutdownBatches() {
    this.priceOverviewService.shutdown();
    this.shutdownEpoch++;
    this.intents.clear();
    this.batches.shutdown();
  }
  currentBatch(accountId: string, actor: string) {
    return this.batches.current(accountId, actor);
  }
  getBatch(accountId: string, actor: string, jobId: string) {
    return this.batches.get(accountId, actor, jobId);
  }
  stopBatch(accountId: string, actor: string, jobId: string) {
    return this.batches.stop(accountId, actor, jobId);
  }
  confirmBatch(
    accountId: string,
    actor: string,
    token: string,
  ): MarketBatchJob {
    if (this.settingsWrites.has(accountId))
      throw appError(
        "Price settings are being saved. Wait before confirming this batch.",
        409,
      );
    return this.batches.confirm(accountId, actor, token);
  }
}

function economyIconUrl(icon: unknown) {
  return typeof icon === "string" && /^[A-Za-z0-9_\/-]+$/.test(icon)
    ? `https://community.akamai.steamstatic.com/economy/image/${icon}/96fx96f`
    : null;
}
