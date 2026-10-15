import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Space, Switch, Typography } from "antd";
import { HistoryOutlined } from "@ant-design/icons";
import ReasonModal from "../../../../components/payroll/ReasonModal";
import StaleRevisionAlert from "../../../../components/payroll/StaleRevisionAlert";
import PayrollHistoryDrawer from "../../../../components/payroll/PayrollHistoryDrawer";
import { useI18n } from "../../../../i18n/useI18n";
import {
  getEmployeePayrollConfig,
  getEmployeePayrollConfigHistory,
  updateEmployeePayrollConfig,
} from "../../../../services/api/payrollSettingsApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../../services/api/payrollErrors";
import type { EmployeePayrollConfig } from "../../../../services/api/payrollTypes";

const { Text } = Typography;

/**
 * "Deduct GOSI from employee" flag for one employee (contract 7.1). The only
 * payroll control on the employee page: changing it needs a reason, sends the
 * employee-config revision, and affects existing runs only after a DRAFT
 * recalculation.
 */
export default function EmployeeGosiSetting({
  employeeProfileId,
}: {
  employeeProfileId: number | string;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<EmployeePayrollConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [reasonError, setReasonError] = useState<string>();
  const [modalError, setModalError] = useState<string>();
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setConfig(await getEmployeePayrollConfig(employeeProfileId));
    } catch (err) {
      setLoadError(
        payrollErrorSummary(
          parsePayrollError(err),
          t("payroll.ui.gosiFlagLoadFailed"),
        ),
      );
    }
  }, [employeeProfileId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHistory = useCallback(
    (page: number, pageSize: number) =>
      getEmployeePayrollConfigHistory(employeeProfileId, {
        page,
        page_size: pageSize,
      }),
    [employeeProfileId],
  );

  const submit = async (reason: string) => {
    if (!config || pendingValue === null) return;
    setSaving(true);
    setReasonError(undefined);
    setModalError(undefined);
    try {
      const saved = await updateEmployeePayrollConfig(employeeProfileId, {
        expected_revision: config.settings_revision,
        deduct_gosi_from_employee: pendingValue,
        reason,
      });
      setConfig(saved);
      setPendingValue(null);
      setStaleMessage(null);
    } catch (err) {
      const parsed = parsePayrollError(err);
      if (parsed.isStaleRevision) {
        setPendingValue(null);
        setStaleMessage(
          parsed.formMessages[0] ??
            parsed.message ??
            t("payroll.ui.staleTitle"),
        );
        await load();
        return;
      }
      const reasonField = parsed.fieldErrors.find(
        (entry) => entry.name[0] === "reason",
      );
      if (reasonField) setReasonError(reasonField.errors[0]);
      else
        setModalError(payrollErrorSummary(parsed, t("payroll.ui.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const title = t("payroll.ui.gosiFlagLabel");

  return (
    <section
      aria-label={title}
      style={{
        marginTop: 16,
        padding: 16,
        border: "1px solid #f0f0f0",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      {staleMessage && (
        <StaleRevisionAlert
          message={staleMessage}
          onClose={() => setStaleMessage(null)}
        />
      )}
      {loadError ? (
        <Alert
          type="warning"
          showIcon
          message={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              {t("payroll.ui.reload")}
            </Button>
          }
        />
      ) : (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Space align="start">
            <Switch
              checked={config?.deduct_gosi_from_employee ?? false}
              loading={!config || saving}
              disabled={!config}
              aria-label={title}
              onChange={(checked) => {
                setReasonError(undefined);
                setModalError(undefined);
                setPendingValue(checked);
              }}
            />
            <div>
              <Text strong>{title}</Text>
              <div>
                <Text type="secondary">{t("payroll.ui.gosiFlagHelp")}</Text>
              </div>
            </div>
          </Space>
          <Button
            icon={<HistoryOutlined />}
            onClick={() => setHistoryOpen(true)}
            disabled={!config}
          >
            {t("payroll.ui.history")}
          </Button>
        </div>
      )}

      <ReasonModal
        open={pendingValue !== null}
        title={
          pendingValue
            ? t("payroll.ui.gosiFlagEnableTitle")
            : t("payroll.ui.gosiFlagDisableTitle")
        }
        description={t("payroll.ui.gosiFlagChangeNote")}
        submitting={saving}
        reasonError={reasonError}
        formError={modalError}
        onSubmit={(reason) => void submit(reason)}
        onCancel={() => setPendingValue(null)}
      />

      <PayrollHistoryDrawer
        open={historyOpen}
        title={t("payroll.ui.gosiFlagHistoryTitle")}
        onClose={() => setHistoryOpen(false)}
        load={loadHistory}
      />
    </section>
  );
}
