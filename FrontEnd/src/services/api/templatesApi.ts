import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";
import { isApiError } from "./apiTypes";
import { triggerBlobDownload } from "./downloads";

export type TemplateCategory = "request" | "letter" | "report";

export interface TemplateItem {
  key: string;
  category: TemplateCategory;
  filename: string;
  title_en: string;
  title_ar: string;
  description_en: string;
  description_ar: string;
  available: boolean;
  updated_at: string | null;
}

export interface TemplateListResponse {
  items: TemplateItem[];
  count: number;
}

export async function listTemplates(): Promise<TemplateItem[]> {
  const response = await api.get<ApiResponse<TemplateListResponse>>("/api/core/templates/");
  const body = response.data;
  if (isApiError(body)) {
    throw new Error(body.message || "Failed to load templates");
  }
  return body.data.items;
}

export async function downloadTemplate(key: string, filename?: string): Promise<void> {
  const response = await api.get<Blob>(`/api/core/templates/${key}/download/`, {
    responseType: "blob",
  });
  const disposition = response.headers?.["content-disposition"] || "";
  const fallback = filename || `${key}.pdf`;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallback;
  triggerBlobDownload(response.data, name);
}
