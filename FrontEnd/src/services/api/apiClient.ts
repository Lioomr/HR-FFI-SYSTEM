import axios, { type AxiosRequestConfig } from "axios";
import {
  clearToken,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setToken,
} from "./tokenStorage";
import {
  resolveAuthorizedActiveOrganizationId,
  useAuthStore,
} from "../../auth/authStore";
import { getFirstApiErrorMessage } from "../../utils/formErrors";
import { STORAGE_KEYS } from "../../utils/storageKeys";

export const api = axios.create({
  // Empty baseURL keeps browser requests same-origin; Docker Nginx proxies
  // the explicit backend prefixes to the backend service.
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

// This deliberately has no interceptors: a failed refresh must not recurse
// into another refresh attempt.
const refreshApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

type RetriableRequestConfig = AxiosRequestConfig & {
  _refreshRetried?: boolean;
};

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("No refresh token is available.");

  if (!refreshPromise) {
    refreshPromise = refreshApi
      .post("/auth/refresh", { refresh })
      .then(({ data }) => {
        const payload = data?.data ?? data;
        if (typeof payload?.access !== "string" || !payload.access) {
          throw new Error("The token refresh response was invalid.");
        }
        setToken(payload.access);
        if (typeof payload.refresh === "string" && payload.refresh) {
          setRefreshToken(payload.refresh);
        }
        return payload.access;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function clearAuthenticationAndRedirect() {
  clearToken();
  useAuthStore.getState().logout();
  window.location.href = "/login";
}

function shouldRedirectOnUnauthorized(err: any): boolean {
  const status = err?.response?.status;
  if (status !== 401) return false;

  const token = getToken();
  if (!token) return false;

  const requestUrl = String(err?.config?.url || "");
  return (
    !requestUrl.includes("/auth/login") && !requestUrl.includes("/auth/refresh")
  );
}

type CompanySelectorConfig = {
  url?: string;
  params?: unknown;
};

function companyQueryValues(config: CompanySelectorConfig): string[] {
  const values: string[] = [];
  const query = String(config.url || "").split("?", 2)[1];
  if (query) values.push(...new URLSearchParams(query).getAll("company_id"));

  if (config.params instanceof URLSearchParams) {
    values.push(...config.params.getAll("company_id"));
  } else if (config.params && typeof config.params === "object") {
    const value = (config.params as Record<string, unknown>).company_id;
    if (Array.isArray(value)) values.push(...value.map(String));
    else if (value != null) values.push(String(value));
  }
  return values;
}

export function assertCompanySelectorsMatchActive(
  config: CompanySelectorConfig,
  activeOrganizationId: string | number,
): void {
  const values = companyQueryValues(config);
  if (values.length > 1)
    throw new Error("Duplicate company query parameters are not allowed.");
  if (values.length === 0) return;
  const value = values[0].trim();
  if (!/^[1-9]\d*$/.test(value))
    throw new Error("Invalid company query parameter.");
  if (value !== String(activeOrganizationId)) {
    throw new Error(
      "Company query parameter and active company header must match.",
    );
  }
}

// Attach token and language
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const user = useAuthStore.getState().user;
  const activeOrganizationId = user
    ? resolveAuthorizedActiveOrganizationId(user)
    : null;
  if (token && user && activeOrganizationId == null) {
    throw new Error(
      "No authorized active company is available for this request.",
    );
  }
  if (activeOrganizationId != null) {
    assertCompanySelectorsMatchActive(config, activeOrganizationId);
    const configuredHeader = config.headers.get("X-Active-Company-Id");
    if (
      configuredHeader != null &&
      String(configuredHeader) !== String(activeOrganizationId)
    ) {
      throw new Error(
        "Configured company header does not match the authorized active company.",
      );
    }
    config.headers["X-Active-Company-Id"] = String(activeOrganizationId);
  }

  // Attach current language for backend i18n
  const lang = localStorage.getItem(STORAGE_KEYS.appLanguage) || "en";
  config.headers["Accept-Language"] = lang;

  return config;
});

// Global 401 handling => logout
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const data = err?.response?.data;

    if (shouldRedirectOnUnauthorized(err)) {
      const request = err.config as RetriableRequestConfig | undefined;
      if (request && !request._refreshRetried) {
        request._refreshRetried = true;
        try {
          await refreshAccessToken();
          return api.request(request);
        } catch {
          clearAuthenticationAndRedirect();
        }
      } else {
        clearAuthenticationAndRedirect();
      }
    }

    // Try to extract a user-friendly message
    let friendlyMessage = err.message;
    const extractedMessage = getFirstApiErrorMessage({
      response: { data },
      apiData: data,
    });
    if (extractedMessage) {
      friendlyMessage = extractedMessage;
    } else if (data?.message) {
      friendlyMessage = data.message;
    } else if (typeof data === "string") {
      friendlyMessage = data;
    }

    // Attach it to the error object so components can just use error.message
    if (err) {
      err.message = friendlyMessage;
      err.apiData = data; // Keep raw data for validation errors
    }

    return Promise.reject(err);
  },
);
