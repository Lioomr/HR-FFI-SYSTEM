import { describe, expect, it, jest } from '@jest/globals';
import { SecurityLevel } from 'expo-local-authentication';

import { requireLocalAuthentication, type BiometricProvider } from './biometrics';

const prompt = { promptMessage: 'Confirm it is you', cancelLabel: 'Cancel' };

function provider(overrides: Partial<BiometricProvider> = {}): BiometricProvider {
  return {
    getEnrolledLevel: async () => SecurityLevel.BIOMETRIC_STRONG,
    authenticate: async () => ({ success: true }),
    ...overrides,
  };
}

describe('local re-authentication', () => {
  it('passes when the device owner satisfies the challenge', async () => {
    expect(await requireLocalAuthentication(prompt, provider())).toEqual({ status: 'passed' });
  });

  it('forwards the caller-supplied localized prompt to the platform', async () => {
    const authenticate = jest.fn(provider().authenticate);
    await requireLocalAuthentication(prompt, provider({ authenticate }));

    expect(authenticate).toHaveBeenCalledWith(prompt);
  });

  it('fails a refused or cancelled challenge', async () => {
    const outcome = await requireLocalAuthentication(
      prompt,
      provider({ authenticate: async () => ({ success: false }) }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'refused' });
  });

  it('fails rather than passing when the challenge throws', async () => {
    const outcome = await requireLocalAuthentication(
      prompt,
      provider({
        authenticate: async () => {
          throw new Error('LAError domain 0');
        },
      }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'refused' });
  });

  it('refuses a device with no biometric and no passcode, without prompting', async () => {
    const authenticate = jest.fn(provider().authenticate);
    const outcome = await requireLocalAuthentication(
      prompt,
      provider({ getEnrolledLevel: async () => SecurityLevel.NONE, authenticate }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('refuses rather than passing when the enrolment query is unreadable', async () => {
    const outcome = await requireLocalAuthentication(
      prompt,
      provider({
        getEnrolledLevel: async () => {
          throw new Error('module not available');
        },
      }),
    );

    expect(outcome).toEqual({ status: 'failed', reason: 'unavailable' });
  });

  it('never passes on any failure path', async () => {
    const paths = [
      provider({ getEnrolledLevel: async () => SecurityLevel.NONE }),
      provider({
        getEnrolledLevel: async () => {
          throw new Error('unreadable');
        },
      }),
      provider({ authenticate: async () => ({ success: false }) }),
      provider({
        authenticate: async () => {
          throw new Error('thrown');
        },
      }),
    ];

    for (const p of paths) {
      expect((await requireLocalAuthentication(prompt, p)).status).toBe('failed');
    }
  });

  it('challenges a passcode-only device rather than passing it through', async () => {
    const authenticate = jest.fn(provider().authenticate);
    const outcome = await requireLocalAuthentication(
      prompt,
      provider({ getEnrolledLevel: async () => SecurityLevel.SECRET, authenticate }),
    );

    expect(outcome).toEqual({ status: 'passed' });
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('returns a decision only, retaining no native error or biometric detail', async () => {
    const outcome = await requireLocalAuthentication(
      prompt,
      provider({
        authenticate: async () => {
          throw new Error('Bearer abc.def.ghi https://internal.example.com');
        },
      }),
    );

    expect(Object.keys(outcome).sort()).toEqual(['reason', 'status']);
    expect(JSON.stringify(outcome)).not.toMatch(/Bearer|https?:\/\//u);
  });
});
