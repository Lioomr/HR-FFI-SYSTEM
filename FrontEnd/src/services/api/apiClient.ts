import axios from "axios";
import { getToken, clearToken } from "./tokenStorage";
import { useAuthStore } from "../../auth/authStore";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

// Attach token
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Global 401 handling => logout
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;

    if (status === 401) {
      clearToken();
      // Zustand store action without hook usage:
      useAuthStore.getState().logout();
      // Optional: hard redirect to login (works even outside router context)
      window.location.href = "/login";
    }

    return Promise.reject(err);
  }
);
