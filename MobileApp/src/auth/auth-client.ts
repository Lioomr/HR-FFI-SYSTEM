import type { ApiClient } from '@/services/api/api-client';
import { ApiError } from '@/services/api/api-error';

import type { AuthUser, ChangePasswordInput, LoginInput } from './types';

interface LoginResponse {
  token: string;
  access: string;
  refresh: string;
  user: AuthUser;
}

function isLoginResponse(value: LoginResponse): boolean {
  return (
    typeof value?.access === 'string' &&
    value.access.length > 0 &&
    typeof value.refresh === 'string' &&
    value.refresh.length > 0 &&
    typeof value.token === 'string' &&
    value.token === value.access &&
    Boolean(value.user) &&
    typeof value.user.id === 'string' &&
    typeof value.user.email === 'string' &&
    Array.isArray(value.user.accessible_organizations)
  );
}

function initialCompanyId(user: AuthUser): string | number | null {
  return user.default_organization_id ?? user.accessible_organizations[0]?.id ?? null;
}

export class AuthClient {
  private currentUser: AuthUser | null = null;

  constructor(private readonly api: ApiClient) {}

  get user(): AuthUser | null {
    return this.currentUser;
  }

  async login(input: LoginInput): Promise<AuthUser> {
    const result = await this.api.request<LoginResponse>('/auth/login', {
      authenticated: false,
      body: { email: input.email.trim(), password: input.password },
      method: 'POST',
      retryOnUnauthorized: false,
    });
    if (!isLoginResponse(result)) throw new ApiError('invalid_response');

    await this.api.establishSession({ accessToken: result.access, refreshToken: result.refresh });
    this.currentUser = result.user;
    this.api.setActiveCompanyId(initialCompanyId(result.user));
    return result.user;
  }

  /**
   * Restores a stored session. Only a genuine authentication failure may purge the
   * credentials: a transient network or server fault must leave the session intact so
   * an employee who opens the app offline is not silently signed out and forced to
   * re-authenticate once connectivity returns.
   */
  async restoreSession(): Promise<AuthUser | null> {
    if (!(await this.api.hasSession())) return null;
    try {
      return await this.me();
    } catch (error) {
      const revoked =
        error instanceof ApiError &&
        (error.code === 'session_expired' || error.code === 'authentication_failed');
      if (!revoked) throw error;
      this.currentUser = null;
      await this.clearLocally();
      return null;
    }
  }

  async me(): Promise<AuthUser> {
    const user = await this.api.request<AuthUser>('/auth/me');
    this.currentUser = user;
    this.api.setActiveCompanyId(initialCompanyId(user));
    return user;
  }

  selectActiveCompany(companyId: string | number): void {
    if (!this.currentUser) throw new ApiError('session_expired', 401);
    const allowed = this.currentUser.accessible_organizations.some(
      (organization) => String(organization.id) === String(companyId),
    );
    if (!allowed) throw new ApiError('request_failed', 403);
    this.api.setActiveCompanyId(companyId);
  }

  async logout(): Promise<void> {
    try {
      await this.api.request<Record<string, never>>('/auth/logout', { method: 'POST' });
    } finally {
      this.currentUser = null;
      await this.clearLocally();
    }
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.api.request<Record<string, never>>('/auth/change-password', {
      body: { current_password: input.currentPassword, new_password: input.newPassword },
      method: 'POST',
    });
    this.currentUser = null;
    await this.clearLocally();
  }

  private async clearLocally(): Promise<void> {
    try {
      await this.api.clearSession();
    } catch {
      // The API client has already purged its in-memory session.
    }
  }
}
