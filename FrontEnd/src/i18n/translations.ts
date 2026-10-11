import en from "./translations.en";
import ar from "./translations.ar";
import type { AppLanguage, TranslationMap } from "./types";

// Both languages in one object, for tests and tooling that compare them. App
// code must not import this file: it would pull both languages into the
// entry bundle. The app loads one language at a time through translate.ts.
export const translations: Record<AppLanguage, TranslationMap> = { en, ar };
