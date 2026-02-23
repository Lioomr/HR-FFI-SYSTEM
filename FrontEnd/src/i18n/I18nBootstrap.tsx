import { useEffect } from "react";
import { useI18n } from "./useI18n";

export default function I18nBootstrap() {
  const { language, direction } = useI18n();

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    document.body.dir = direction;
    document.body.classList.toggle("rtl", direction === "rtl");
    document.body.classList.toggle("ltr", direction === "ltr");
  }, [language, direction]);

  return null;
}
