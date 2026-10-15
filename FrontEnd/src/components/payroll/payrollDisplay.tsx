import { Tag } from "antd";
import { useI18n } from "../../i18n/useI18n";
import { usePayrollEnums } from "../../hooks/usePayrollEnums";
import type { PayrollStatus } from "../../services/api/payrollTypes";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "gold",
  COMPLETED: "blue",
  PAID: "green",
  CANCELLED: "default",
};

/** Run/payslip status with the API label (fallback: payroll.status.<lowercase>). */
export function PayrollStatusTag({
  status,
}: {
  status: PayrollStatus | string;
}) {
  const { label } = usePayrollEnums();
  return (
    <Tag color={STATUS_COLORS[status] ?? "default"}>
      {label("run_status", status, `payroll.status.${status.toLowerCase()}`)}
    </Tag>
  );
}

/** Localised "Unknown" tag used wherever a payroll value is null. */
export function UnknownTag() {
  const { t } = useI18n();
  return <Tag color="gold">{t("payroll.ui.unknown")}</Tag>;
}
