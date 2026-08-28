import { create } from "zustand";
import {
  clearToken,
  getToken,
  setToken,
  getStoredUser,
  setStoredUser,
} from "../services/api/tokenStorage";
import type { OrganizationNodeDto } from "../services/api/apiTypes";

export type Role =
  | "SystemAdmin"
  | "HRManager"
  | "Manager"
  | "Employee"
  | "CEO"
  | "CFO";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  accessible_organizations?: OrganizationNodeDto[];
  default_organization_id?: string | number | null;
  has_all_company_access?: boolean;
  active_organization_id?: string | number | null;
};

type AuthState = {
  isAuthenticated: boolean;
  user: AuthUser | null;

  login: (user: AuthUser, token?: string) => void;
  logout: () => void;
  setActiveOrganization: (organizationId: string | number | null) => void;

  hydrateFromStorage: () => void;
};

export function resolveAuthorizedActiveOrganizationId(
  user: Pick<
    AuthUser,
    | "accessible_organizations"
    | "active_organization_id"
    | "default_organization_id"
  >,
): string | number | null {
  const organizations = user.accessible_organizations ?? [];
  const isAccessible = (organizationId: string | number | null | undefined) =>
    organizationId != null &&
    organizations.some(
      (organization) => String(organization.id) === String(organizationId),
    );

  if (isAccessible(user.active_organization_id))
    return user.active_organization_id ?? null;
  if (isAccessible(user.default_organization_id))
    return user.default_organization_id ?? null;
  const company = organizations.find(
    (organization) => organization.node_type === "company",
  );
  return company?.id ?? organizations[0]?.id ?? null;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,

  login: (user, token) => {
    if (token) setToken(token);
    const normalizedUser = {
      ...user,
      active_organization_id: resolveAuthorizedActiveOrganizationId(user),
    };
    setStoredUser(normalizedUser);
    set({ isAuthenticated: true, user: normalizedUser });
  },

  logout: () => {
    clearToken();
    set({ isAuthenticated: false, user: null });
  },

  setActiveOrganization: (organizationId) =>
    set((state) => {
      if (!state.user) return state;
      const requestedUser = {
        ...state.user,
        active_organization_id: organizationId,
      };
      const authorizedOrganizationId =
        resolveAuthorizedActiveOrganizationId(requestedUser);
      if (String(authorizedOrganizationId) !== String(organizationId))
        return state;
      const user = {
        ...state.user,
        active_organization_id: authorizedOrganizationId,
      };
      setStoredUser(user);
      return { user };
    }),

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
          accessible_organizations:
            (storedUser.accessible_organizations as
              | OrganizationNodeDto[]
              | undefined) ?? [],
          default_organization_id: storedUser.default_organization_id ?? null,
          has_all_company_access: storedUser.has_all_company_access ?? false,
          active_organization_id: resolveAuthorizedActiveOrganizationId({
            accessible_organizations:
              (storedUser.accessible_organizations as
                | OrganizationNodeDto[]
                | undefined) ?? [],
            active_organization_id: storedUser.active_organization_id,
            default_organization_id: storedUser.default_organization_id,
          }),
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
