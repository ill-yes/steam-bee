import type { FreeGameOffer } from "@steam-bee/contracts";

const storeOrigin = "https://store.steampowered.com";
const maxResponseBytes = 2_000_000;
const pageSize = 100;
const maxPages = 3;

export type StoreOffers = {
  offers: FreeGameOffer[];
  truncated: boolean;
};

/** Only individual apps with a genuine 100% discount qualify, never permanent F2P. */
export function parseFreeGameOffers(html: string): FreeGameOffer[] {
  const offers = new Map<number, FreeGameOffer>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = match[1]!;
    const body = match[2]!;
    if (
      !/\bclass\s*=\s*["'][^"']*\bsearch_result_row\b[^"']*["']/i.test(
        attributes,
      )
    )
      continue;
    const appIdText = attribute(attributes, "data-ds-appid");
    if (!appIdText || !/^\d+$/.test(appIdText)) continue;
    const appId = Number(appIdText);
    if (!Number.isSafeInteger(appId) || appId < 1 || appId > 2_147_483_647)
      continue;
    const href = attribute(attributes, "href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(decodeEntities(href));
    } catch {
      continue;
    }
    if (
      url.origin !== storeOrigin ||
      !new RegExp(`^/app/${appId}(?:/|$)`).test(url.pathname)
    )
      continue;
    if (classContent(body, "discount_pct")?.trim() !== "-100%") continue;
    // Original paid price prevents permanent free games from passing on a zero final price.
    const originalPrice = classContent(body, "discount_original_price");
    if (!originalPrice || !/[1-9]/.test(originalPrice)) continue;
    const finalPrice = body.match(
      /\bdata-price-final\s*=\s*["'](\d+)["']/i,
    )?.[1];
    if (finalPrice !== "0") continue;
    const name = classContent(body, "title")?.trim();
    if (!name || name.length > 300) continue;
    offers.set(appId, {
      appId,
      name,
      storeUrl: `${storeOrigin}/app/${appId}/`,
    });
  }
  return [...offers.values()];
}

export async function fetchFreeGameOffers(
  fetcher: typeof fetch = fetch,
): Promise<StoreOffers> {
  const offers = new Map<number, FreeGameOffer>();
  let truncated = false;
  // One deadline covers all pages and streamed bodies, including a slow upstream.
  const signal = AbortSignal.timeout(15_000);
  for (let page = 0; page < maxPages; page++) {
    const url = new URL("/search/results/", storeOrigin);
    url.search = new URLSearchParams({
      start: String(page * pageSize),
      count: String(pageSize),
      maxprice: "free",
      specials: "1",
      category1: "998",
      l: "english",
      cc: "us",
      infinite: "1",
      ndl: "1",
    }).toString();
    const response = await fetcher(url, {
      signal,
      redirect: "error",
      credentials: "omit",
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`Steam store responded with HTTP ${response.status}.`);
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Steam store returned an unexpected content type.");
    }
    const payload: unknown = JSON.parse(await boundedBody(response));
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("success" in payload) ||
      payload.success !== 1 ||
      !("results_html" in payload) ||
      typeof payload.results_html !== "string" ||
      !("total_count" in payload) ||
      typeof payload.total_count !== "number" ||
      !Number.isSafeInteger(payload.total_count) ||
      payload.total_count < 0
    )
      throw new Error("Steam store returned an invalid search response.");
    if (
      payload.total_count > 0 &&
      !/\bsearch_result_row\b/.test(payload.results_html)
    ) {
      throw new Error("Steam store search results could not be read.");
    }
    for (const offer of parseFreeGameOffers(payload.results_html))
      offers.set(offer.appId, offer);
    if ((page + 1) * pageSize >= payload.total_count) break;
    truncated = page === maxPages - 1;
  }
  return { offers: [...offers.values()], truncated };
}

async function boundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxResponseBytes)
    throw new Error("Steam store response is too large.");
  if (!response.body)
    throw new Error("Steam store returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxResponseBytes)
        throw new Error("Steam store response is too large.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function attribute(attributes: string, name: string) {
  return attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"),
  )?.[1];
}

function classContent(html: string, name: string) {
  const match = html.match(
    new RegExp(
      `<([a-z][a-z0-9]*)\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1\\s*>`,
      "i",
    ),
  );
  return match ? decodeEntities(stripTags(match[2]!)).trim() : null;
}

/** Removes tags until none are left, so nested fragments cannot form a new tag. */
function stripTags(html: string) {
  let text = html;
  for (let previous = ""; text !== previous;) {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text.replace(/</g, "");
}

function decodeEntities(text: string) {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (raw, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? raw;
      const code =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : raw;
    },
  );
}
