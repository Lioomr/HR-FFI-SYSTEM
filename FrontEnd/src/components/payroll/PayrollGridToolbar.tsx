import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  Select,
  Switch,
  Typography,
} from "antd";
import { useI18n } from "../../i18n/useI18n";
import type { PayrollColumns } from "./payrollIndex";

const { Text } = Typography;

export default function PayrollGridToolbar({
  limited,
  loading,
  hasReport,
  attention,
  status,
  hasWarnings,
  columnsState,
  onSearch,
  onAttentionChange,
  onStatusChange,
  onHasWarningsChange,
  onColumnChange,
}: {
  limited: boolean;
  loading: boolean;
  hasReport: boolean;
  attention: boolean;
  status: string;
  hasWarnings: boolean | undefined;
  columnsState: PayrollColumns;
  onSearch: (value: string) => void;
  onAttentionChange: (checked: boolean) => void;
  onStatusChange: (value: string) => void;
  onHasWarningsChange: (value: boolean | undefined) => void;
  onColumnChange: (key: keyof PayrollColumns, checked: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="payroll-grid-toolbar">
      <Input.Search
        allowClear
        placeholder={t("payroll.ui.searchEmployees")}
        aria-label={t("payroll.ui.searchEmployees")}
        style={{ width: 230 }}
        onSearch={onSearch}
      />
      <Checkbox
        disabled={limited || !hasReport || loading}
        checked={!limited && attention}
        onChange={(event) => onAttentionChange(event.target.checked)}
      >
        {t("payroll.ux.needsAttention")}
      </Checkbox>
      <Select
        aria-label={t("payroll.ux.statusFilter")}
        disabled={limited || !hasReport || loading}
        style={{ minWidth: 155 }}
        value={limited ? "all" : status}
        onChange={onStatusChange}
        options={["all", "blocking", "warning", "clear", "confirmation"].map(
          (value) => ({ value, label: t(`payroll.ux.status.${value}`) }),
        )}
      />
      <Select
        aria-label={t("payroll.ui.warningsFilter")}
        style={{ minWidth: 150 }}
        value={hasWarnings === undefined ? "all" : String(hasWarnings)}
        onChange={(value) =>
          onHasWarningsChange(value === "all" ? undefined : value === "true")
        }
        options={[
          { value: "all", label: t("payroll.ui.allEmployees") },
          { value: "true", label: t("payroll.ui.withWarnings") },
          { value: "false", label: t("payroll.ui.withoutWarnings") },
        ]}
      />
      <Dropdown
        trigger={["click"]}
        menu={{
          items: (
            [
              "salary",
              "additions",
              "deductions",
              "provisions",
              "details",
            ] as const
          ).map((key) => ({
            key,
            label: (
              <Checkbox
                checked={columnsState[key]}
                onChange={(event) => onColumnChange(key, event.target.checked)}
              >
                {t(`payroll.ux.columns.${key}`)}
              </Checkbox>
            ),
          })),
        }}
      >
        <Button>{t("payroll.ux.columns")}</Button>
      </Dropdown>
      <Switch
        size="small"
        checked={columnsState.provisions}
        onChange={(value) => onColumnChange("provisions", value)}
        aria-label={t("payroll.ui.showProvisions")}
      />
      <Text style={{ fontSize: 12 }}>{t("payroll.ui.showProvisions")}</Text>
    </div>
  );
}
