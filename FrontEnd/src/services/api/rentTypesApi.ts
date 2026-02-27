import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export interface RentType {
  id: number;
  code: string;
  name?: string;
  name_en: string;
  name_ar: string;
  description?: string;
}

export interface CreateRentTypeDto {
  code: string;
  name?: string;
  name_en: string;
  name_ar: string;
  description?: string;
}

export interface UpdateRentTypeDto {
  code?: string;
  name?: string;
  name_en?: string;
  name_ar?: string;
  description?: string;
}

export async function listRentTypes(): Promise<ApiResponse<RentType[]>> {
  const { data } = await api.get<ApiResponse<RentType[]>>("/api/hr/rent-types/");
  return data;
}

export async function createRentType(payload: CreateRentTypeDto): Promise<ApiResponse<RentType>> {
  const { data } = await api.post<ApiResponse<RentType>>("/api/hr/rent-types/", payload);
  return data;
}

export async function updateRentType(id: string | number, payload: UpdateRentTypeDto): Promise<ApiResponse<RentType>> {
  const { data } = await api.patch<ApiResponse<RentType>>(`/api/hr/rent-types/${id}/`, payload);
  return data;
}

export async function deleteRentType(id: string | number): Promise<ApiResponse<Record<string, never>>> {
  const { data } = await api.delete<ApiResponse<Record<string, never>>>(`/api/hr/rent-types/${id}/`);
  return data;
}
