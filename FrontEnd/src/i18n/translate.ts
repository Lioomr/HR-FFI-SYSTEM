import { useI18nStore } from "./i18nStore";
import { translations } from "./translations";
import type { AppLanguage } from "./types";

export type TranslateParams = Record<string, any> | string;

export function resolveTranslation(
  language: AppLanguage,
  key: string,
  params?: TranslateParams,
  fallback?: string,
) {
  const actualFallback = typeof params === "string" ? params : fallback;
  const actualParams = typeof params === "object" ? params : undefined;

  let translated = translations[language]?.[key] ?? actualFallback ?? key;

  if (actualParams) {
    Object.entries(actualParams).forEach(([k, v]) => {
      translated = translated.replace(new RegExp(`{${k}}`, "g"), String(v));
    });
  }

  return translated;
}

/**
 * Non-hook translator for code that runs outside React components
 * (API error helpers). Reads the active language at call time.
 */
export function translate(
  key: string,
  params?: TranslateParams,
  fallback?: string,
) {
  return resolveTranslation(
    useI18nStore.getState().language,
    key,
    params,
    fallback,
  );
}
