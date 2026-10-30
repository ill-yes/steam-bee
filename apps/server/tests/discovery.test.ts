import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFreeGameOffers,
  parseFreeGameOffers,
} from "../src/discovery/steam-store.js";
import { createFreeGamesService } from "../src/discovery/service.js";

function row(
  id = "42",
  overrides: {
    discount?: string;
    original?: string;
    final?: string;
    href?: string;
    name?: string;
  } = {},
) {
  return `<a class="search_result_row ds_collapse_flag" data-ds-appid="${id}" href="${overrides.href ?? `https://store.steampowered.com/app/${id}/Game/?snr=tracking`}">
    <span class="title">${overrides.name ?? "A &amp; B &#x1F41D;"}</span><div data-price-final="${overrides.final ?? "0"}">
    <div class="discount_pct">${overrides.discount ?? "-100%"}</div><div class="discount_original_price">${overrides.original ?? "$9.99"}</div></div></a>`;
}
const offer = {
  appId: 42,
  name: "A & B 🐝",
  storeUrl: "https://store.steampowered.com/app/42/",
};
const searchResponse = (html: string, total = 1) =>
  new Response(
    JSON.stringify({ success: 1, total_count: total, results_html: html }),
    { headers: { "content-type": "application/json" } },
  );

describe("Steam free offer discovery", () => {
  it("parses and deduplicates real individual 100% discounts, decoding text safely", () => {
    expect(parseFreeGameOffers(row() + row())).toEqual([offer]);
    expect(
      parseFreeGameOffers(
        row("9", { name: "&lt;img src=x onerror=alert(1)&gt;" }),
      )?.[0]?.name,
    ).toBe("<img src=x onerror=alert(1)>");
    expect(
      parseFreeGameOffers(row("10", { name: "Game <<b>script>x" }))?.[0]?.name,
    ).toBe("Game script>x");
  });

  it("excludes F2P, partial discounts, paid offers, bundles and untrusted destinations", () => {
    expect(
      parseFreeGameOffers(
        [
          row("1", { discount: "", original: "Free To Play" }),
          row("2", { discount: "-90%" }),
          row("3", { final: "99" }),
          row("4", { original: "$0.00" }),
          row("5,6"),
          row("7", { href: "https://store.steampowered.com/sub/7/" }),
          row("8", { href: "https://store.steampowered.com.evil.test/app/8/" }),
          row("9", { href: "http://store.steampowered.com/app/9/" }),
          row("10", { href: "https://store.steampowered.com/app/100/" }),
          row("2147483648"),
        ].join(""),
      ),
    ).toEqual([]);
  });

  it("bounds requests to three fixed-host public pages and strips upstream tracking", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => searchResponse(row(), 500));
    const result = await fetchFreeGameOffers(fetcher);
    expect(result).toEqual({ offers: [offer], truncated: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toMatch(
        /^https:\/\/store\.steampowered\.com\/search\/results\//,
      );
      expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(
      new URL(String(fetcher.mock.calls[2]![0])).searchParams.get("start"),
    ).toBe("200");
  });

  it("accepts an empty search and rejects malformed, changed and oversized responses", async () => {
    expect(
      await fetchFreeGameOffers(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(searchResponse("<!-- empty -->", 0)),
      ),
    ).toEqual({ offers: [], truncated: false });
    for (const response of [
      new Response("unavailable", { status: 503 }),
      new Response("<html>login</html>", {
        headers: { "content-type": "text/html" },
      }),
      new Response('{"success":0}', {
        headers: { "content-type": "application/json" },
      }),
      searchResponse("changed markup", 1),
      new Response("x".repeat(2_000_001), {
        headers: { "content-type": "application/json" },
      }),
    ])
      await expect(
        fetchFreeGameOffers(vi.fn<typeof fetch>().mockResolvedValue(response)),
      ).rejects.toThrow();
  });
});

describe("shared offer cache", () => {
  let time = 10_000;
  beforeEach(() => {
    time = 10_000;
  });
  it("deduplicates concurrent requests and reuses the ten-minute snapshot", async () => {
    const load = vi
      .fn()
      .mockResolvedValue({ offers: [offer], truncated: false });
    const service = createFreeGamesService(load, () => time);
    const values = await Promise.all([
      service.getOffers(),
      service.getOffers(),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(values[0]).toEqual({
      offers: [offer],
      checkedAt: time,
      truncated: false,
      stale: false,
    });
    time += 599_999;
    await service.getOffers();
    expect(load).toHaveBeenCalledTimes(1);
    time += 2;
    await service.getOffers();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("labels stale fallback, backs off failures and refuses snapshots older than six hours", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ offers: [offer], truncated: false })
      .mockRejectedValue(new Error("offline"));
    const service = createFreeGamesService(load, () => time);
    await service.getOffers();
    time += 600_001;
    expect((await service.getOffers()).stale).toBe(true);
    expect((await service.getOffers()).stale).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    time += 6 * 60 * 60_000;
    await expect(service.getOffers()).rejects.toMatchObject({
      statusCode: 502,
      code: "INTERNAL_ERROR",
    });
  });
});
