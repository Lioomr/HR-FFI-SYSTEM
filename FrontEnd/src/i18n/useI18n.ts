import { useMemo } from "react";
import { useI18nStore } from "./i18nStore";
import { resolveTranslation, type TranslateParams } from "./translate";

export function useI18n() {
  const language = useI18nStore((s) => s.language);
  const direction = useI18nStore((s) => s.direction);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const toggleLanguage = useI18nStore((s) => s.toggleLanguage);

  const t = useMemo(
    () => (key: string, params?: TranslateParams, fallback?: string) =>
      resolveTranslation(language, key, params, fallback),
    [language],
  );

  return { language, direction, setLanguage, toggleLanguage, t };
}
