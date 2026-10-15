import { listRunItems } from "../../services/api/payrollApi";
import { isManualInformation } from "./validationGroups";
import type {
  PayrollRunItemDto,
  ValidationReport,
} from "../../services/api/payrollTypes";

export const INDEX_LIMIT = 1000;
export class IncompletePayrollIndex extends Error {}

/** StandardPagination has no finite API maximum. Request the UI's hard cap,
 * honor the returned page size, and never retain an oversized/partial index. */
export async function readPayrollIndex(runId: number | string) {
  const first = await listRunItems(runId, { page: 1, page_size: INDEX_LIMIT });
  if (first.count > INDEX_LIMIT)
    return { limited: true, items: [] as PayrollRunItemDto[] };
  const items = [...first.items];
  for (let page = 2; page <= first.total_pages; page++) {
    const next = await listRunItems(runId, { page, page_size: INDEX_LIMIT });
    if (
      next.count !== first.count ||
      items.length + next.items.length > INDEX_LIMIT
    )
      throw new IncompletePayrollIndex();
    items.push(...next.items);
  }
  if (
    items.length !== first.count ||
    new Set(items.map((item) => item.id)).size !== first.count ||
    new Set(items.map((item) => item.run_revision)).size > 1
  )
    throw new IncompletePayrollIndex();
  return { limited: false, items };
}

export function needsConfirmation(item: PayrollRunItemDto) {
  return (
    !item.executive_exempt &&
    !item.absence.manual_confirmed &&
    (item.absence.manual_confirmation_required ||
      !item.absence.source_available)
  );
}

export function itemStatus(
  item: PayrollRunItemDto,
  report: ValidationReport | null,
) {
  if (!report) return "unavailable";
  if (report.errors.some((issue) => issue.employee?.item_id === item.id))
    return "blocking";
  if (
    report.warnings.some(
      (issue) =>
        issue.employee?.item_id === item.id &&
        !isManualInformation(issue, [item]),
    ) ||
    item.warnings.some((issue) => !isManualInformation(issue, [item]))
  )
    return "warning";
  return "clear";
}

export const DEFAULT_COLUMNS = {
  salary: true,
  additions: true,
  deductions: true,
  provisions: false,
  details: false,
};
export type PayrollColumns = typeof DEFAULT_COLUMNS;
export function readColumns(key: string): PayrollColumns {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved && typeof saved === "object")
      return Object.fromEntries(
        Object.entries(DEFAULT_COLUMNS).map(([name, value]) => [
          name,
          typeof (saved as Record<string, unknown>)[name] === "boolean"
            ? (saved as Record<string, boolean>)[name]
            : value,
        ]),
      ) as PayrollColumns;
  } catch {
    /* Storage is optional. */
  }
  return { ...DEFAULT_COLUMNS };
}
export function writeColumns(key: string, columns: PayrollColumns) {
  try {
    localStorage.setItem(key, JSON.stringify(columns));
  } catch {
    /* Storage is optional. */
  }
}
