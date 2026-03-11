import { getHttpStatus } from "./httpErrors";
import { getFirstApiErrorMessage } from "../../utils/formErrors";

type TranslateFn = (key: string, params?: Record<string, unknown> | string, fallback?: string) => string;

function mapKnownServerMessage(message: string): "server" | "network" | "timeout" | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "server error") return "server";
  if (normalized.includes("network")) return "network";
  if (normalized.includes("timeout")) return "timeout";
  return null;
}

export function getDetailedHttpErrorMessage(t: TranslateFn, err: unknown, fallbackKey = "common.error.genericDetailed"): string {
  const status = getHttpStatus(err);
  const validationMessage = getFirstApiErrorMessage(err);
  if (status === 401) return t("common.error.unauthorizedDetailed");
  if (status === 403) return t("common.error.forbiddenDetailed");
  if (status === 400 || status === 422) return validationMessage || t("common.error.validationDetailed");
  if (status !== undefined && status >= 500) return t("common.error.serverDetailed");

  const errObj = err as { message?: unknown; code?: unknown } | undefined;
  const rawMessage = typeof errObj?.message === "string" ? errObj.message.trim() : "";
  const mapped = rawMessage ? mapKnownServerMessage(rawMessage) : null;

  if (typeof errObj?.code === "string" && errObj.code === "ECONNABORTED") {
    return t("common.error.timeoutDetailed");
  }

  if (mapped === "server") return t("common.error.serverDetailed");
  if (mapped === "network") return t("common.error.networkDetailed");
  if (mapped === "timeout") return t("common.error.timeoutDetailed");

  if (rawMessage) return rawMessage;
  return t(fallbackKey);
}

export function getDetailedApiMessage(t: TranslateFn, message: string | undefined, fallbackKey = "common.error.genericDetailed"): string {
  const rawMessage = (message || "").trim();
  const mapped = rawMessage ? mapKnownServerMessage(rawMessage) : null;
  if (mapped === "server") return t("common.error.serverDetailed");
  if (mapped === "network") return t("common.error.networkDetailed");
  if (mapped === "timeout") return t("common.error.timeoutDetailed");
  if (rawMessage) return rawMessage;
  return t(fallbackKey);
}

