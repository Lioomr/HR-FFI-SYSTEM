import { Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useI18n } from "../../i18n/useI18n";
import MoneyText from "./MoneyText";
import { SOURCE_LABEL_KEYS, qty } from "./payrollItemEditorShared";
import type {
  PayrollMoneyLine,
  ProvisionLine,
  SalaryComponentLine,
} from "../../services/api/payrollTypes";

const { Text } = Typography;

export function usePayrollItemColumns() {
  const { t } = useI18n();
  const lineLabel = (line: {
    type: string;
    label: string;
    label_key: string;
  }) => line.label || t(line.label_key) || line.type;

  const salaryColumns: ColumnsType<SalaryComponentLine> = [
    {
      title: t("payroll.ui.line"),
      key: "label",
      render: (_, line) => lineLabel(line),
    },
    {
      title: t("payroll.ui.amount"),
      key: "amount",
      align: "end",
      render: (_, line) => <MoneyText amount={line.amount} />,
    },
  ];

  const moneyLineColumns: ColumnsType<PayrollMoneyLine> = [
    {
      title: t("payroll.ui.line"),
      key: "label",
      render: (_, line) => (
        <Space size={4} wrap>
          {lineLabel(line)}
          <Text type="secondary">
            {t(SOURCE_LABEL_KEYS[line.source_kind])}
            {line.source_id ? ` · ${line.source_id}` : ""}
          </Text>
          {line.carried_in && <Tag>{t("payroll.ui.carriedIn")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("payroll.ui.quantity"),
      key: "quantity",
      render: (_, line) => qty(line.quantity),
    },
    {
      title: t("payroll.ui.requested"),
      key: "requested",
      align: "end",
      render: (_, line) => (
        <MoneyText amount={line.requested_amount ?? line.amount} />
      ),
    },
    {
      title: t("payroll.ui.collected"),
      key: "collected",
      align: "end",
      render: (_, line) => (
        <MoneyText amount={line.collected_amount ?? line.amount} />
      ),
    },
    {
      title: t("payroll.ui.uncollected"),
      key: "uncollected",
      align: "end",
      render: (_, line) =>
        line.uncollected_amount && line.uncollected_amount !== "0.00" ? (
          <MoneyText amount={line.uncollected_amount} />
        ) : (
          "—"
        ),
    },
  ];

  const provisionColumns: ColumnsType<ProvisionLine> = [
    {
      title: t("payroll.ui.line"),
      key: "label",
      render: (_, line) => lineLabel(line),
    },
    {
      title: t("payroll.ui.amount"),
      key: "amount",
      align: "end",
      render: (_, line) => <MoneyText amount={line.amount} />,
    },
  ];
  return { salaryColumns, moneyLineColumns, provisionColumns };
}
