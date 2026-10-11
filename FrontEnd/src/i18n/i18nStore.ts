import { create } from "zustand";
import { STORAGE_KEYS } from "../utils/storageKeys";
import { getTranslations, loadTranslations } from "./translationLoader";
import type { AppLanguage, Direction } from "./types";

const STORAGE_KEY = STORAGE_KEYS.appLanguage;

const resolveInitialLanguage = (): AppLanguage => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "ar" ? "ar" : "en";
};

type I18nState = {
  language: AppLanguage;
  direction: Direction;
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
};

export const useI18nStore = create<I18nState>((set, get) => {
  const initialLanguage = resolveInitialLanguage();

  return {
    language: initialLanguage,
    direction: initialLanguage === "ar" ? "rtl" : "ltr",
    setLanguage: (language) => {
      const apply = () => {
        localStorage.setItem(STORAGE_KEY, language);
        set({ language, direction: language === "ar" ? "rtl" : "ltr" });
      };
      // Switch only once the strings exist, so the UI never flashes raw keys.
      if (getTranslations(language)) apply();
      else void loadTranslations(language).then(apply);
    },
    toggleLanguage: () =>
      get().setLanguage(get().language === "en" ? "ar" : "en"),
  };
});
