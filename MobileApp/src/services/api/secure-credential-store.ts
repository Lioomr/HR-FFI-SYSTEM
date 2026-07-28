import * as SecureStore from 'expo-secure-store';

import { ApiError } from './api-error';
import type { CredentialStore, SessionCredentials } from './types';

const SESSION_KEY = 'ffi.hr.session.credentials.v1';
const KEYCHAIN_SERVICE = 'com.ffi.hr.session';

type SecureStoreAdapter = Pick<
  typeof SecureStore,
  'deleteItemAsync' | 'getItemAsync' | 'isAvailableAsync' | 'setItemAsync'
>;

function isCredentialRecord(value: unknown): value is SessionCredentials {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SessionCredentials>;
  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.refreshToken === 'string' &&
    candidate.refreshToken.length > 0
  );
}

/** Stores both rotating credentials in one Keychain item so replacement is atomic. */
export class ExpoSecureCredentialStore implements CredentialStore {
  private readonly options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    keychainService: KEYCHAIN_SERVICE,
  };

  constructor(private readonly secureStore: SecureStoreAdapter = SecureStore) {}

  async read(): Promise<SessionCredentials | null> {
    await this.assertAvailable();
    let raw: string | null;
    try {
      raw = await this.secureStore.getItemAsync(SESSION_KEY, this.options);
    } catch {
      throw new ApiError('secure_storage_unavailable');
    }
    if (raw === null) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (isCredentialRecord(parsed)) {
        return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
      }
    } catch {
      // Corrupt or legacy data is deleted below and never exposed to callers.
    }

    await this.clear();
    return null;
  }

  async replace(credentials: SessionCredentials): Promise<void> {
    if (!isCredentialRecord(credentials)) throw new ApiError('secure_storage_unavailable');
    await this.assertAvailable();
    try {
      await this.secureStore.setItemAsync(SESSION_KEY, JSON.stringify(credentials), this.options);
    } catch {
      throw new ApiError('secure_storage_unavailable');
    }
  }

  async clear(): Promise<void> {
    await this.assertAvailable();
    try {
      await this.secureStore.deleteItemAsync(SESSION_KEY, this.options);
    } catch {
      throw new ApiError('secure_storage_unavailable');
    }
  }

  private async assertAvailable(): Promise<void> {
    try {
      if (await this.secureStore.isAvailableAsync()) return;
    } catch {
      // Normalize native errors without retaining implementation details.
    }
    throw new ApiError('secure_storage_unavailable');
  }
}
