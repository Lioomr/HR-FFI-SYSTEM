import { useEffect, useMemo, useState } from "react";
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import { useI18n } from "../../i18n/useI18n";

const SEARCH_DEBOUNCE_MS = 350;
const OPTIONS_PAGE_SIZE = 50;

export type EmployeeOption = { value: number; label: string };

/**
 * Searchable employee options for the active company. `value` is the employee
 * profile id; the employees list is already scoped by the active company header.
 * `withCode: false` labels options by name only (the search still matches codes).
 */
export function useEmployeeOptions({
  enabled = true,
  withCode = true,
}: { enabled?: boolean; withCode?: boolean } = {}) {
  const { language } = useI18n();
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setQuery(queryInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    listEmployees({ search: query || undefined, page_size: OPTIONS_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        const results =
          response.status === "success" && Array.isArray(response.data?.results)
            ? response.data.results
            : [];
        setEmployees(results);
      })
      .catch(() => {
        if (!cancelled) setEmployees([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, query]);

  const options = useMemo<EmployeeOption[]>(
    () =>
      employees.map((employee) => {
        const localized =
          language === "ar" ? employee.full_name_ar : employee.full_name_en;
        const name =
          localized ||
          employee.full_name_en ||
          employee.full_name ||
          employee.email;
        return {
          value: employee.id,
          label: withCode
            ? `${employee.employee_number || employee.employee_id} - ${name}`
            : name,
        };
      }),
    [employees, language, withCode],
  );

  return { options, loading, onSearch: setQueryInput };
}
