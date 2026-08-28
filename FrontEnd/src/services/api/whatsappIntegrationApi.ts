import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export type WhatsAppIntegrationStatus = {
  configured: boolean;
  instance_name: string;
  base_url_configured: boolean;
  api_key_configured: boolean;
  connection_state: string;
  connected: boolean;
  provider_status_code?: number;
  error?: string;
};

export type WhatsAppQrResponse = {
  instance_name: string;
  qr_code: string;
  qr_available: boolean;
  provider_status_code?: number;
};

export type WhatsAppTestResponse = {
  success?: boolean;
  sent?: boolean;
  provider?: string;
  status_code?: number;
  message_id?: string;
  error?: string;
};

export async function getWhatsAppIntegrationStatus() {
  const { data } = await api.get<ApiResponse<WhatsAppIntegrationStatus>>(
    "/api/integrations/whatsapp/status/",
  );
  return data;
}

export async function connectWhatsAppIntegration() {
  const { data } = await api.post<ApiResponse<WhatsAppQrResponse>>(
    "/api/integrations/whatsapp/connect/",
    {},
  );
  return data;
}

export async function getWhatsAppIntegrationQr() {
  const { data } = await api.get<ApiResponse<WhatsAppQrResponse>>(
    "/api/integrations/whatsapp/qr/",
  );
  return data;
}

export async function logoutWhatsAppIntegration() {
  const { data } = await api.post<
    ApiResponse<{ instance_name: string; provider_status_code?: number }>
  >("/api/integrations/whatsapp/logout/", {});
  return data;
}

export async function testWhatsAppIntegration(phone_number: string) {
  const { data } = await api.post<ApiResponse<WhatsAppTestResponse>>(
    "/api/integrations/whatsapp/test/",
    {
      phone_number,
    },
  );
  return data;
}
