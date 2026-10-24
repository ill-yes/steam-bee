import { MAX_STEAM_APP_ID, type FarmingGame } from "@steam-bee/contracts";

export const MAX_BADGE_PAGES = 20;
export const MAX_BADGE_GAMES = 1_000;
export const MAX_BADGE_PAGE_BYTES = 2_000_000;

/** Steam is requested in English; unmatched rows are never assumed to have drops. */
export function parseBadgePage(html: string): {
  games: FarmingGame[];
  pageCount: number;
} {
  if (Buffer.byteLength(html, "utf8") > MAX_BADGE_PAGE_BYTES) {
    throw new Error("Steam returned an oversized badge page.");
  }
  if (/g_steamID\s*=\s*["']0["']|<form[^>]+id=["']login_form/i.test(html)) {
    throw new Error("Steam Community sign-in is required.");
  }
  if (!/\bbadges_sheet\b|\bbadge_row\b|\bbadge_empty\b/i.test(html)) {
    throw new Error("Steam did not return a recognizable badge page.");
  }
  const starts = [
    ...html.matchAll(
      /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bbadge_row\b[^"']*["'][^>]*>/gi,
    ),
  ];
  const games: FarmingGame[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const row = html.slice(
      starts[index]!.index,
      starts[index + 1]?.index ?? html.length,
    );
    const appId = Number(
      row.match(/\bhref\s*=\s*["'][^"']*\/gamecards\/(\d+)(?:[/?#"'])/i)?.[1],
    );
    const text = plainText(row);
    const remainingDrops = Number(
      text.match(/\b(\d+)\s+card drops? remaining\b/i)?.[1],
    );
    if (
      !Number.isSafeInteger(appId) ||
      appId <= 0 ||
      appId > MAX_STEAM_APP_ID ||
      !Number.isSafeInteger(remainingDrops) ||
      remainingDrops <= 0 ||
      remainingDrops > 100
    )
      continue;
    const name = plainText(
      row.match(
        /<div\b[^>]*class=["'][^"']*\bbadge_title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      )?.[1] ?? "",
    )
      .replace(/\s*\d[\d,.]*\s*(?:hrs?|hours?) on record.*$/i, "")
      .trim();
    const hours = text.match(
      /\b([\d,]+(?:\.\d+)?)\s*(?:hrs?|hours?) on record\b/i,
    )?.[1];
    // Badge hours are rounded by Steam. Use a lower bound so "2.0 hrs"
    // never proves that the account has crossed the 120-minute refund limit.
    const normalizedHours = hours?.replace(/,/g, "");
    const precision = normalizedHours?.includes(".")
      ? 10 ** -(normalizedHours.split(".")[1]?.length ?? 0)
      : 1;
    const minutes =
      normalizedHours === undefined
        ? null
        : Math.max(
            0,
            Math.floor((Number(normalizedHours) - precision) * 60 + 1e-7),
          );
    games.push({
      appId,
      name: name.slice(0, 256) || `App ${appId}`,
      remainingDrops,
      playtimeMinutes:
        minutes !== null && Number.isFinite(minutes) ? minutes : null,
      acquiredAt: null,
      skipReason: null,
    });
  }
  const pages = [...html.matchAll(/[?&](?:amp;)?p=(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  return {
    games,
    pageCount: Math.max(
      1,
      ...pages.filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  };
}

export function enrichBadgeGames(
  games: FarmingGame[],
  library: Array<{
    appId: number;
    name: string;
    playtimeMinutes: number | null;
  }>,
) {
  const byId = new Map(library.map((game) => [game.appId, game]));
  for (const game of games) {
    const entry = byId.get(game.appId);
    if (!entry) continue;
    game.name = entry.name;
    game.playtimeMinutes = Math.max(
      game.playtimeMinutes ?? 0,
      entry.playtimeMinutes ?? 0,
    );
  }
}

export async function discoverBadgeDrops(
  requestPage: (page: number) => Promise<string>,
): Promise<{ games: FarmingGame[]; truncated: boolean }> {
  const games = new Map<number, FarmingGame>();
  let pageCount = 1;
  let truncated = false;
  for (let page = 1; page <= Math.min(pageCount, MAX_BADGE_PAGES); page += 1) {
    const parsed = parseBadgePage(await requestPage(page));
    pageCount = Math.max(pageCount, parsed.pageCount);
    truncated ||= pageCount > MAX_BADGE_PAGES;
    for (const game of parsed.games) {
      if (games.size >= MAX_BADGE_GAMES && !games.has(game.appId)) {
        truncated = true;
        continue;
      }
      games.set(game.appId, game);
    }
  }
  return { games: [...games.values()], truncated };
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
