import { describe, expect, it } from "vitest";
import {
  loadMessages,
  localeOptions,
  normalizeLocale,
  type LocaleCode,
  type Messages,
} from "../src/i18n";

async function allMessages() {
  return Object.fromEntries(
    await Promise.all(
      localeOptions.map(async (option) => [
        option.code,
        await loadMessages(option.code),
      ]),
    ),
  ) as Record<LocaleCode, Messages>;
}

function walkMessageTree(
  base: unknown,
  other: unknown,
  path: string[],
  visit: (base: string, other: unknown, path: string[]) => void,
) {
  if (typeof base === "string") {
    visit(base, other, path);
    return;
  }

  if (Array.isArray(base)) {
    base.forEach((entry, index) =>
      walkMessageTree(
        entry,
        Array.isArray(other) ? other[index] : undefined,
        [...path, String(index)],
        visit,
      ),
    );
    return;
  }

  if (base && typeof base === "object") {
    Object.entries(base).forEach(([key, value]) =>
      walkMessageTree(
        value,
        other && typeof other === "object"
          ? (other as Record<string, unknown>)[key]
          : undefined,
        [...path, key],
        visit,
      ),
    );
  }
}

function placeholders(value: string) {
  return Array.from(value.matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g))
    .map((match) => match[0])
    .sort();
}

describe("i18n messages", () => {
  it("uses English as the public fallback locale", () => {
    expect(normalizeLocale(null)).toBe("en");
    expect(normalizeLocale("unknown-locale")).toBe("en");
  });

  it("keeps all locale message trees complete and interpolatable", async () => {
    const messages = await allMessages();
    for (const option of localeOptions) {
      const localized = messages[option.code];

      walkMessageTree(messages.en, localized, [], (base, other, path) => {
        expect(typeof other, path.join(".")).toBe("string");
        expect(placeholders(other as string), path.join(".")).toEqual(
          placeholders(base),
        );
      });
    }
  });

  it("does not include translation-generator artifacts", async () => {
    const messages = await allMessages();
    for (const option of localeOptions) {
      walkMessageTree(
        messages.en,
        messages[option.code],
        [],
        (_, other, path) => {
          expect(other, path.join(".")).not.toContain("() =>");
          expect(other, path.join(".")).not.toMatch(/\u27e6|\u27e7/);
        },
      );
    }
  });

  it("does not silently fall back to English for whole locale sections", async () => {
    const messages = await allMessages();
    const allowedInvariantCopy = new Set([
      "SteamBee",
      "Steam",
      "SteamID",
      "AppID",
      "Cmd+C",
      "QR",
      "0 h",
      "Info",
      "Preset",
      "Presets",
      "Logs",
      "Online",
      "System",
      "OK",
      "Webhook",
      "Active",
    ]);

    for (const option of localeOptions) {
      if (option.code === "de" || option.code === "en") continue;

      const identical: string[] = [];
      walkMessageTree(
        messages.en,
        messages[option.code],
        [],
        (base, other, path) => {
          if (
            base === other &&
            !allowedInvariantCopy.has(base) &&
            !/^[-0-9.: h]+$/.test(base)
          ) {
            identical.push(`${path.join(".")}: ${base}`);
          }
        },
      );

      expect(
        identical.length,
        `${option.code}: ${identical.join(", ")}`,
      ).toBeLessThan(10);
    }
  });
});
