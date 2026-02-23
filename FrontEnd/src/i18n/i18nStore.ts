import { create } from "zustand";
import type { AppLanguage, Direction } from "./types";

const STORAGE_KEY = "ffi_app_language";

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

export const useI18nStore = create<I18nState>((set) => {
  const initialLanguage = resolveInitialLanguage();

  return {
    language: initialLanguage,
    direction: initialLanguage === "ar" ? "rtl" : "ltr",
    setLanguage: (language) => {
      localStorage.setItem(STORAGE_KEY, language);
      set({ language, direction: language === "ar" ? "rtl" : "ltr" });
    },
    toggleLanguage: () =>
      set((state) => {
        const nextLanguage: AppLanguage = state.language === "en" ? "ar" : "en";
        localStorage.setItem(STORAGE_KEY, nextLanguage);
        return { language: nextLanguage, direction: nextLanguage === "ar" ? "rtl" : "ltr" };
      }),
  };
});
