export type CardValue = { average: number; text: string };

const maxBodyBytes = 2 * 1024 * 1024;

/** Steam's market search for one game's normal (non-foil) trading cards. */
export function cardSearchPath(appId: number) {
  const query = new URLSearchParams({
    norender: "1",
    appid: "753",
    "category_753_Game[]": `tag_app_${appId}`,
    "category_753_item_class[]": "tag_item_class_2",
    "category_753_cardborder[]": "tag_cardborder_0",
    count: "30",
    l: "english",
  });
  return `/market/search/render/?${query}`;
}

/**
 * Reads a price text such as "0,12€", "$0.08" or "CDN$ 1.05" into its amount
 * and the symbol around it. The last separator is the decimal separator.
 */
export function parsePriceText(text: string) {
  const match = text.match(/^(\D*?)\s*([\d.,\s]*\d)\s*(\D*)$/);
  if (!match) return null;
  const digits = match[2]!.replace(/\s/g, "");
  const lastSeparator = Math.max(
    digits.lastIndexOf(","),
    digits.lastIndexOf("."),
  );
  const decimals =
    lastSeparator >= 0 && digits.length - lastSeparator - 1 <= 2
      ? digits.slice(lastSeparator + 1)
      : "";
  const whole = (decimals ? digits.slice(0, lastSeparator) : digits).replace(
    /[.,]/g,
    "",
  );
  const amount = Number(`${whole}.${decimals || "0"}`);
  if (!Number.isFinite(amount)) return null;
  return {
    amount,
    prefix: match[1]!.trim(),
    suffix: match[3]!.trim(),
    decimals: decimals.length,
    separator: decimals ? digits[lastSeparator]! : ".",
  };
}

/**
 * The average listed price of a game's normal cards, formatted in the
 * currency Steam used for this session. `average` is only comparable between
 * games read through the same session.
 */
export function cardValueFromSearch(body: unknown): CardValue | null {
  if (!body || typeof body !== "object") return null;
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const prices = results
    .map((result) =>
      result && typeof result === "object"
        ? (result as { sell_price_text?: unknown }).sell_price_text
        : null,
    )
    .filter((text): text is string => typeof text === "string")
    .map(parsePriceText)
    .filter(
      (price): price is NonNullable<ReturnType<typeof parsePriceText>> =>
        price !== null && price.amount > 0,
    );
  if (prices.length === 0) return null;
  const first = prices[0]!;
  const average =
    prices.reduce((total, price) => total + price.amount, 0) / prices.length;
  const decimals = Math.max(2, first.decimals);
  const amount = average.toFixed(decimals).replace(".", first.separator);
  return {
    average,
    text: [first.prefix, amount, first.suffix]
      .filter(Boolean)
      .join(first.prefix && first.prefix.length > 1 ? " " : ""),
  };
}

export async function readCardValueResponse(response: Response) {
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > maxBodyBytes) return null;
  try {
    return cardValueFromSearch(JSON.parse(text));
  } catch {
    return null;
  }
}
