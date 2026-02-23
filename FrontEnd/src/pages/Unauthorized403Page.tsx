import { useI18n } from "../i18n/useI18n";

export default function Unauthorized403Page() {
  const { t } = useI18n();
  return (
    <div style={{ padding: 24 }}>
      <h1>{t("error.unauthorized.title")}</h1>
      <p>{t("error.unauthorized.desc")}</p>
    </div>
  );
}
