import { useMemo } from "react";
import { useI18nStore } from "./i18nStore";
import { translations } from "./translations";

export function useI18n() {
  const language = useI18nStore((s) => s.language);
  const direction = useI18nStore((s) => s.direction);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const toggleLanguage = useI18nStore((s) => s.toggleLanguage);

  const t = useMemo(
    () =>
      (
        key: string,
        params?: Record<string, any> | string,
        fallback?: string,
      ) => {
        const actualFallback = typeof params === "string" ? params : fallback;
        const actualParams = typeof params === "object" ? params : undefined;

        let translated = translations[language]?.[key] ?? actualFallback ?? key;

        if (actualParams) {
          Object.entries(actualParams).forEach(([k, v]) => {
            translated = translated.replace(
              new RegExp(`{${k}}`, "g"),
              String(v),
            );
          });
        }

        return translated;
      },
    [language],
  );

  return { language, direction, setLanguage, toggleLanguage, t };
}
