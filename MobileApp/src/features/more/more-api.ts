import {
  apiClient,
  finiteNumberOrNull,
  identifierOrNull,
  integerOrNull,
  parseArray,
  parsePaginated,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';

import type {
  EmployeeDocumentSummary,
  EmployeeProfileSummary,
  PayslipDetail,
  PayslipSummary,
} from './types';

/**
 * Verified Gate 1 routes. `me` is accepted by the employee-document detail routes, so no
 * profile identifier has to be resolved or held by the client.
 */
export const PROFILE_PATH = '/api/employees/me/' as const;
export const DOCUMENTS_PATH = '/api/employees/me/documents/' as const;
export const PAYSLIPS_PATH = '/employee/payslips/' as const;

export const PAYSLIP_PAGE_SIZE = 24;

export function parseProfile(value: unknown): EmployeeProfileSummary {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    fullName:
      stringOrNull(item.full_name) ??
      stringOrNull(item.full_name_en) ??
      stringOrNull(item.full_name_ar),
    employeeNumber: stringOrNull(item.employee_number) ?? stringOrNull(item.employee_id),
    email: stringOrNull(item.email),
    mobile: stringOrNull(item.mobile),
    department: stringOrNull(item.department),
    position: stringOrNull(item.position) ?? stringOrNull(item.job_title),
    managerName: stringOrNull(item.manager_name),
    hireDate: stringOrNull(item.hire_date),
    contractExpiry: stringOrNull(item.contract_expiry),
    employmentStatus: stringOrNull(item.employment_status),
    companyName: stringOrNull(item.company_name),
    nationality: stringOrNull(item.nationality),
  };
}

export function parsePayslipSummary(value: unknown): PayslipSummary {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    year: integerOrNull(item.year),
    month: integerOrNull(item.month),
    netSalary: finiteNumberOrNull(item.net_salary),
    paymentMode: stringOrNull(item.payment_mode),
    status: stringOrNull(item.status),
  };
}

export function parsePayslipDetail(value: unknown): PayslipDetail {
  const item = record(value);
  return {
    ...parsePayslipSummary(item),
    basicSalary: finiteNumberOrNull(item.basic_salary),
    transportationAllowance: finiteNumberOrNull(item.transportation_allowance),
    accommodationAllowance: finiteNumberOrNull(item.accommodation_allowance),
    telephoneAllowance: finiteNumberOrNull(item.telephone_allowance),
    petrolAllowance: finiteNumberOrNull(item.petrol_allowance),
    otherAllowance: finiteNumberOrNull(item.other_allowance),
    totalSalary: finiteNumberOrNull(item.total_salary),
    totalDeductions: finiteNumberOrNull(item.total_deductions),
  };
}

/** `file` is write-only on the server, so no download URL is ever present or stored. */
export function parseDocument(value: unknown): EmployeeDocumentSummary {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    documentType: stringOrNull(item.document_type),
    displayName: stringOrNull(item.display_name) ?? stringOrNull(item.custom_name),
    originalFilename: stringOrNull(item.original_filename),
    expiresAt: stringOrNull(item.exit_before),
    createdAt: stringOrNull(item.created_at),
  };
}

export async function loadProfile(client: ApiClient = apiClient): Promise<EmployeeProfileSummary> {
  return parseProfile(await client.request<unknown>(PROFILE_PATH));
}

export async function loadPayslips(
  client: ApiClient = apiClient,
  pageSize = PAYSLIP_PAGE_SIZE,
): Promise<PayslipSummary[]> {
  const path = `${PAYSLIPS_PATH}?page=1&page_size=${pageSize}` as `/${string}`;
  return parsePaginated(await client.request<unknown>(path), parsePayslipSummary).items;
}

export async function loadPayslipDetail(
  payslipId: number | string,
  client: ApiClient = apiClient,
): Promise<PayslipDetail> {
  const path = `${PAYSLIPS_PATH}${encodeURIComponent(String(payslipId))}/` as `/${string}`;
  return parsePayslipDetail(await client.request<unknown>(path));
}

export async function loadDocuments(
  client: ApiClient = apiClient,
): Promise<EmployeeDocumentSummary[]> {
  return parseArray(await client.request<unknown>(DOCUMENTS_PATH), parseDocument);
}
