import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  authClient,
  type AuthClient,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
} from '@/auth';
import { ApiError, type ApiErrorCode } from '@/services/api/api-error';

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';
export type SessionNotice = 'session-expired' | null;

export type AuthService = Pick<
  AuthClient,
  'changePassword' | 'login' | 'logout' | 'restoreSession' | 'selectActiveCompany'
>;

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  company: AuthUser['accessible_organizations'][number] | null;
  sessionNotice: SessionNotice;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  selectCompany(companyId: string | number): void;
  handleApiError(error: unknown): boolean;
  retryBootstrap(): Promise<void>;
}

interface AuthProviderProps extends PropsWithChildren {
  client?: AuthService;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function activeCompanyFor(user: AuthUser) {
  const companyId = user.default_organization_id ?? user.accessible_organizations[0]?.id;
  return (
    user.accessible_organizations.find((company) => String(company.id) === String(companyId)) ??
    null
  );
}

function safeError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('request_failed');
}

export function AuthProvider({ children, client = authClient }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<AuthContextValue['company']>(null);
  const [sessionNotice, setSessionNotice] = useState<SessionNotice>(null);
  const mounted = useRef(true);

  const transitionToUnauthenticated = useCallback((notice: SessionNotice = null) => {
    setUser(null);
    setCompany(null);
    setSessionNotice(notice);
    setStatus('unauthenticated');
  }, []);

  const retryBootstrap = useCallback(async () => {
    setStatus('bootstrapping');
    try {
      const restoredUser = await client.restoreSession();
      if (!mounted.current) return;
      if (!restoredUser) {
        transitionToUnauthenticated();
        return;
      }
      setUser(restoredUser);
      setCompany(activeCompanyFor(restoredUser));
      setSessionNotice(null);
      setStatus('authenticated');
    } catch (error) {
      if (!mounted.current) return;
      const apiError = safeError(error);
      transitionToUnauthenticated(apiError.code === 'session_expired' ? 'session-expired' : null);
    }
  }, [client, transitionToUnauthenticated]);

  useEffect(() => {
    mounted.current = true;
    void client
      .restoreSession()
      .then((restoredUser) => {
        if (!mounted.current) return;
        if (!restoredUser) {
          transitionToUnauthenticated();
          return;
        }
        setUser(restoredUser);
        setCompany(activeCompanyFor(restoredUser));
        setSessionNotice(null);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        const apiError = safeError(error);
        transitionToUnauthenticated(apiError.code === 'session_expired' ? 'session-expired' : null);
      });
    return () => {
      mounted.current = false;
    };
  }, [client, transitionToUnauthenticated]);

  const login = useCallback(
    async (input: LoginInput) => {
      try {
        const authenticatedUser = await client.login(input);
        setUser(authenticatedUser);
        setCompany(activeCompanyFor(authenticatedUser));
        setSessionNotice(null);
        setStatus('authenticated');
      } catch (error) {
        throw safeError(error);
      }
    },
    [client],
  );

  const logout = useCallback(async () => {
    try {
      await client.logout();
    } catch (error) {
      throw safeError(error);
    } finally {
      transitionToUnauthenticated();
    }
  }, [client, transitionToUnauthenticated]);

  const changePassword = useCallback(
    async (input: ChangePasswordInput) => {
      try {
        await client.changePassword(input);
        transitionToUnauthenticated();
      } catch (error) {
        throw safeError(error);
      }
    },
    [client, transitionToUnauthenticated],
  );

  const selectCompany = useCallback(
    (companyId: string | number) => {
      client.selectActiveCompany(companyId);
      const selected = user?.accessible_organizations.find(
        (organization) => String(organization.id) === String(companyId),
      );
      if (!selected) throw new ApiError('request_failed', 403);
      setCompany(selected);
    },
    [client, user],
  );

  const handleApiError = useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError) || error.code !== 'session_expired') return false;
      transitionToUnauthenticated('session-expired');
      return true;
    },
    [transitionToUnauthenticated],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      changePassword,
      company,
      handleApiError,
      login,
      logout,
      retryBootstrap,
      selectCompany,
      sessionNotice,
      status,
      user,
    }),
    [
      changePassword,
      company,
      handleApiError,
      login,
      logout,
      retryBootstrap,
      selectCompany,
      sessionNotice,
      status,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function isSessionExpiredError(error: unknown): error is ApiError & { code: ApiErrorCode } {
  return error instanceof ApiError && error.code === 'session_expired';
}
