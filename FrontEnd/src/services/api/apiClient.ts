import axios from "axios";
import { getToken, clearToken } from "./tokenStorage";
import { useAuthStore } from "../../auth/authStore";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});



// Attach token and language
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Attach current language for backend i18n
  const lang = localStorage.getItem("ffi_app_language") || "en";
  config.headers["Accept-Language"] = lang;

  return config;
});

// Global 401 handling => logout
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const data = err?.response?.data;

    if (status === 401) {
      clearToken();
      // Zustand store action without hook usage:
      useAuthStore.getState().logout();
      // Optional: hard redirect to login (works even outside router context)
      window.location.href = "/login";
    }

    // Try to extract a user-friendly message
    let friendlyMessage = err.message;
    if (data?.message) {
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
  }
);
