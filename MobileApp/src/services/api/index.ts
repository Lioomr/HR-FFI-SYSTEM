import { environment } from '@/config/environment';

import { ApiClient } from './api-client';
import { ExpoSecureCredentialStore } from './secure-credential-store';

export { ApiClient, validateApiBaseUrl } from './api-client';
export { ApiError } from './api-error';
export { ExpoSecureCredentialStore } from './secure-credential-store';
export type * from './types';

export const credentialStore = new ExpoSecureCredentialStore();
export const apiClient = new ApiClient({
  allowInsecureDevelopment: __DEV__,
  baseUrl: environment.apiBaseUrl,
  credentialStore,
});
