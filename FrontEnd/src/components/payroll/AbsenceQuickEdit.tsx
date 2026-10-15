import { useState } from "react";
import { Button, Input, Select, Typography } from "antd";
import type { InputRef } from "antd";
import { useI18n } from "../../i18n/useI18n";
import {
  isNonNegativeDecimal,
  toQuantityString,
} from "../../utils/payrollMoney";
import type { PayrollRunItemDto } from "../../services/api/payrollTypes";

export default function AbsenceQuickEdit({
  item,
  disabled,
  saving,
  inputRef,
  onSave,
}: {
  item: PayrollRunItemDto;
  disabled: boolean;
  saving: boolean;
  inputRef: (input: InputRef | null) => void;
  onSave: (days: string, reason: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [days, setDays] = useState("");
  const [preset, setPreset] = useState<string>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (disabled || saving) return;
    if (!days.trim() || !isNonNegativeDecimal(days)) {
      setError(t("payroll.ui.invalidAmount"));
      return;
    }
    const selectedReason =
      preset === "other"
        ? reason.trim()
        : preset
          ? t(`payroll.ux.reason.${preset}`)
          : "";
    if (!selectedReason || selectedReason.length > 2000) {
      setError(t("payroll.ui.reasonRequired"));
      return;
    }
    setError(undefined);
    await onSave(toQuantityString(days), selectedReason);
  };
  return (
    <div
      className="payroll-quick-edit"
      onClick={(event) => event.stopPropagation()}
    >
      <Input
        ref={inputRef}
        size="small"
        style={{ width: 64 }}
        value={days}
        inputMode="decimal"
        disabled={disabled}
        aria-label={t("payroll.ux.absenceFor", { name: item.employee_name })}
        aria-invalid={!!error}
        aria-describedby={error ? `absence-error-${item.id}` : undefined}
        placeholder="—"
        onChange={(event) => setDays(event.target.value)}
        onPressEnter={() => void submit()}
      />
      {days.trim() && (
        <Select
          size="small"
          style={{ flex: 1, minWidth: 112 }}
          disabled={disabled}
          value={preset}
          aria-label={t("payroll.ux.reasonFor", { name: item.employee_name })}
          placeholder={t("payroll.ui.reasonLabel")}
          onChange={setPreset}
          options={["reviewed", "confirmed", "other"].map((value) => ({
            value,
            label: t(`payroll.ux.reason.${value}`),
          }))}
        />
      )}
      <Button
        size="small"
        disabled={disabled}
        loading={saving}
        onClick={() => void submit()}
        aria-label={t("payroll.ux.saveFor", { name: item.employee_name })}
      >
        {t("common.save")}
      </Button>
      {days.trim() && preset === "other" && (
        <Input
          size="small"
          value={reason}
          disabled={disabled}
          maxLength={2000}
          aria-label={t("payroll.ux.customReasonFor", {
            name: item.employee_name,
          })}
          placeholder={t("payroll.ui.reasonLabel")}
          onChange={(event) => setReason(event.target.value)}
          onPressEnter={() => void submit()}
        />
      )}
      {error && (
        <Typography.Text
          id={`absence-error-${item.id}`}
          type="danger"
          role="alert"
          style={{ fontSize: 12 }}
        >
          {error}
        </Typography.Text>
      )}
    </div>
  );
}
