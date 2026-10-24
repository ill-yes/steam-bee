import type { InventoryCategory, InventoryItem } from "@steam-bee/contracts";

type Description = Record<string, unknown>;
const categories: Record<string, InventoryCategory> = {
  item_class_2: "card",
  item_class_3: "background",
  item_class_4: "emoticon",
  item_class_5: "booster",
  item_class_10: "sale",
};
function appId(value: unknown): number | null {
  const result =
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value))
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(result) && result > 0 && result <= 0xffffffff
    ? result
    : null;
}
/** Classification comes from Steam's internal tags, never from translated item names. */
export function inventoryMetadata(
  description: Description,
): Pick<
  InventoryItem,
  "gameAppId" | "gameName" | "gameIconUrl" | "category" | "cardKind"
> {
  const tags = (Array.isArray(description.tags) ? description.tags : []).filter(
    (tag): tag is Record<string, unknown> =>
      typeof tag === "object" && tag !== null && !Array.isArray(tag),
  );
  const game = tags.find(
    (tag) =>
      tag.category === "Game" &&
      typeof tag.internal_name === "string" &&
      /^app_\d+$/.test(tag.internal_name),
  );
  const gameAppId =
    appId(
      typeof game?.internal_name === "string"
        ? game.internal_name.slice(4)
        : null,
    ) ?? appId(description.market_fee_app);
  const gameName =
    gameAppId !== null && typeof game?.localized_tag_name === "string"
      ? game.localized_tag_name.slice(0, 256)
      : null;
  const kind = tags.find((tag) => tag.category === "item_class");
  const category =
    typeof kind?.internal_name === "string"
      ? (categories[kind.internal_name] ?? "other")
      : "other";
  const border = tags.find((tag) => tag.category === "cardborder");
  return {
    gameAppId,
    gameName,
    gameIconUrl:
      gameAppId !== null
        ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${gameAppId}/header.jpg`
        : null,
    category,
    cardKind:
      category === "card"
        ? border?.internal_name === "cardborder_1"
          ? "foil"
          : border?.internal_name === "cardborder_0"
            ? "normal"
            : null
        : null,
  };
}
