import { useI18n } from "../i18n/useI18n";

export default function NotFound404Page() {
  const { t } = useI18n();
  return (
    <div style={{ padding: 24 }}>
      <h1>{t("error.notFound.title")}</h1>
      <p>{t("error.notFound.desc")}</p>
    </div>
  );
}
