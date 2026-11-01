import { describe, expect, it } from "vitest";
import { loadMessages, localeOptions, type Messages } from "../src/i18n";
import { automationCopy } from "../src/features/accounts/detail/automationCopy";
import { hubCopy } from "../src/features/accounts/detail/hubCopy";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe.each([
  ["hub", hubCopy],
  ["automation", automationCopy],
] as const)("%s copy", (_name, copyFor: (messages: Messages) => object) => {
  it.each(localeOptions.map((option) => option.code))(
    "translates every string for %s and keeps its placeholders",
    async (locale) => {
      const english = copyFor(await loadMessages("en")) as Record<
        string,
        string
      >;
      const copy = copyFor(await loadMessages(locale)) as Record<
        string,
        string
      >;
      if (locale !== "en") expect(copy).not.toBe(english);
      expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
      for (const [key, text] of Object.entries(english)) {
        expect(copy[key]?.trim(), `${locale}.${key}`).toBeTruthy();
        expect(placeholders(copy[key]!), `${locale}.${key}`).toEqual(
          placeholders(text),
        );
      }
    },
  );
});
