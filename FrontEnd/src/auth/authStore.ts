import { create } from "zustand";
import { clearToken, getToken, setToken } from "../services/api/tokenStorage";

export type Role = "SystemAdmin" | "HRManager" | "Employee";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
};

type AuthState = {
  isAuthenticated: boolean;
  user: AuthUser | null;

  login: (user: AuthUser, token?: string) => void;
  logout: () => void;

  hydrateFromStorage: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,

  login: (user, token) => {
    if (token) setToken(token);
    set({ isAuthenticated: true, user });
  },

  logout: () => {
    clearToken();
    set({ isAuthenticated: false, user: null });
  },

  hydrateFromStorage: () => {
    const token = getToken();
    if (!token) return;
    // If you have /auth/me, we’ll call it to load user.
    // For now: just mark unauthenticated until real /me exists.
    // Keep it strict:
    set({ isAuthenticated: false, user: null });
  },
}));
