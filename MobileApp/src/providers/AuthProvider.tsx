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
import {
  requireLocalAuthentication,
  type Reauthenticate,
  type ReauthFailure,
  type ReauthPrompt,
} from '@/services/biometrics';

/**
 * `bootstrap-unreachable` means stored credentials exist but the server could not be
 * reached to confirm them. The session is deliberately kept so a transient outage does
 * not sign the employee out; the entry screen offers a retry instead.
 *
 * `locked` means a stored session was restored on a cold launch but the Gate 4 local
 * re-authentication has not been satisfied yet. The session is intact and no HR data is
 * rendered; the entry screen challenges and offers sign-out.
 */
export type AuthStatus =
  'bootstrapping' | 'bootstrap-unreachable' | 'locked' | 'authenticated' | 'unauthenticated';
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
  /**
   * Why the session is locked. `unavailable` means the device offers no biometric and
   * no passcode, so retrying cannot succeed until the employee sets one up.
   */
  lockReason: ReauthFailure | null;
  handleApiError(error: unknown): boolean;
  retryBootstrap(): Promise<void>;
  /** Runs the cold-launch local re-authentication challenge. Returns true when passed. */
  unlock(prompt: { promptMessage: string; cancelLabel: string }): Promise<boolean>;
}

/** English fallback; the app supplies localized copy through `lockPrompt`. */
const DEFAULT_LOCK_PROMPT: ReauthPrompt = Object.freeze({
  promptMessage: 'Confirm it is you to open FFI HR',
  cancelLabel: 'Cancel',
});

interface AuthProviderProps extends PropsWithChildren {
  client?: AuthService;
  /** Injectable so tests exercise the lock without the native prompt. */
  reauthenticate?: Reauthenticate;
  lockPrompt?: ReauthPrompt;
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

export function AuthProvider({
  children,
  client = authClient,
  lockPrompt = DEFAULT_LOCK_PROMPT,
  reauthenticate = requireLocalAuthentication,
}: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<AuthContextValue['company']>(null);
  const [sessionNotice, setSessionNotice] = useState<SessionNotice>(null);
  const [lockReason, setLockReason] = useState<ReauthFailure | null>(null);
  const mounted = useRef(true);
  const bootstrapSequence = useRef(0);
  const bootstrapRetryInFlight = useRef(false);

  const transitionToUnauthenticated = useCallback((notice: SessionNotice = null) => {
    setUser(null);
    setCompany(null);
    setSessionNotice(notice);
    setStatus('unauthenticated');
  }, []);

  /**
   * A revoked session signs the employee out; anything transient (offline, timeout,
   * 5xx) parks on a retryable state without discarding the stored credentials.
   */
  const settleBootstrapFailure = useCallback(
    (error: unknown) => {
      const apiError = safeError(error);
      if (apiError.code === 'session_expired') {
        transitionToUnauthenticated('session-expired');
        return;
      }
      if (apiError.code === 'authentication_failed') {
        transitionToUnauthenticated();
        return;
      }
      setUser(null);
      setCompany(null);
      setStatus('bootstrap-unreachable');
    },
    [transitionToUnauthenticated],
  );

  const retryBootstrap = useCallback(async () => {
    if (bootstrapRetryInFlight.current) {
      return;
    }

    bootstrapRetryInFlight.current = true;
    const attempt = ++bootstrapSequence.current;
    setStatus('bootstrapping');
    try {
      const restoredUser = await client.restoreSession();
      if (!mounted.current || attempt !== bootstrapSequence.current) return;
      if (!restoredUser) {
        transitionToUnauthenticated();
        return;
      }
      const reauth = await reauthenticate(lockPrompt);
      if (!mounted.current || attempt !== bootstrapSequence.current) return;
      setUser(restoredUser);
      setCompany(activeCompanyFor(restoredUser));
      setSessionNotice(null);
      // A restored session stays locked until the device owner is re-verified.
      setLockReason(reauth.status === 'passed' ? null : reauth.reason);
      setStatus(reauth.status === 'passed' ? 'authenticated' : 'locked');
    } catch (error) {
      if (!mounted.current || attempt !== bootstrapSequence.current) return;
      settleBootstrapFailure(error);
    } finally {
      if (attempt === bootstrapSequence.current) {
        bootstrapRetryInFlight.current = false;
      }
    }
  }, [client, lockPrompt, reauthenticate, settleBootstrapFailure, transitionToUnauthenticated]);

  useEffect(() => {
    mounted.current = true;
    bootstrapRetryInFlight.current = false;
    const attempt = ++bootstrapSequence.current;
    void client
      .restoreSession()
      .then(async (restoredUser) => {
        if (!mounted.current || attempt !== bootstrapSequence.current) return;
        if (!restoredUser) {
          transitionToUnauthenticated();
          return;
        }
        const reauth = await reauthenticate(lockPrompt);
        if (!mounted.current || attempt !== bootstrapSequence.current) return;
        setUser(restoredUser);
        setCompany(activeCompanyFor(restoredUser));
        setSessionNotice(null);
        // A restored session stays locked until the device owner is re-verified.
        setLockReason(reauth.status === 'passed' ? null : reauth.reason);
        setStatus(reauth.status === 'passed' ? 'authenticated' : 'locked');
      })
      .catch((error: unknown) => {
        if (!mounted.current || attempt !== bootstrapSequence.current) return;
        settleBootstrapFailure(error);
      });
    return () => {
      mounted.current = false;
      bootstrapRetryInFlight.current = false;
      bootstrapSequence.current += 1;
    };
  }, [client, lockPrompt, reauthenticate, settleBootstrapFailure, transitionToUnauthenticated]);

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

  /**
   * Satisfies the cold-launch gate. Only a passed challenge moves the restored session
   * to `authenticated`; a failure leaves it locked so the employee can retry or sign
   * out. Nothing about the challenge is persisted, so the next cold launch re-asks.
   */
  const unlock = useCallback(
    async (prompt: { promptMessage: string; cancelLabel: string }) => {
      const outcome = await reauthenticate(prompt);
      if (!mounted.current) return false;
      if (outcome.status !== 'passed') {
        setLockReason(outcome.reason);
        return false;
      }
      setLockReason(null);
      setStatus((current) => (current === 'locked' ? 'authenticated' : current));
      return true;
    },
    [reauthenticate],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      changePassword,
      company,
      handleApiError,
      lockReason,
      login,
      logout,
      retryBootstrap,
      selectCompany,
      sessionNotice,
      status,
      unlock,
      user,
    }),
    [
      changePassword,
      company,
      handleApiError,
      lockReason,
      login,
      logout,
      retryBootstrap,
      selectCompany,
      sessionNotice,
      status,
      unlock,
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
