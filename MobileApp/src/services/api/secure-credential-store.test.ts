import { describe, expect, it, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';

import { ExpoSecureCredentialStore } from './secure-credential-store';
import type { SessionCredentials } from './types';

function adapter(initial: string | null = null) {
  let value = initial;
  return {
    deleteItemAsync: jest.fn(async () => {
      value = null;
    }),
    getItemAsync: jest.fn(async () => value),
    isAvailableAsync: jest.fn(async () => true),
    setItemAsync: jest.fn(
      async (_key: string, nextValue: string, _options?: SecureStore.SecureStoreOptions) => {
        value = nextValue;
      },
    ),
    value: () => value,
  };
}

describe('ExpoSecureCredentialStore', () => {
  const credentials: SessionCredentials = {
    accessToken: 'access-secret',
    refreshToken: 'refresh-secret',
  };

  it('persists credentials together with unlocked-device-only Keychain accessibility', async () => {
    const secureStore = adapter();
    const store = new ExpoSecureCredentialStore(secureStore);

    await store.replace(credentials);

    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(1);
    const [, serialized, options] = secureStore.setItemAsync.mock.calls[0];
    expect(JSON.parse(serialized)).toEqual(credentials);
    expect(options).toMatchObject({
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      keychainService: 'com.ffi.hr.session',
    });
    expect(serialized).not.toContain('activeCompany');
  });

  it('round-trips only the credential fields', async () => {
    const secureStore = adapter(
      JSON.stringify({ ...credentials, activeCompanyId: 'must-not-leave-secure-storage' }),
    );
    const store = new ExpoSecureCredentialStore(secureStore);

    await expect(store.read()).resolves.toEqual(credentials);
  });

  it('deletes corrupt records instead of exposing them', async () => {
    const secureStore = adapter('{not-json');
    const store = new ExpoSecureCredentialStore(secureStore);

    await expect(store.read()).resolves.toBeNull();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('fails closed when SecureStore is unavailable', async () => {
    const secureStore = adapter();
    secureStore.isAvailableAsync.mockResolvedValue(false);
    const store = new ExpoSecureCredentialStore(secureStore);

    await expect(store.read()).rejects.toMatchObject({ code: 'secure_storage_unavailable' });
  });
});
