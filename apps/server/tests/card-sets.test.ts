import { describe, expect, it, vi } from "vitest";
import {
  CardSetService,
  parseGameCardsPage,
} from "../src/inventory/card-sets.js";

const card = (
  state: "owned" | "unowned",
  name: string,
  index: number,
  quantity?: number,
) => `
<div class="badge_card_set_card ${state}">
  <div class="game_card_ctn with_zoom">
    <img class="gamecard" src="https://community.cloudflare.steamstatic.com/economy/image/card-${index}/96fx96f">
  </div>
  <div class="badge_card_set_text ellipsis">
    ${quantity === undefined ? "" : `<div class="badge_card_set_text_qty">(${quantity})</div>`}
    ${name}
  </div>
  <div class="badge_card_set_text game_card_set_detail">${index} of 4, Series 1</div>
</div>`;

const page = (cards: string, extra = "") => `
<html><script>g_steamID = "76561198000000000";</script>
<div class="badge_gamecard_page">
  <div class="badge_info_description">
    <div class="badge_info_title">Wanderer</div>
    <div>Level 2, 200 XP</div>
  </div>
  <div class="badge_title_stats_drops"><span class="progress_info_bold">3 card drops remaining</span></div>
  ${extra}
  <div class="badge_card_set_cards">${cards}</div>
</div></html>`;

describe("Steam game card pages", () => {
  it("parses owned quantities, missing cards, artwork, level and drops", () => {
    const set = parseGameCardsPage(
      page(
        card("owned", "The Knight", 1, 3) +
          card("owned", "Hornet &amp; Co", 2) +
          card("unowned", "Zote", 3) +
          card("unowned", "Grimm", 4),
      ),
      367520,
      1_000,
    );
    expect(set).toEqual({
      appId: 367520,
      badgeLevel: 2,
      remainingDrops: 3,
      fetchedAt: 1_000,
      cards: [
        {
          name: "The Knight",
          owned: 3,
          imageUrl:
            "https://community.cloudflare.steamstatic.com/economy/image/card-1/96fx96f",
        },
        {
          name: "Hornet & Co",
          owned: 1,
          imageUrl:
            "https://community.cloudflare.steamstatic.com/economy/image/card-2/96fx96f",
        },
        expect.objectContaining({ name: "Zote", owned: 0 }),
        expect.objectContaining({ name: "Grimm", owned: 0 }),
      ],
    });
  });

  it("treats no remaining drops and an unlevelled badge explicitly", () => {
    const set = parseGameCardsPage(
      page(card("unowned", "Zote", 1))
        .replace("3 card drops remaining", "No card drops remaining")
        .replace("Level 2, 200 XP", ""),
      10,
    );
    expect(set.remainingDrops).toBe(0);
    expect(set.badgeLevel).toBe(0);
  });

  it("drops artwork from untrusted hosts and rejects unknown or signed-out pages", () => {
    const set = parseGameCardsPage(
      page(card("owned", "Zote", 1, 2)).replace(
        "https://community.cloudflare.steamstatic.com",
        "https://evil.example",
      ),
      10,
    );
    expect(set.cards[0]).toEqual({ name: "Zote", owned: 2, imageUrl: null });
    expect(() => parseGameCardsPage("<html>nothing</html>", 10)).toThrow(
      /recognizable/,
    );
    expect(() =>
      parseGameCardsPage('<script>g_steamID = "0";</script>', 10),
    ).toThrow(/sign-in/);
  });
});

describe("card set service", () => {
  it("requests the account's English game card page once and caches it briefly", async () => {
    let now = 5_000;
    const request = vi.fn(
      async () =>
        new Response(page(card("owned", "Zote", 1, 2)), { status: 200 }),
    );
    const service = new CardSetService({
      request,
      steamId: () => "76561198000000000",
      now: () => now,
    });
    const [first, second] = await Promise.all([
      service.get("account", 10),
      service.get("account", 10),
    ]);
    expect(first).toBe(second);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "account",
      "/profiles/76561198000000000/gamecards/10/?l=english",
    );
    now += 9 * 60_000;
    await service.get("account", 10);
    expect(request).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await service.get("account", 10);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports Steam failures without caching them", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    const service = new CardSetService({
      request,
      steamId: () => "76561198000000000",
    });
    await expect(service.get("account", 10)).rejects.toMatchObject({
      statusCode: 502,
    });
    await expect(service.get("account", 10)).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringMatching(/recognizable/),
    });
    await expect(
      new CardSetService({ request, steamId: () => "0" }).get("account", 10),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
