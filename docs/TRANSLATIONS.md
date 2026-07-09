# Translations

English is SteamBee's canonical source and synchronous fallback locale. Every
other locale is loaded on demand from a separate browser chunk to keep the
initial application bundle small.

German and the remaining bundled languages are maintained as community
translations unless a release note explicitly states that a professional
language review was completed. Structural tests require each locale to match
the English message tree, preserve interpolation placeholders, and avoid
generator artifacts. Missing newly introduced copy falls back to English until
the corresponding community locale is updated.

When changing copy:

1. Update `apps/web/src/locales/en.ts` first.
2. Add the same keys to `apps/web/src/locales/de.ts` because it is a complete locale.
3. Update the relevant partial locale files where a reviewed translation is available.
4. Run `pnpm --filter @steam-bee/web test` and browser-check one left-to-right and one right-to-left locale.

Product names must use `SteamBee`. Technical slugs, package names, Compose
service names, volumes, and image paths remain `steam-bee`.
