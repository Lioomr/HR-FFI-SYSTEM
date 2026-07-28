import { ApiError, safeApiError } from './api-error';
import type {
  ApiRequestOptions,
  ApiSuccessEnvelope,
  CredentialStore,
  FetchLike,
  SessionCredentials,
} from './types';

const REFRESH_PATH = '/auth/refresh';

interface ApiClientConfiguration {
  baseUrl: string;
  credentialStore: CredentialStore;
  fetchImpl?: FetchLike;
  allowInsecureDevelopment?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function validateApiBaseUrl(baseUrl: string, allowInsecureDevelopment = false): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('API base URL is invalid.');
  }

  const secure = url.protocol === 'https:';
  const permittedDevelopmentHttp =
    url.protocol === 'http:' && (allowInsecureDevelopment || isLoopback(url.hostname));
  if (!secure && !permittedDevelopmentHttp) throw new Error('API base URL must use HTTPS.');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API base URL must not contain credentials, query parameters, or fragments.');
  }
  return url.toString().replace(/\/+$/, '');
}

function validatePath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('#')) {
    throw new Error('API paths must be same-origin absolute paths.');
  }
}

function rotatedCredentials(data: unknown): SessionCredentials | null {
  if (!isRecord(data)) return null;
  const { access, refresh, token } = data;
  if (
    typeof access !== 'string' ||
    access.length === 0 ||
    typeof refresh !== 'string' ||
    refresh.length === 0 ||
    typeof token !== 'string' ||
    token !== access
  ) {
    return null;
  }
  return { accessToken: access, refreshToken: refresh };
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly credentialStore: CredentialStore;
  private readonly fetchImpl: FetchLike;
  private credentials: SessionCredentials | null | undefined;
  private credentialsLoad: Promise<SessionCredentials | null> | null = null;
  private refreshInFlight: Promise<SessionCredentials> | null = null;
  private credentialMutation: Promise<void> = Promise.resolve();
  private sessionEpoch = 0;
  private activeCompanyId: string | null = null;

  constructor({
    baseUrl,
    credentialStore,
    fetchImpl = globalThis.fetch.bind(globalThis),
    allowInsecureDevelopment = false,
  }: ApiClientConfiguration) {
    this.baseUrl = validateApiBaseUrl(baseUrl, allowInsecureDevelopment);
    this.credentialStore = credentialStore;
    this.fetchImpl = fetchImpl;
  }

  async request<T>(path: `/${string}`, options: ApiRequestOptions = {}): Promise<T> {
    validatePath(path);
    const authenticated = options.authenticated !== false;
    const retryOnUnauthorized = options.retryOnUnauthorized !== false;
    const credentials = authenticated ? await this.loadCredentials() : null;
    if (authenticated && !credentials) throw new ApiError('session_expired', 401);

    const firstResponse = await this.fetchEnvelope<T>(path, options, credentials, authenticated);
    if (firstResponse.response.ok) return firstResponse.data as T;

    if (
      authenticated &&
      retryOnUnauthorized &&
      firstResponse.response.status === 401 &&
      credentials
    ) {
      const refreshed = await this.refresh(credentials.accessToken);
      const replay = await this.fetchEnvelope<T>(
        path,
        { ...options, retryOnUnauthorized: false },
        refreshed,
        true,
      );
      if (replay.response.ok) return replay.data as T;
      if (replay.response.status === 401) await this.clearSessionSilently();
      throw safeApiError(replay.response.status, true);
    }

    throw safeApiError(firstResponse.response.status, authenticated);
  }

  async establishSession(credentials: SessionCredentials): Promise<void> {
    this.sessionEpoch += 1;
    this.credentials = null;
    this.credentialsLoad = null;
    try {
      await this.mutateCredentialStore(() => this.credentialStore.replace(credentials));
      this.credentials = { ...credentials };
    } catch {
      await this.clearSessionSilently();
      throw new ApiError('secure_storage_unavailable');
    }
  }

  async clearSession(): Promise<void> {
    this.sessionEpoch += 1;
    this.credentials = null;
    this.credentialsLoad = null;
    this.activeCompanyId = null;
    try {
      await this.mutateCredentialStore(() => this.credentialStore.clear());
    } catch {
      throw new ApiError('secure_storage_unavailable');
    }
  }

  setActiveCompanyId(companyId: string | number | null): void {
    if (companyId === null) {
      this.activeCompanyId = null;
      return;
    }
    const normalized = String(companyId).trim();
    if (!normalized || /[\r\n]/.test(normalized)) throw new Error('Active company id is invalid.');
    this.activeCompanyId = normalized;
  }

  async hasSession(): Promise<boolean> {
    return Boolean(await this.loadCredentials());
  }

  private async loadCredentials(): Promise<SessionCredentials | null> {
    if (this.credentials !== undefined) return this.credentials;
    if (!this.credentialsLoad) {
      this.credentialsLoad = this.credentialStore
        .read()
        .then((credentials) => {
          this.credentials = credentials ? { ...credentials } : null;
          return this.credentials;
        })
        .catch(() => {
          this.credentials = null;
          throw new ApiError('secure_storage_unavailable');
        })
        .finally(() => {
          this.credentialsLoad = null;
        });
    }
    return this.credentialsLoad;
  }

  private async refresh(staleAccessToken: string): Promise<SessionCredentials> {
    const current = await this.loadCredentials();
    if (current && current.accessToken !== staleAccessToken) return current;
    if (this.refreshInFlight) return this.refreshInFlight;

    const epoch = this.sessionEpoch;
    const refreshPromise = this.performRefresh(epoch);
    this.refreshInFlight = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshInFlight === refreshPromise) this.refreshInFlight = null;
    }
  }

  private async performRefresh(epoch: number): Promise<SessionCredentials> {
    const current = await this.loadCredentials();
    if (!current) throw new ApiError('session_expired', 401);

    try {
      const result = await this.fetchEnvelope<unknown>(
        REFRESH_PATH,
        {
          method: 'POST',
          body: { refresh: current.refreshToken },
          authenticated: false,
          retryOnUnauthorized: false,
        },
        null,
        false,
      );
      if (!result.response.ok) throw safeApiError(result.response.status, false);
      const rotated = rotatedCredentials(result.data);
      if (!rotated) throw new ApiError('invalid_response');
      if (epoch !== this.sessionEpoch) throw new ApiError('session_expired', 401);
      await this.mutateCredentialStore(() => this.credentialStore.replace(rotated));
      if (epoch !== this.sessionEpoch) throw new ApiError('session_expired', 401);
      this.credentials = rotated;
      return rotated;
    } catch {
      if (epoch === this.sessionEpoch) await this.clearSessionSilently();
      throw new ApiError('session_expired', 401);
    }
  }

  private async fetchEnvelope<T>(
    path: `/${string}`,
    options: ApiRequestOptions,
    credentials: SessionCredentials | null,
    authenticated: boolean,
  ): Promise<{ response: Response; data?: T }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated && credentials) {
      headers.Authorization = `Bearer ${credentials.accessToken}`;
      if (this.activeCompanyId) headers['x-active-company-id'] = this.activeCompanyId;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.urlFor(path), {
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'omit',
        headers,
        method: options.method ?? 'GET',
        redirect: 'error',
      });
    } catch {
      throw new ApiError('network_unavailable');
    }

    if (!response.ok) return { response };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('invalid_response');
    }
    if (!isRecord(payload) || payload.status !== 'success' || !Object.hasOwn(payload, 'data')) {
      throw new ApiError('invalid_response');
    }
    return { response, data: (payload as unknown as ApiSuccessEnvelope<T>).data };
  }

  private urlFor(path: `/${string}`): string {
    const url = new URL(path.slice(1), `${this.baseUrl}/`);
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error('API path changed origin.');
    return url.toString();
  }

  private async clearSessionSilently(): Promise<void> {
    this.sessionEpoch += 1;
    this.credentials = null;
    this.credentialsLoad = null;
    this.activeCompanyId = null;
    try {
      await this.mutateCredentialStore(() => this.credentialStore.clear());
    } catch {
      // Memory is already purged; no native error details are exposed.
    }
  }

  private mutateCredentialStore(operation: () => Promise<void>): Promise<void> {
    const pending = this.credentialMutation.then(operation, operation);
    this.credentialMutation = pending.catch(() => undefined);
    return pending;
  }
}
