import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Local re-authentication for the two surfaces Gate 4 protects: restoring a stored
 * session on a cold launch, and recording attendance.
 *
 * A device that offers no local check at all is refused, not passed through: an HR
 * client holding salary and identity data must not open on a device with neither a
 * biometric nor a passcode. `unavailable` is reported separately from `refused` so the
 * lock screen can tell the employee to set a device passcode instead of looping them
 * through a challenge that can never succeed.
 */
export type ReauthFailure = 'refused' | 'unavailable';

export type ReauthOutcome = { status: 'passed' } | { status: 'failed'; reason: ReauthFailure };

export interface ReauthPrompt {
  promptMessage: string;
  cancelLabel: string;
}

/**
 * Seam for tests. Production binds these to `expo-local-authentication`, imported in
 * this module alone so the QA invariant can prove no screen calls the native API
 * directly.
 */
export interface BiometricProvider {
  getEnrolledLevel: () => Promise<LocalAuthentication.SecurityLevel>;
  authenticate: (prompt: ReauthPrompt) => Promise<{ success: boolean }>;
}

export const expoBiometricProvider: BiometricProvider = {
  getEnrolledLevel: () => LocalAuthentication.getEnrolledLevelAsync(),
  authenticate: ({ promptMessage, cancelLabel }) =>
    LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      // Device passcode remains available, so an employee whose biometric fails or who
      // has none enrolled can still satisfy the gate without a bypass.
      disableDeviceFallback: false,
    }),
};

/**
 * Runs one local authentication challenge. The result is a decision plus a coarse
 * reason only: no biometric material, native error, or prompt detail is returned,
 * retained, or stored.
 */
export async function requireLocalAuthentication(
  prompt: ReauthPrompt,
  provider: BiometricProvider = expoBiometricProvider,
): Promise<ReauthOutcome> {
  let enrolled: LocalAuthentication.SecurityLevel;
  try {
    enrolled = await provider.getEnrolledLevel();
  } catch {
    // An unreadable enrolment state is treated as no protection, never as a pass.
    return { status: 'failed', reason: 'unavailable' };
  }

  if (enrolled === LocalAuthentication.SecurityLevel.NONE) {
    return { status: 'failed', reason: 'unavailable' };
  }

  try {
    const result = await provider.authenticate(prompt);
    return result.success ? { status: 'passed' } : { status: 'failed', reason: 'refused' };
  } catch {
    // A thrown challenge is a failure, never an implicit pass.
    return { status: 'failed', reason: 'refused' };
  }
}

export type Reauthenticate = (prompt: ReauthPrompt) => Promise<ReauthOutcome>;
