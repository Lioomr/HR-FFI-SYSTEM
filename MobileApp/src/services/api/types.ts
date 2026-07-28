export type FetchLike = typeof globalThis.fetch;

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiSuccessEnvelope<T> {
  status: 'success';
  data: T;
  message?: string;
}

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  authenticated?: boolean;
  retryOnUnauthorized?: boolean;
}

export interface SessionCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface CredentialStore {
  read(): Promise<SessionCredentials | null>;
  replace(credentials: SessionCredentials): Promise<void>;
  clear(): Promise<void>;
}
