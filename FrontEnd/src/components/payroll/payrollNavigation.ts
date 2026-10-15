import type {
  PayrollRunItemDto,
  ValidationReport,
} from "../../services/api/payrollTypes";
import {
  itemStatus,
  needsConfirmation,
  type PayrollColumns,
} from "./payrollIndex";

export interface PayrollListState {
  page: number;
  pageSize: number;
  search: string;
  hasWarnings?: boolean;
  attention: boolean;
  status: string;
  columns?: PayrollColumns;
  scroll: number;
}
export interface PayrollEmployeeSession {
  list?: PayrollListState;
  order?: number[];
  listSearch?: string;
}
export function filterPayrollItems(
  items: PayrollRunItemDto[],
  report: ValidationReport | null,
  filters: Pick<
    PayrollListState,
    "search" | "hasWarnings" | "attention" | "status"
  >,
) {
  return items.filter((item) => {
    const status = itemStatus(item, report);
    return (
      (!filters.search ||
        `${item.employee_name} ${item.employee_id}`
          .toLocaleLowerCase()
          .includes(filters.search.toLocaleLowerCase())) &&
      (filters.hasWarnings === undefined ||
        Boolean(item.warnings.length) === filters.hasWarnings) &&
      (!filters.attention ||
        status === "blocking" ||
        status === "warning" ||
        needsConfirmation(item)) &&
      (filters.status === "all" ||
        (filters.status === "confirmation"
          ? needsConfirmation(item)
          : status === filters.status))
    );
  });
}
export function employeePath(runId: string | number, itemId: string | number) {
  return `/hr/payroll/${runId}/employees/${itemId}`;
}
export function legacyEmployeePath(runId: string, search: string) {
  const params = new URLSearchParams(search);
  const item = params.get("item");
  if (!item || !/^\d+$/.test(item)) return null;
  params.delete("item");
  return employeePath(runId, item) + (params.size ? `?${params}` : "");
}
