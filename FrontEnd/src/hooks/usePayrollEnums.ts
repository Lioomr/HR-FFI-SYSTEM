import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { getPayrollEnums } from "../services/api/payrollSettingsApi";
import type { EnumOption, PayrollEnums } from "../services/api/payrollTypes";

/**
 * Loads the payroll enum directory once per language and resolves labels.
 * Label order: the API's own `label` (already in the request language), then
 * the frontend translation of the contract key, then the raw value.
 */
export function usePayrollEnums() {
  const { t, language } = useI18n();
  const [enums, setEnums] = useState<PayrollEnums | null>(null);

  useEffect(() => {
    let active = true;
    getPayrollEnums()
      .then((data) => {
        if (active) setEnums(data);
      })
      .catch(() => {
        // Labels fall back to frontend keys; the page still works.
        if (active) setEnums(null);
      });
    return () => {
      active = false;
    };
  }, [language]);

  const label = useCallback(
    (group: keyof PayrollEnums, value: string, fallbackKey?: string) => {
      const options = (enums?.[group] ?? []) as EnumOption[];
      const option = options.find((entry) => entry.value === value);
      if (option?.label) return option.label;
      const key = option?.label_key ?? fallbackKey;
      if (key) {
        const translated = t(key);
        if (translated !== key) return translated;
      }
      return value;
    },
    [enums, t],
  );

  return { enums, label };
}
