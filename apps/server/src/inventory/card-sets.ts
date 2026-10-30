import type { CardSet, CardSetCard } from "@steam-bee/contracts";
import { appError } from "../http/errors.js";

export const MAX_CARD_SET_PAGE_BYTES = 2_000_000;
export const MAX_CARD_SET_CARDS = 30;
const CACHE_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 2_000;
const IMAGE_HOSTS = [
  ".steamstatic.com",
  ".akamaihd.net",
  "steamcommunity.com",
  ".steamusercontent.com",
];

/** Steam is requested in English; unknown structures are rejected, never guessed. */
export function parseGameCardsPage(
  html: string,
  appId: number,
  now = Date.now(),
): CardSet {
  if (Buffer.byteLength(html, "utf8") > MAX_CARD_SET_PAGE_BYTES) {
    throw new Error("Steam returned an oversized game card page.");
  }
  if (/g_steamID\s*=\s*["']0["']|<form[^>]+id=["']login_form/i.test(html)) {
    throw new Error("Steam Community sign-in is required.");
  }
  const starts = [
    ...html.matchAll(
      /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bbadge_card_set_card\b[^"']*["'][^>]*>/gi,
    ),
  ];
  if (
    starts.length === 0 &&
    !/\bbadge_gamecard_page\b|\bbadge_detail_tasks\b|\bgamecards_inventorylink\b/i.test(
      html,
    )
  ) {
    throw new Error("Steam did not return a recognizable game card page.");
  }
  const cards: CardSetCard[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    if (cards.length >= MAX_CARD_SET_CARDS) break;
    const start = starts[index]!;
    const block = html.slice(
      start.index,
      starts[index + 1]?.index ?? Math.min(html.length, start.index + 8_000),
    );
    const classes = start[0].match(/class\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const owned = /\bowned\b/.test(classes) && !/\bunowned\b/.test(classes);
    const quantity = Number(
      block.match(/badge_card_set_text_qty[^>]*>\s*\((\d{1,5})\)/i)?.[1],
    );
    const name = cardName(block);
    if (!name) continue;
    cards.push({
      name,
      imageUrl: imageUrl(block),
      owned: owned
        ? Number.isSafeInteger(quantity) && quantity > 0
          ? quantity
          : 1
        : 0,
    });
  }
  const text = plainText(html);
  const level = Number(
    text.match(/\bLevel\s+(\d{1,4})\b,?\s*[\d,]+\s*XP\b/i)?.[1],
  );
  const drops = /\bNo card drops remaining\b/i.test(text)
    ? 0
    : Number(text.match(/\b(\d{1,3})\s+card drops? remaining\b/i)?.[1]);
  return {
    appId,
    badgeLevel: Number.isSafeInteger(level) ? level : 0,
    remainingDrops: Number.isSafeInteger(drops) ? drops : null,
    cards,
    fetchedAt: now,
  };
}

type Dependencies = {
  request: (accountId: string, path: string) => Promise<Response>;
  steamId: (accountId: string) => Promise<string> | string;
  now?: () => number;
};

/** Read-only badge set lookups, cached briefly per account and game. */
export class CardSetService {
  private cache = new Map<string, CardSet>();
  private pending = new Map<string, Promise<CardSet>>();

  constructor(private readonly dependencies: Dependencies) {}

  async get(accountId: string, appId: number): Promise<CardSet> {
    const now = this.dependencies.now?.() ?? Date.now();
    const key = `${accountId}:${appId}`;
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt < CACHE_MS) return cached;
    const running = this.pending.get(key);
    if (running) return running;
    const request = this.load(accountId, appId, now).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, request);
    return request;
  }

  clearAccount(accountId: string) {
    for (const key of this.cache.keys())
      if (key.startsWith(`${accountId}:`)) this.cache.delete(key);
  }

  private async load(accountId: string, appId: number, now: number) {
    const steamId = String(await this.dependencies.steamId(accountId));
    if (!/^\d{17}$/.test(steamId))
      throw appError("A Steam profile is required for badge lookup.", 409);
    const response = await this.dependencies.request(
      accountId,
      `/profiles/${steamId}/gamecards/${appId}/?l=english`,
    );
    if (!response.ok) throw appError("Steam game card lookup failed.", 502);
    const html = await response.text();
    let set: CardSet;
    try {
      set = parseGameCardsPage(html, appId, now);
    } catch (error) {
      throw appError(
        error instanceof Error
          ? error.message
          : "Steam game card lookup failed.",
        502,
      );
    }
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(`${accountId}:${appId}`, set);
    return set;
  }
}

function cardName(block: string) {
  const start = block.search(
    /<div\b[^>]*class\s*=\s*["'][^"']*\bbadge_card_set_text\b/i,
  );
  if (start < 0) return "";
  const detail = block.slice(start).search(/game_card_set_detail/i);
  const end =
    detail < 0 ? block.length : block.lastIndexOf("<div", start + detail);
  return plainText(block.slice(start, Math.max(end, start)))
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*\d+\s+of\s+\d+,\s*Series\s+\d+\s*$/i, "")
    .trim()
    .slice(0, 128);
}

function imageUrl(block: string): string | null {
  for (const match of block.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
  )) {
    try {
      const url = new URL(match[1]!.replace(/&amp;/g, "&"));
      if (
        url.protocol === "https:" &&
        !url.username &&
        IMAGE_HOSTS.some((host) =>
          host.startsWith(".")
            ? url.hostname.endsWith(host)
            : url.hostname === host,
        )
      )
        return url.toString().slice(0, 2048);
    } catch {
      // Ignore relative or malformed artwork.
    }
  }
  return null;
}

function plainText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|lt|gt|quot|apos|#39|nbsp);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&#39;": "'",
          "&nbsp;": " ",
        })[entity] ?? entity,
    )
    .replace(/\s+/g, " ")
    .trim();
}
