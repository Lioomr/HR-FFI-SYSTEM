import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";
import { isApiError } from "./apiTypes";

export type WhatsAppTemplateItem = {
  key: string;
  title: string;
  description: string;
  variables: string[];
  sample_variables: Record<string, unknown>;
  default_body: string;
  body: string;
  customized: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

export type WhatsAppTemplateListResponse = {
  items: WhatsAppTemplateItem[];
  count: number;
};

export async function listWhatsAppTemplates() {
  const response = await api.get<ApiResponse<WhatsAppTemplateListResponse>>(
    "/api/core/whatsapp-templates/",
  );
  const body = response.data;
  if (isApiError(body))
    throw new Error(body.message || "Failed to load WhatsApp templates");
  return body.data.items;
}

export async function saveWhatsAppTemplate(key: string, bodyText: string) {
  const response = await api.patch<ApiResponse<WhatsAppTemplateItem>>(
    `/api/core/whatsapp-templates/${key}/`,
    {
      body: bodyText,
    },
  );
  const body = response.data;
  if (isApiError(body))
    throw new Error(body.message || "Failed to save WhatsApp template");
  return body.data;
}

export async function resetWhatsAppTemplate(key: string) {
  const response = await api.post<ApiResponse<WhatsAppTemplateItem>>(
    `/api/core/whatsapp-templates/${key}/reset/`,
    {},
  );
  const body = response.data;
  if (isApiError(body))
    throw new Error(body.message || "Failed to reset WhatsApp template");
  return body.data;
}

export async function previewWhatsAppTemplate(
  key: string,
  bodyText: string,
  variables?: Record<string, unknown>,
) {
  const response = await api.post<
    ApiResponse<{ preview: string; variables: Record<string, unknown> }>
  >(`/api/core/whatsapp-templates/${key}/preview/`, {
    body: bodyText,
    variables,
  });
  const body = response.data;
  if (isApiError(body))
    throw new Error(body.message || "Failed to preview WhatsApp template");
  return body.data;
}

export async function testWhatsAppTemplate(
  key: string,
  phone_number: string,
  bodyText: string,
  variables?: Record<string, unknown>,
) {
  const response = await api.post<
    ApiResponse<{
      success: boolean;
      error?: string | null;
      message_id?: string | null;
    }>
  >(`/api/core/whatsapp-templates/${key}/test/`, {
    phone_number,
    body: bodyText,
    variables,
  });
  const body = response.data;
  if (isApiError(body))
    throw new Error(body.message || "Failed to send test WhatsApp template");
  return body.data;
}
