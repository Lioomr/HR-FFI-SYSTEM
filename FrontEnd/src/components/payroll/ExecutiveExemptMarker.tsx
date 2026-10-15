import { Tooltip, Typography } from "antd";
import { useI18n } from "../../i18n/useI18n";

export default function ExecutiveExemptMarker() {
  const { t } = useI18n();
  return (
    <Tooltip title={t("payroll.ux.executiveExemptHelp")}>
      <Typography.Text
        type="secondary"
        tabIndex={0}
        style={{ display: "block", fontSize: 12 }}
      >
        {t("payroll.ux.executiveExempt")}
      </Typography.Text>
    </Tooltip>
  );
}
