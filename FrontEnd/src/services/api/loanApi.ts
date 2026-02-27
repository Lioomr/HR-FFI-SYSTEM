import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type LoanStatus =
  | "submitted"
  | "pending_manager"
  | "pending_hr"
  | "pending_finance"
  | "pending_cfo"
  | "pending_ceo"
  | "pending_disbursement"
  | "approved"
  | "rejected"
  | "cancelled"
  | "deducted";

export type LoanType = "open" | "installment";

export interface LoanRequest {
  id: number;
  employee: {
    id: number;
    email: string;
    full_name: string;
    employee_profile_id: number;
  };
  requested_amount: number;
  approved_amount?: number | null;
  loan_type?: LoanType;
  installment_months?: number | null;
  reason: string;
  status: LoanStatus;
  manager_decision_note?: string;
  manager_recommendation?: "approve" | "reject" | null;
  finance_decision_note?: string;
  hr_recommendation?: "approve" | "reject" | null;
  cfo_decision_note?: string;
  ceo_decision_note?: string;
  manager_decision_at?: string | null;
  finance_decision_at?: string | null;
  cfo_decision_at?: string | null;
  ceo_decision_at?: string | null;
  deducted_amount?: number | null;
  deducted_at?: string | null;
  approved_year?: number | null;
  approved_month?: number | null;
  target_deduction_year?: number | null;
  target_deduction_month?: number | null;
  target_deduction_period?: string | null;
  disbursed_at?: string | null;
  disbursement_note?: string | null;
  decision_history?: Array<{
    stage: string;
    actor_email?: string | null;
    at?: string | null;
    note?: string;
  }>;
  created_at?: string;
}

export async function getManagerLoanRequests(params?: { status?: LoanStatus; page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LoanRequest>>>("/api/loans/manager/loan-requests/", { params });
  return data;
}

export async function createLoanRequest(payload: {
  amount: number;
  reason?: string;
  loan_type?: LoanType;
  installment_months?: number | null;
}) {
  const { data } = await api.post<ApiResponse<LoanRequest>>("/api/loans/loan-requests/", payload);
  return data;
}

export async function getMyLoanRequests(params?: { status?: LoanStatus; page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LoanRequest>>>("/api/loans/employee/loan-requests/", { params });
  return data;
}

export async function getMyLoanRequest(id: number | string) {
  const { data } = await api.get<ApiResponse<LoanRequest>>(`/api/loans/employee/loan-requests/${id}/`);
  return data;
}

export async function cancelLoanRequest(id: number | string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/loan-requests/${id}/cancel/`);
  return data;
}

export async function getManagerLoanRequest(id: number | string) {
  const { data } = await api.get<ApiResponse<LoanRequest>>(`/api/loans/manager/loan-requests/${id}/`);
  return data;
}

export async function approveManagerLoanRequest(id: number | string, comment?: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/manager/loan-requests/${id}/approve/`, { comment });
  return data;
}

export async function rejectManagerLoanRequest(id: number | string, comment: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/manager/loan-requests/${id}/reject/`, { comment });
  return data;
}

export async function getFinanceLoanRequests(params?: {
  status?: LoanStatus;
  employee_id?: number | string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LoanRequest>>>("/api/loans/loan-requests/", { params });
  return data;
}

export async function getHRLoanRequests(params?: {
  status?: LoanStatus;
  employee_id?: number | string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LoanRequest>>>("/api/loans/hr/loan-requests/", { params });
  return data;
}

export async function getFinanceLoanRequest(id: number | string) {
  const { data } = await api.get<ApiResponse<LoanRequest>>(`/api/loans/loan-requests/${id}/`);
  return data;
}

export async function approveFinanceLoanRequest(id: number | string, comment?: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/loan-requests/${id}/approve/`, { comment });
  return data;
}

export async function rejectFinanceLoanRequest(id: number | string, comment: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/loan-requests/${id}/reject/`, { comment });
  return data;
}

export async function getCFOLoanRequests(params?: { status?: LoanStatus; page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LoanRequest>>>("/api/loans/cfo/loan-requests/", { params });
  return data;
}

export async function getCFOLoanRequest(id: number | string) {
  const { data } = await api.get<ApiResponse<LoanRequest>>(`/api/loans/cfo/loan-requests/${id}/`);
  return data;
}

export async function approveCFOLoanRequest(id: number | string, comment?: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/cfo/loan-requests/${id}/approve/`, { comment });
  return data;
}

export async function rejectCFOLoanRequest(id: number | string, comment: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/cfo/loan-requests/${id}/reject/`, { comment });
  return data;
}

export async function referCFOLoanRequestToCEO(id: number | string, comment: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/cfo/loan-requests/${id}/refer-to-ceo/`, { comment });
  return data;
}

export async function getCEOLoanRequests(params?: { status?: LoanStatus; page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LoanRequest>>>("/api/loans/ceo/loan-requests/", { params });
  return data;
}

export async function getCEOLoanRequest(id: number | string) {
  const { data } = await api.get<ApiResponse<LoanRequest>>(`/api/loans/ceo/loan-requests/${id}/`);
  return data;
}

export async function approveCEOLoanRequest(id: number | string, comment?: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/ceo/loan-requests/${id}/approve/`, { comment });
  return data;
}

export async function rejectCEOLoanRequest(id: number | string, comment: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/ceo/loan-requests/${id}/reject/`, { comment });
  return data;
}

export async function getDisbursementLoanRequests(params?: { status?: LoanStatus; page?: number; page_size?: number }) {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LoanRequest>>>("/api/loans/disbursements/", { params });
  return data;
}

export async function getDisbursementLoanRequest(id: number | string) {
  const { data } = await api.get<ApiResponse<LoanRequest>>(`/api/loans/disbursements/${id}/`);
  return data;
}

export async function markLoanDisbursed(id: number | string, comment?: string) {
  const { data } = await api.post<ApiResponse<LoanRequest>>(`/api/loans/disbursements/${id}/mark-disbursed/`, {
    comment,
  });
  return data;
}
