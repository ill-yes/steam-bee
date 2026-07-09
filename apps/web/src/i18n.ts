import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const localeOptions = [
  {
    code: "de",
    label: "Deutsch",
    nativeLabel: "Deutsch",
    dateLocale: "de-DE",
    dir: "ltr",
    isTopTen: false,
  },
  {
    code: "en",
    label: "English",
    nativeLabel: "English",
    dateLocale: "en-US",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "zh-Hans",
    label: "Chinese (Mandarin)",
    nativeLabel: "中文",
    dateLocale: "zh-CN",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "hi",
    label: "Hindi",
    nativeLabel: "हिन्दी",
    dateLocale: "hi-IN",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "es",
    label: "Spanish",
    nativeLabel: "Español",
    dateLocale: "es-ES",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "ar",
    label: "Standard Arabic",
    nativeLabel: "العربية",
    dateLocale: "ar",
    dir: "rtl",
    isTopTen: true,
  },
  {
    code: "fr",
    label: "French",
    nativeLabel: "Français",
    dateLocale: "fr-FR",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "bn",
    label: "Bengali",
    nativeLabel: "বাংলা",
    dateLocale: "bn-BD",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "pt",
    label: "Portuguese",
    nativeLabel: "Português",
    dateLocale: "pt-BR",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "id",
    label: "Indonesian",
    nativeLabel: "Bahasa Indonesia",
    dateLocale: "id-ID",
    dir: "ltr",
    isTopTen: true,
  },
  {
    code: "ur",
    label: "Urdu",
    nativeLabel: "اردو",
    dateLocale: "ur-PK",
    dir: "rtl",
    isTopTen: true,
  },
] as const;

export type LocaleCode = (typeof localeOptions)[number]["code"];
export type LocaleOption = (typeof localeOptions)[number];

const defaultLocale: LocaleCode = "en";
const storageKey = "steam-bee-locale";

import { en } from "./locales/en";
import type { DeepPartial, Messages } from "./locales/types";

export type { Messages } from "./locales/types";

const localeLoaders: Record<
  Exclude<LocaleCode, "en">,
  () => Promise<DeepPartial<Messages>>
> = {
  de: () => import("./locales/de").then((module) => module.default),
  "zh-Hans": () => import("./locales/zh-Hans").then((module) => module.default),
  hi: () => import("./locales/hi").then((module) => module.default),
  es: () => import("./locales/es").then((module) => module.default),
  ar: () => import("./locales/ar").then((module) => module.default),
  fr: () => import("./locales/fr").then((module) => module.default),
  bn: () => import("./locales/bn").then((module) => module.default),
  pt: () => import("./locales/pt").then((module) => module.default),
  id: () => import("./locales/id").then((module) => module.default),
  ur: () => import("./locales/ur").then((module) => module.default),
};
const localeCache = new Map<LocaleCode, Messages>([["en", en]]);

export const t = en;

type I18nContextValue = {
  locale: LocaleCode;
  localeInfo: LocaleOption;
  messages: Messages;
  setLocale: (locale: LocaleCode) => void;
};

const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  localeInfo: getLocaleInfo(defaultLocale),
  messages: en,
  setLocale: () => undefined,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(detectInitialLocale);
  const [localizedMessages, setLocalizedMessages] = useState<Messages>(en);
  const localeInfo = getLocaleInfo(locale);

  useEffect(() => {
    let current = true;
    setLocalizedMessages(localeCache.get(locale) ?? en);
    void loadMessages(locale).then((loaded) => {
      if (current) setLocalizedMessages(loaded);
    });
    return () => {
      current = false;
    };
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = localeInfo.code;
    document.documentElement.dir = localeInfo.dir;
  }, [localeInfo]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeInfo,
      messages: localizedMessages,
      setLocale: (nextLocale) => {
        const normalized = normalizeLocale(nextLocale);
        setLocaleState(normalized);
        try {
          window.localStorage.setItem(storageKey, normalized);
        } catch {
          // The in-memory locale still changes when storage is unavailable.
        }
      },
    }),
    [locale, localeInfo, localizedMessages],
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}

export async function loadMessages(locale: LocaleCode): Promise<Messages> {
  const cached = localeCache.get(locale);
  if (cached) return cached;
  if (locale === "en") return en;
  const partial = await localeLoaders[locale]();
  const loaded = mergeMessages(en, partial);
  localeCache.set(locale, loaded);
  return loaded;
}

export function getLocaleInfo(locale: LocaleCode) {
  return (
    localeOptions.find((option) => option.code === locale) ??
    localeOptions.find((option) => option.code === defaultLocale)!
  );
}

export function normalizeLocale(value: string | null | undefined): LocaleCode {
  if (!value) return defaultLocale;
  const exact = localeOptions.find((option) => option.code === value);
  if (exact) return exact.code;

  const lowerValue = value.toLowerCase();
  const language = lowerValue.split("-")[0];
  const matched = localeOptions.find(
    (option) =>
      option.code.toLowerCase() === lowerValue ||
      option.code.toLowerCase().split("-")[0] === language,
  );
  return matched?.code ?? defaultLocale;
}

export function interpolate(
  template: string,
  values: Record<string, string | number | null | undefined>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

function detectInitialLocale(): LocaleCode {
  if (typeof window === "undefined") return defaultLocale;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) return normalizeLocale(stored);
  } catch {
    // The English fallback remains available without storage.
  }
  return defaultLocale;
}

function mergeMessages<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return base;
  if (Array.isArray(base)) return (override as T) ?? base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }

  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? mergeMessages(baseValue, value as DeepPartial<typeof baseValue>)
        : value;
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
