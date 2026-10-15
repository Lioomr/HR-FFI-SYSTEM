import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import { payrollData, payrollRequest } from "./payrollTransport";
import type {
  AdditionLineType,
  DeductionLineType,
  EmployeePayslipDetail,
  EmployeePayslipLine,
  EmployeePayslipListEntry,
  PageParams,
  PayrollPage,
  SalaryComponentLine,
  SalaryLineType,
} from "./payrollTypes";

/**
 * Employee self-service payslips (contract section 7.6, DTO EP).
 *
 * Employee pages must render ONLY the EP whitelist. The parsers below copy the
 * allowed keys and line types one by one, so provisions, company cost,
 * carry-forward, settings or source IDs are dropped even if a payload ever
 * contains them.
 */

const SALARY_TYPES: readonly SalaryLineType[] = [
  "BASIC_SALARY",
  "ACCOMMODATION_ALLOWANCE",
  "TRANSPORTATION_ALLOWANCE",
  "TELEPHONE_ALLOWANCE",
  "PETROL_ALLOWANCE",
  "OTHER_ALLOWANCE",
];
const ADDITION_TYPES: readonly AdditionLineType[] = [
  "OVERTIME_NORMAL",
  "WEEKLY_REST_WORK",
  "OFFICIAL_HOLIDAY_WORK",
  "BONUS",
  "INCENTIVE",
  "OTHER_ADDITION",
];
const DEDUCTION_TYPES: readonly DeductionLineType[] = [
  "ABSENCE",
  "GOSI_EMPLOYEE",
  "ATTENDANCE_PENALTY",
  "PENALTY_FINE",
  "PENALTY_WAGE_WITHHOLDING",
  "LOAN",
  "OTHER_DEDUCTION",
  "PREVIOUS_TOTAL_DEDUCTIONS",
];

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const nullableStr = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const int = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) ? value : 0;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function pickSalaryLine(value: unknown): SalaryComponentLine | null {
  const raw = asRecord(value);
  const type = raw.type as SalaryLineType;
  if (!SALARY_TYPES.includes(type)) return null;
  return {
    type,
    label: str(raw.label),
    label_key: str(raw.label_key),
    amount: nullableStr(raw.amount),
  };
}

function pickMoneyLine<T extends AdditionLineType | DeductionLineType>(
  value: unknown,
  allowed: readonly T[],
): EmployeePayslipLine | null {
  const raw = asRecord(value);
  const type = raw.type as T;
  if (!allowed.includes(type)) return null;
  const period = asRecord(raw.source_period);
  return {
    type,
    label: str(raw.label),
    label_key: str(raw.label_key),
    amount: str(raw.amount),
    quantity: nullableStr(raw.quantity),
    source_period:
      raw.source_period && typeof raw.source_period === "object"
        ? { year: int(period.year), month: int(period.month) }
        : null,
  };
}

const notNull = <T>(value: T | null): value is T => value !== null;

/** Whitelists an employee payslip list entry `{id,year,month,net_salary,payment_mode,status}`. */
export function toEmployeePayslipListEntry(
  value: unknown,
): EmployeePayslipListEntry {
  const raw = asRecord(value);
  return {
    id: int(raw.id),
    year: int(raw.year),
    month: int(raw.month),
    net_salary: str(raw.net_salary),
    payment_mode: str(raw.payment_mode),
    status: str(raw.status),
  };
}

/** Whitelists an EP detail payload. Unknown keys and HR-only line types are dropped. */
export function toEmployeePayslipDetail(value: unknown): EmployeePayslipDetail {
  const raw = asRecord(value);
  return {
    ...toEmployeePayslipListEntry(raw),
    basic_salary: str(raw.basic_salary),
    transportation_allowance: str(raw.transportation_allowance),
    accommodation_allowance: str(raw.accommodation_allowance),
    telephone_allowance: str(raw.telephone_allowance),
    petrol_allowance: str(raw.petrol_allowance),
    other_allowance: str(raw.other_allowance),
    total_salary: str(raw.total_salary),
    total_deductions: str(raw.total_deductions),
    gross_salary: str(raw.gross_salary),
    total_additions: str(raw.total_additions),
    salary_components: list(raw.salary_components)
      .map(pickSalaryLine)
      .filter(notNull),
    additions: list(raw.additions)
      .map((line) => pickMoneyLine(line, ADDITION_TYPES))
      .filter(notNull),
    deductions: list(raw.deductions)
      .map((line) => pickMoneyLine(line, DEDUCTION_TYPES))
      .filter(notNull),
    legacy_calculation: raw.legacy_calculation === true,
  };
}

/** GET /employee/payslips/ -> whitelisted list entries. */
export async function listMyPayslips(
  query: PageParams & { year?: number } = {},
): Promise<PayrollPage<EmployeePayslipListEntry>> {
  const page = await payrollData<PayrollPage<unknown>>({
    method: "GET",
    url: "/employee/payslips/",
    params: { ...query },
  });
  return { ...page, items: page.items.map(toEmployeePayslipListEntry) };
}

/** GET /employee/payslips/{id}/ -> whitelisted EP. */
export async function getMyPayslipDetail(
  id: number | string,
): Promise<EmployeePayslipDetail> {
  const data = await payrollData<unknown>({
    method: "GET",
    url: `/employee/payslips/${id}/`,
  });
  return toEmployeePayslipDetail(data);
}

/** GET /employee/payslips/{id}/download/ -> PDF blob (web only). */
export function downloadMyPayslip(id: number | string): Promise<Blob> {
  return payrollRequest<Blob>({
    method: "GET",
    url: `/employee/payslips/${id}/download/`,
    responseType: "blob",
  });
}

// ─── Legacy API (kept until the payslip pages are reworked in F3) ───────────

/** @deprecated legacy shape; use EmployeePayslipDetail */
export interface EmployeePayslip {
  id: number;
  payroll_run_id?: number;
  month: number;
  year: number;
  basic_salary: string;
  transportation_allowance?: string;
  accommodation_allowance?: string;
  telephone_allowance?: string;
  petrol_allowance?: string;
  other_allowance?: string;
  total_allowances?: string;
  total_deductions: string;
  total_salary?: string;
  net_salary: string;
  payment_mode?: string;
  status: string;
  generated_at?: string;
}

export type PayslipListResponse = PaginatedResponse<EmployeePayslip>;

/** @deprecated use listMyPayslips */
export async function getMyPayslips(params?: {
  page?: number;
  page_size?: number;
  year?: number;
}): Promise<ApiResponse<PayslipListResponse>> {
  return {
    status: "success",
    data: await payrollData<PayslipListResponse>({
      method: "GET",
      url: "/employee/payslips/",
      params: { ...params },
    }),
  };
}

/** @deprecated use getMyPayslipDetail */
export async function getMyPayslip(
  id: string | number,
): Promise<ApiResponse<EmployeePayslip>> {
  return {
    status: "success",
    data: await payrollData<EmployeePayslip>({
      method: "GET",
      url: `/employee/payslips/${id}/`,
    }),
  };
}

/** @deprecated use downloadMyPayslip */
export function downloadMyPayslipPdf(id: string | number): Promise<Blob> {
  return downloadMyPayslip(id);
}
