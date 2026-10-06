import { useEffect, useMemo, useState } from "react";
import { Select, Spin } from "antd";
import { listManagerOptions } from "../../../services/api/employeesApi";
import type { ManagerOption } from "../../../services/api/employeesApi";
import { isApiError } from "../../../services/api/apiTypes";
import { toSearchParam } from "../../../utils/searchInput";
import { useI18n } from "../../../i18n/useI18n";

const SEARCH_DEBOUNCE_MS = 350;
const OPTIONS_PAGE_SIZE = 20;

type PickerOption = { value: number; label: string };

/** Full name (in the UI language when available) plus the employee number. */
function formatManagerOptionLabel(
  option: ManagerOption,
  language: string,
): string {
  const localized =
    language === "ar" ? option.full_name_ar : option.full_name_en;
  const name =
    localized || option.full_name_en || option.full_name || option.employee_id;
  return option.employee_id && option.employee_id !== name
    ? `${name} (${option.employee_id})`
    : name;
}

export interface ManagerSelectProps {
  /** Injected by Form.Item. */
  id?: string;
  value?: number | null;
  onChange?: (value: number | null) => void;
  /** Employee being edited, so they and their reports are never offered. */
  employeeProfileId?: number | string | null;
  /** Name of the currently saved manager, shown before any search runs. */
  selectedLabel?: string | null;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Searchable single-manager picker backed by `GET /api/employees/manager-options/`.
 * Options are fetched on first open and re-fetched (debounced) as HR types; the
 * server does the filtering and pagination.
 */
export default function ManagerSelect({
  id,
  value,
  onChange,
  employeeProfileId = null,
  selectedLabel = null,
  placeholder,
  disabled,
}: ManagerSelectProps) {
  const { t, language } = useI18n();
  const [activated, setActivated] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ManagerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<PickerOption | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => setQuery(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!activated) return;
    let cancelled = false;
    setLoading(true);
    listManagerOptions({
      search: toSearchParam(query),
      employee_profile_id: employeeProfileId ?? undefined,
      page_size: OPTIONS_PAGE_SIZE,
    })
      .then((response) => {
        if (cancelled) return;
        setItems(
          !isApiError(response) && Array.isArray(response.data?.items)
            ? response.data.items
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activated, query, employeeProfileId]);

  const options = useMemo<PickerOption[]>(() => {
    const fetched = items.map((item) => ({
      value: item.id,
      label: formatManagerOptionLabel(item, language),
    }));
    if (value == null || fetched.some((option) => option.value === value)) {
      return fetched;
    }
    // Keep the chosen manager's label when the current page does not list them.
    const label =
      picked?.value === value ? picked.label : selectedLabel || `#${value}`;
    return [{ value, label }, ...fetched];
  }, [items, language, value, picked, selectedLabel]);

  return (
    <Select<number | null, PickerOption>
      id={id}
      size="large"
      showSearch
      allowClear
      filterOption={false}
      disabled={disabled}
      placeholder={placeholder ?? t("employees.form.managerPlaceholder")}
      value={value ?? undefined}
      options={options}
      loading={loading}
      notFoundContent={
        loading ? <Spin size="small" /> : t("employees.form.managerNoResults")
      }
      searchValue={searchInput}
      onSearch={(text) => {
        setActivated(true);
        setSearchInput(text);
      }}
      onOpenChange={(open) => {
        if (open) {
          setActivated(true);
        } else if (searchInput) {
          // Picking an option clears the typed text without calling onSearch;
          // reset so the next open starts from the full list.
          setSearchInput("");
        }
      }}
      onChange={(next, option) => {
        const chosen = Array.isArray(option) ? undefined : option;
        setPicked(
          chosen && next != null
            ? { value: Number(next), label: String(chosen.label) }
            : null,
        );
        setSearchInput("");
        onChange?.(next == null ? null : Number(next));
      }}
    />
  );
}
