import type { AppLanguage, TranslationMap } from "./types";

// Each language lives in its own module so the entry bundle carries none of
// them. main.tsx awaits loadTranslations() for the saved language before the
// first render; switching language loads the other one on demand.
const loaded: Partial<Record<AppLanguage, TranslationMap>> = {};
const pending: Partial<Record<AppLanguage, Promise<void>>> = {};

const importers: Record<
  AppLanguage,
  () => Promise<{ default: TranslationMap }>
> = {
  en: () => import("./translations.en"),
  ar: () => import("./translations.ar"),
};

export function getTranslations(language: AppLanguage) {
  return loaded[language];
}

export function registerTranslations(
  language: AppLanguage,
  map: TranslationMap,
) {
  loaded[language] = map;
}

export function loadTranslations(language: AppLanguage): Promise<void> {
  if (loaded[language]) return Promise.resolve();
  pending[language] ??= importers[language]().then((module) => {
    loaded[language] = module.default;
  });
  return pending[language];
}
