import { apiClient } from '@/services/api';

import { AuthClient } from './auth-client';

export { AuthClient } from './auth-client';
export type * from './types';

export const authClient = new AuthClient(apiClient);
