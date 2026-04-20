import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type RentRecurrence = "ONE_TIME" | "MONTHLY";
export type RentStatus = "UPCOMING" | "OVERDUE" | "SCHEDULED";
export type RentPaymentCategory = "rent" | "security_deposit" | "other";
export type RentPaymentStatus = "pending" | "paid" | "cancelled";

export interface RentPaymentRecord {
  id: number;
  payment_number: number;
  category: RentPaymentCategory;
  status: RentPaymentStatus;
  amount: string | number;
  due_date?: string | null;
  paid_date?: string | null;
  notes: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface RentItem {
  id: number;
  company_id?: number;
  company_name?: string;
  rent_type: {
    id: number;
    code: string;
    name_en: string;
    name_ar: string;
    description?: string;
  };
  asset: { id: number; name_en: string; name_ar: string } | null;
  property_name_en: string;
  property_name_ar: string;
  property_address?: string;
  lease_start_date?: string | null;
  lease_end_date?: string | null;
  remaining_lease_duration: number | null;
  annual_rent_value: string | number | null;
  security_deposit: string | number | null;
  payment_schedule: string;
  auto_renewal: boolean;
  notification_date: string | null;
  notice: string;
  payments: string;
  payment_records: RentPaymentRecord[];
  recurrence: RentRecurrence;
  one_time_due_date?: string | null;
  start_date?: string | null;
  due_day?: number | null;
  next_due_date: string | null;
  days_remaining: number | null;
  amount: string | number | null;
  reminder_days: number;
  status: RentStatus;
  last_reminder_sent_at: string | null;
}

export interface ListRentsParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: "all" | "upcoming" | "overdue";
  rent_type?: number;
}

export interface CreateRentDto {
  rent_type_id: number;
  asset_id?: number | null;
  property_name_en?: string;
  property_name_ar?: string;
  property_address?: string;
  lease_start_date?: string | null;
  lease_end_date?: string | null;
  annual_rent_value?: number | null;
  security_deposit?: number | null;
  payment_schedule?: string;
  auto_renewal?: boolean;
  notice?: string;
  payments?: string;
  recurrence: RentRecurrence;
  one_time_due_date?: string | null;
  start_date?: string | null;
  due_day?: number | null;
  reminder_days: number;
  amount?: number | null;
}

export interface UpdateRentDto extends Partial<CreateRentDto> { }

export interface CreateRentPaymentDto {
  payment_number: number;
  category: RentPaymentCategory;
  status: RentPaymentStatus;
  amount: number;
  due_date?: string | null;
  paid_date?: string | null;
  notes?: string;
}

export async function listRents(params?: ListRentsParams): Promise<ApiResponse<PaginatedResponse<RentItem>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<RentItem>>>("/api/hr/rents/", { params });
  return data;
}

export async function createRent(payload: CreateRentDto): Promise<ApiResponse<RentItem>> {
  const { data } = await api.post<ApiResponse<RentItem>>("/api/hr/rents/", payload);
  return data;
}

export async function updateRent(id: string | number, payload: UpdateRentDto): Promise<ApiResponse<RentItem>> {
  const { data } = await api.patch<ApiResponse<RentItem>>(`/api/hr/rents/${id}/`, payload);
  return data;
}

export async function deleteRent(id: string | number): Promise<ApiResponse<Record<string, never>>> {
  const { data } = await api.delete<ApiResponse<Record<string, never>>>(`/api/hr/rents/${id}/`);
  return data;
}

export async function notifyRent(id: string | number): Promise<ApiResponse<{ delivery: Record<string, any> }>> {
  const { data } = await api.post<ApiResponse<{ delivery: Record<string, any> }>>(`/api/hr/rents/${id}/notify/`, {});
  return data;
}

export async function createRentPayment(
  rentId: string | number,
  payload: CreateRentPaymentDto
): Promise<ApiResponse<RentPaymentRecord>> {
  const { data } = await api.post<ApiResponse<RentPaymentRecord>>(`/api/hr/rents/${rentId}/payments/`, payload);
  return data;
}
