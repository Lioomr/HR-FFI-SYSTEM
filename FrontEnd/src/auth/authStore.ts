import { create } from "zustand";
import { clearToken, getToken, setToken, getStoredUser, setStoredUser } from "../services/api/tokenStorage";

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
    // Persist user with new helper
    setStoredUser(user);
    set({ isAuthenticated: true, user });
  },

  logout: () => {
    clearToken();
    set({ isAuthenticated: false, user: null });
  },

  hydrateFromStorage: () => {
    const token = getToken();
    const storedUser = getStoredUser();

    if (token && storedUser) {
      // Best case: restore everything
      set({
        isAuthenticated: true,
        user: {
          id: storedUser.id,
          email: storedUser.email,
          role: storedUser.role as Role,
        },
      });
    } else if (token) {
      // Legacy/Fallback: Token exists but no user data.
      // We mark authenticated so RequireAuth passes,
      // but user is null so RequireRole will block (safety).
      set({ isAuthenticated: true, user: null });
    } else {
      // No token = definitely logged out
      set({ isAuthenticated: false, user: null });
    }
  },
}));
