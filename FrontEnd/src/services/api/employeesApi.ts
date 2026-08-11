import { api } from "./apiClient";
import type { ApiResponse, ApiSuccess, LeaveBalance } from "./apiTypes";
export type { LeaveBalance };

export type EmployeeArchiveReason =
  | "FIRED"
  | "RESIGNED"
  | "RETIRED"
  | "END_OF_CONTRACT"
  | "DECEASED"
  | "OTHER";

/**
 * Employee data type
 */
export interface Employee {
  id: number;
  employee_id: string;
  user_id: number;
  // Legacy single-language field (kept for backward compat)
  full_name: string;
  // Bilingual fields
  full_name_en?: string;
  full_name_ar?: string;
  nationality_en?: string;
  nationality_ar?: string;
  job_title_en?: string;
  job_title_ar?: string;
  // Saudi / Foreign identification
  is_saudi?: boolean;
  // Data source tracking
  data_source?: "IMPORT_EXCEL" | "MANUAL";
  email: string;
  mobile?: string;
  passport?: string;
  department?: string;
  job_title?: string;
  position?: string;
  task_group?: string;
  sponsor?: string;
  company_id?: number;
  company_name?: string;
  employment_status?: "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "TERMINATED";
  is_archived: boolean;
  archived_at?: string | null;
  archived_by?: number | null;
  archived_by_name?: string | null;
  archive_reason?: EmployeeArchiveReason | null;
  hire_date?: string;
  department_id?: number;
  position_id?: number;
  task_group_id?: number;
  sponsor_id?: number;
  // Legacy manager (FK to User)
  manager_id?: number;
  manager_name?: string;
  // New manager profile (FK to EmployeeProfile)
  manager_profile_id?: number;
  manager_profile_name?: string;
  nationality?: string;
  employee_number?: string;
  passport_no?: string;
  passport_expiry?: string;
  passport_expiry_raw?: string;
  national_id?: string;
  id_expiry?: string;
  date_of_birth?: string;
  job_offer?: string;
  contract_date?: string;
  contract_expiry?: string;
  allowed_overtime?: number;
  health_card?: string;
  health_card_expiry?: string;
  work_license_expiry?: string;
  basic_salary?: number;
  transportation_allowance?: number;
  accommodation_allowance?: number;
  telephone_allowance?: number;
  petrol_allowance?: number;
  other_allowance?: number;
  total_salary?: number;
  created_at?: string;
  updated_at?: string;
  leave_balance_year?: number | null;
  leave_balances?: LeaveBalance[] | null;
}

/**
 * List employees query parameters
 */
export interface ListEmployeesParams {
  page?: number;
  page_size?: number;
  search?: string;
  department?: string;
  position?: string;
  task_group?: string;
  sponsor?: string;
  status?: string;
  nationality?: string;
  join_date_order?: "asc" | "desc";
  archive_state?: "active" | "archived" | "all";
}

export interface DelegationCandidate {
  id: number | null;
  employee_profile_id: number;
  employee_id: string;
  full_name: string;
  full_name_en?: string;
  full_name_ar?: string;
  email?: string | null;
  company_id?: number;
  company_name?: string;
  can_delegate: boolean;
  disabled_reason?: string;
}

/**
 * Paginated employee list response
 */
export interface EmployeeListResponse {
  results: Employee[];
  count: number;
  page?: number;
  page_size?: number;
}

/**
 * List all employees with optional filters
 */
export async function listEmployees(
  params?: ListEmployeesParams,
): Promise<ApiResponse<EmployeeListResponse>> {
  const { data } = await api.get<ApiResponse<EmployeeListResponse>>(
    "/employees",
    { params },
  );
  return data;
}

export async function listDelegationCandidates(params?: {
  scope?: "all";
}): Promise<ApiResponse<DelegationCandidate[]>> {
  const { data } = await api.get<ApiResponse<DelegationCandidate[]>>(
    "/api/employees/delegation-candidates/",
    {
      params,
    },
  );
  return data;
}

export async function exportEmployees(
  params?: ListEmployeesParams,
): Promise<Blob> {
  const response = await api.get("/employees/export", {
    params,
    responseType: "blob",
  });
  return response.data;
}

/**
 * Get a single employee by ID
 */
export async function getEmployee(
  id: string | number,
  params?: Record<string, string | number>,
): Promise<ApiResponse<Employee>> {
  const { data } = await api.get<ApiResponse<Employee>>(`/employees/${id}`, {
    params,
  });
  return data;
}

/**
 * Create employee payload (snake_case per API conventions)
 */
export interface CreateEmployeeDto {
  // Personal Info (bilingual)
  full_name_en: string; // English full name (primary)
  full_name_ar?: string; // Arabic full name
  is_saudi?: boolean; // Saudi citizen flag
  employee_number?: string;
  nationality?: string;
  passport_no?: string;
  passport_expiry?: string; // YYYY-MM-DD
  national_id?: string;
  id_expiry?: string; // YYYY-MM-DD
  date_of_birth?: string; // YYYY-MM-DD
  mobile?: string;

  // Employment Info
  department_id?: number;
  position_id?: number;
  task_group_id?: number;
  sponsor_id?: number;
  manager_profile_id?: number | null; // FK to EmployeeProfile
  job_offer?: string;
  join_date?: string; // YYYY-MM-DD
  contract_date?: string; // YYYY-MM-DD
  contract_expiry?: string; // YYYY-MM-DD
  allowed_overtime?: number;

  // Documents
  health_card?: string;
  health_card_expiry?: string; // YYYY-MM-DD
  work_license_expiry?: string; // YYYY-MM-DD

  // Salary & Allowances
  basic_salary?: number;
  transportation_allowance?: number;
  accommodation_allowance?: number;
  telephone_allowance?: number;
  petrol_allowance?: number;
  other_allowance?: number;
  total_salary?: number;
}

/**
 * Create a new employee
 */
export async function createEmployee(
  payload: CreateEmployeeDto,
): Promise<ApiResponse<Employee>> {
  const { data } = await api.post<ApiResponse<Employee>>("/employees", payload);
  return data;
}

/**
 * Update an existing employee
 */
export async function updateEmployee(
  id: string | number,
  payload: CreateEmployeeDto,
): Promise<ApiResponse<Employee>> {
  const { data } = await api.patch<ApiResponse<Employee>>(
    `/employees/${id}`,
    payload,
  );
  return data;
}

/**
 * Import Status: Aligning with Backend Enum
 */
export type ImportStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | string;

/**
 * Import Result Detail (Matches EmployeeImportSerializer)
 */
export interface ImportResult {
  id: string; // Backend 'id'
  status: ImportStatus;
  row_count: number; // Backend 'row_count'
  inserted_rows: number;
  created_at: string;
  uploader: string; // Email of uploader
  error_summary?: string[];
}

/**
 * Import History Item (Matches EmployeeImportSerializer)
 */
export interface ImportHistoryItem {
  id: string;
  status: ImportStatus;
  row_count: number;
  inserted_rows: number;
  created_at: string;
  uploader: string;
  error_summary?: string[];
}

/**
 * Upload employees Excel file
 * Endpoint: POST /employees/import/excel
 */
export async function importEmployees(
  file: File,
): Promise<ApiResponse<{ inserted_rows: number }>> {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await api.post<ApiResponse<{ inserted_rows: number }>>(
    "/employees/import/excel",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );
  return data;
}

/**
 * Get status of a specific import
 */
export async function getImportStatus(
  id: string,
): Promise<ApiResponse<ImportResult>> {
  const { data } = await api.get<ApiResponse<ImportResult>>(
    `/imports/employees/${id}`,
  );
  return data;
}

/**
 * Get import history
 */
export async function getImportHistory(params?: {
  page?: number;
  page_size?: number;
  status?: string;
  date_from?: string;
  date_to?: string;
}): Promise<
  ApiResponse<{
    items: ImportHistoryItem[];
    count: number;
    page?: number;
    page_size?: number;
    total_pages?: number;
  }>
> {
  const { data } = await api.get<
    ApiResponse<{
      items: ImportHistoryItem[];
      count: number;
      page?: number;
      page_size?: number;
      total_pages?: number;
    }>
  >("/imports/employees/history", { params });
  return data;
}

/**
 * Download error file as Blob (Authenticated)
 */
export async function downloadImportErrors(importId: string): Promise<Blob> {
  const response = await api.get(`/imports/employees/${importId}/errors-file`, {
    responseType: "blob",
  });
  return response.data;
}

/**
 * Download import template
 */
export async function downloadImportTemplate(): Promise<Blob> {
  const response = await api.get("/employees/import-template", {
    responseType: "blob",
  });
  return response.data;
}

export interface ExpiringDocumentItem {
  doc_type?:
    | "passport"
    | "id_card"
    | "health_card"
    | "contract"
    | "work_license";
  document_type?: "WORK_LICENSE";
  label: string;
  expiry_date: string | null;
  days_left: number;
}

export interface ExpiringEmployee {
  id: number;
  employee_id: string;
  full_name: string;
  linked_email: string | null;
  mobile: string | null;
  nearest_days_left: number;
  documents: ExpiringDocumentItem[];
  is_archived?: boolean;
}

export interface ExpiringEmployeesResponse {
  items: ExpiringEmployee[];
  page: number;
  page_size: number;
  count: number;
  total_pages: number;
}

export async function getExpiringEmployees(
  days = 30,
  page = 1,
  pageSize = 25,
): Promise<ApiResponse<ExpiringEmployeesResponse>> {
  const { data } = await api.get<ApiResponse<ExpiringEmployeesResponse>>(
    "/employees/expiries",
    {
      params: {
        days,
        page,
        page_size: pageSize,
      },
    },
  );
  return data;
}

export interface NotifyExpiryPayload {
  channels: Array<"email" | "whatsapp" | "announcement">;
  days?: number;
  message?: string;
}

export async function notifyExpiringEmployee(
  employeeProfileId: number,
  payload: NotifyExpiryPayload,
): Promise<ApiResponse<any>> {
  const { data } = await api.post<ApiResponse<any>>(
    `/employees/${employeeProfileId}/notify-expiry`,
    payload,
  );
  return data;
}

// ── Employee Archive Requests (CEO-approved; legacy route retained) ───────────

export type EmployeeArchiveStatus = "PENDING_CEO" | "REJECTED" | "EXECUTED";

export interface EmployeeArchiveRequestSnapshot {
  employee_profile_id?: number;
  target_user_id?: number;
  employee_id?: string;
  full_name?: string;
  full_name_en?: string;
  full_name_ar?: string;
  email?: string;
  company_id?: number;
  company_name?: string;
  employment_status?: string;
  department_id?: number;
  department_name?: string;
  position_id?: number;
  position_name?: string;
  open_leave_requests?: number;
  asset_assignments?: number;
  loan_requests?: number;
  target_user_email?: string;
}

export interface EmployeeArchiveRequest {
  id: number;
  company_id?: number;
  company_name?: string;
  employee_profile_id?: number;
  target_user_id?: number;
  reason: string;
  archive_reason: EmployeeArchiveReason;
  status: EmployeeArchiveStatus;
  request_snapshot: EmployeeArchiveRequestSnapshot;
  execution_snapshot: EmployeeArchiveRequestSnapshot;
  rejection_reason?: string;
  requested_by?: number;
  requested_by_name?: string;
  approved_by?: number | null;
  approved_by_name?: string | null;
  rejected_by?: number | null;
  rejected_by_name?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  executed_at?: string | null;
  created_at: string;
  updated_at: string;
  workflow?: {
    can_approve?: boolean;
    can_reject?: boolean;
    current_actor?: number | null;
    [k: string]: unknown;
  };
}

export interface ListEmployeeArchiveRequestsParams {
  status?: EmployeeArchiveStatus;
  page?: number;
  page_size?: number;
}

// StandardPagination shape: { items, page, page_size, count, total_pages }
// (the unpaginated fallback uses { results, count } — both supported below)
export interface EmployeeArchiveRequestListResponse {
  items: EmployeeArchiveRequest[];
  page?: number;
  page_size?: number;
  count: number;
  total_pages?: number;
}

// The backend route remains unchanged for existing clients.
const ARCHIVE_REQUEST_BASE = "/api/employees/deletion-requests";

export async function requestEmployeeArchive(payload: {
  employee_profile_id: number;
  archive_reason: EmployeeArchiveReason;
  reason: string;
}): Promise<ApiResponse<EmployeeArchiveRequest>> {
  const { data } = await api.post<ApiResponse<EmployeeArchiveRequest>>(
    `${ARCHIVE_REQUEST_BASE}/`,
    payload,
  );
  return data;
}

export async function listEmployeeArchiveRequests(
  params?: ListEmployeeArchiveRequestsParams,
): Promise<ApiResponse<EmployeeArchiveRequestListResponse>> {
  const { data } = await api.get<ApiResponse<any>>(`${ARCHIVE_REQUEST_BASE}/`, {
    params,
  });
  if (data && (data as ApiResponse<any>).status === "success") {
    const payload = (data as ApiSuccess<any>).data || {};
    const items: EmployeeArchiveRequest[] = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.results)
        ? payload.results
        : [];
    const normalized: EmployeeArchiveRequestListResponse = {
      items,
      count: typeof payload.count === "number" ? payload.count : items.length,
      page: payload.page,
      page_size: payload.page_size,
      total_pages: payload.total_pages,
    };
    return { status: "success", data: normalized };
  }
  return data as ApiResponse<EmployeeArchiveRequestListResponse>;
}

export async function getEmployeeArchiveRequest(
  id: number | string,
): Promise<ApiResponse<EmployeeArchiveRequest>> {
  const { data } = await api.get<ApiResponse<EmployeeArchiveRequest>>(
    `${ARCHIVE_REQUEST_BASE}/${id}/`,
  );
  return data;
}

export async function approveEmployeeArchiveRequest(
  id: number | string,
): Promise<ApiResponse<EmployeeArchiveRequest>> {
  const { data } = await api.post<ApiResponse<EmployeeArchiveRequest>>(
    `${ARCHIVE_REQUEST_BASE}/${id}/approve/`,
  );
  return data;
}

/**
 * Un-archives an employee and re-enables the linked account.
 * Restricted to SystemAdmin/HRManager server-side; returns the refreshed profile.
 * Uses the `/api/employees/*` family (see plans/API Route Status Matrix.md), the
 * same prefix as the archive-request endpoints above.
 */
export async function restoreEmployee(
  id: number | string,
): Promise<ApiResponse<Employee>> {
  const { data } = await api.post<ApiResponse<Employee>>(
    `/api/employees/${id}/restore/`,
  );
  return data;
}

// ── Employee Document Archive ─────────────────────────────────────────────────

export type DocumentType = "IQAMA" | "PASSPORT" | "VISA" | "SAUDI_ID" | "OTHER";
export type ExtractionStatus = "pending" | "success" | "partial" | "failed";

export interface EmployeeDocument {
  id: number;
  employee_profile_id: number;
  company_id?: number;
  leave_request?: number | null;
  document_type: DocumentType;
  custom_name?: string | null;
  display_name: string;
  original_filename: string;
  visa_number?: string | null;
  exit_before?: string | null;
  exit_before_raw?: string | null;
  visa_duration?: string | null;
  visa_duration_raw?: string | null;
  extracted_fields?: Record<string, unknown> | null;
  extraction_status: ExtractionStatus;
  extraction_error?: string | null;
  extraction_warnings?: string[] | null;
  uploaded_by?: number | null;
  uploaded_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadEmployeeDocumentPayload {
  document_type: DocumentType;
  file: File;
  custom_name?: string;
}

export async function getEmployeeDocuments(
  employeeId: number | string,
): Promise<ApiResponse<EmployeeDocument[]>> {
  const { data } = await api.get<ApiResponse<EmployeeDocument[]>>(
    `/api/employees/${employeeId}/documents/`,
  );
  return data;
}

export async function uploadEmployeeDocument(
  employeeId: number | string,
  payload: UploadEmployeeDocumentPayload,
): Promise<ApiResponse<EmployeeDocument>> {
  const form = new FormData();
  form.append("document_type", payload.document_type);
  form.append("file", payload.file);
  if (payload.custom_name) form.append("custom_name", payload.custom_name);
  const { data } = await api.post<ApiResponse<EmployeeDocument>>(
    `/api/employees/${employeeId}/documents/`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function patchEmployeeDocument(
  employeeId: number | string,
  documentId: number | string,
  payload: Partial<Pick<EmployeeDocument, "document_type" | "custom_name">>,
): Promise<ApiResponse<EmployeeDocument>> {
  const { data } = await api.patch<ApiResponse<EmployeeDocument>>(
    `/api/employees/${employeeId}/documents/${documentId}/`,
    payload,
  );
  return data;
}

export async function extractEmployeeDocument(
  employeeId: number | string,
  documentId: number | string,
): Promise<ApiResponse<EmployeeDocument>> {
  const { data } = await api.post<ApiResponse<EmployeeDocument>>(
    `/api/employees/${employeeId}/documents/${documentId}/extract/`,
  );
  return data;
}

export async function downloadEmployeeDocument(
  employeeId: number | string,
  documentId: number | string,
): Promise<Blob> {
  const { data } = await api.get(
    `/api/employees/${employeeId}/documents/${documentId}/download/`,
    { responseType: "blob" },
  );
  return data;
}

export interface NotifyDocumentExpiryDelivery {
  sent: boolean;
  success: boolean;
  provider?: string | null;
  status_code?: number | null;
  message_id?: string | null;
  error?: string | null;
  template_key?: string | null;
}

export interface NotifyDocumentExpiryResult {
  document: {
    id: number;
    document_type: string;
    display_name: string;
    expiry_date: string;
    days_left: number;
  };
  delivery: NotifyDocumentExpiryDelivery;
}

/**
 * Send a WhatsApp expiry reminder for a single employee document.
 * Backend allows expired documents or documents expiring within 45 days.
 */
export async function notifyEmployeeDocumentExpiry(
  employeeId: number | string,
  documentId: number | string,
): Promise<ApiResponse<NotifyDocumentExpiryResult>> {
  const { data } = await api.post<ApiResponse<NotifyDocumentExpiryResult>>(
    `/api/employees/${employeeId}/documents/${documentId}/notify-expiry/`,
  );
  return data;
}

export async function rejectEmployeeArchiveRequest(
  id: number | string,
  reason: string,
): Promise<ApiResponse<EmployeeArchiveRequest>> {
  const { data } = await api.post<ApiResponse<EmployeeArchiveRequest>>(
    `${ARCHIVE_REQUEST_BASE}/${id}/reject/`,
    { reason },
  );
  return data;
}
