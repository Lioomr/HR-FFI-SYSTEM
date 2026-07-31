import { describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Text } from 'react-native';

import {
  AuthenticatedPrivacyProtection,
  type ScreenCaptureController,
} from './AuthenticatedPrivacyProtection';

function createScreenCaptureController(): ScreenCaptureController {
  return {
    allowScreenCaptureAsync: jest.fn(async () => undefined),
    disableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
    enableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
    preventScreenCaptureAsync: jest.fn(async () => undefined),
  };
}

function privacyBoundary(
  active: boolean,
  screenCapture: ScreenCaptureController,
  platform: 'android' | 'ios' = 'ios',
) {
  return (
    <AuthenticatedPrivacyProtection
      active={active}
      platform={platform}
      screenCapture={screenCapture}
    >
      <Text>Protected employee content</Text>
    </AuthenticatedPrivacyProtection>
  );
}

describe('AuthenticatedPrivacyProtection', () => {
  it('enables capture and app-switcher protection for the authenticated root', async () => {
    const screenCapture = createScreenCaptureController();
    const view = await render(privacyBoundary(true, screenCapture));

    expect(view.getByText('Protected employee content')).toBeTruthy();
    await waitFor(() =>
      expect(screenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith(
        'authenticated-hr-content',
      ),
    );
    expect(screenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(1);
  });

  it('does not protect the unauthenticated login state', async () => {
    const screenCapture = createScreenCaptureController();
    await render(privacyBoundary(false, screenCapture));

    expect(screenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(screenCapture.enableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
    expect(screenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
    expect(screenCapture.disableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
  });

  it('cleans up capture and app-switcher protection on logout', async () => {
    const screenCapture = createScreenCaptureController();
    const view = await render(privacyBoundary(true, screenCapture));
    await waitFor(() => expect(screenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalled());

    await view.rerender(privacyBoundary(false, screenCapture));

    await waitFor(() =>
      expect(screenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith(
        'authenticated-hr-content',
      ),
    );
    expect(screenCapture.disableAppSwitcherProtectionAsync).toHaveBeenCalled();
  });

  it('cleans up safely when the authenticated root unmounts', async () => {
    const screenCapture = createScreenCaptureController();
    const view = await render(privacyBoundary(true, screenCapture));
    await waitFor(() => expect(screenCapture.preventScreenCaptureAsync).toHaveBeenCalled());

    await view.unmount();

    await waitFor(() => expect(screenCapture.allowScreenCaptureAsync).toHaveBeenCalled());
    expect(screenCapture.disableAppSwitcherProtectionAsync).toHaveBeenCalled();
  });

  it('uses native inactive/background protection on iOS and Android', async () => {
    const iosScreenCapture = createScreenCaptureController();
    const androidScreenCapture = createScreenCaptureController();
    const ios = await render(privacyBoundary(true, iosScreenCapture, 'ios'));
    const android = await render(privacyBoundary(true, androidScreenCapture, 'android'));

    await waitFor(() =>
      expect(iosScreenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(1),
    );
    await waitFor(() =>
      expect(androidScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith(
        'authenticated-hr-content',
      ),
    );
    expect(androidScreenCapture.enableAppSwitcherProtectionAsync).not.toHaveBeenCalled();

    await ios.unmount();
    await android.unmount();
  });

  it('adds no protected-binary, persistence, WebView, sharing, or token capability', () => {
    const appRoot = join(__dirname, '..', '..');
    const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const rootLayout = readFileSync(join(appRoot, 'src', 'app', '_layout.tsx'), 'utf8');
    const privacySource = readFileSync(
      join(appRoot, 'src', 'providers', 'AuthenticatedPrivacyProtection.tsx'),
      'utf8',
    );

    expect(packageJson.dependencies?.['expo-screen-capture']).toBe('~57.0.1');
    for (const blockedDependency of ['expo-file-system', 'expo-sharing', 'react-native-webview']) {
      expect(packageJson.dependencies?.[blockedDependency]).toBeUndefined();
    }
    expect(rootLayout).toContain('<AuthenticatedPrivacyProtection active={isAuthenticated}>');
    expect(`${rootLayout}\n${privacySource}`).not.toMatch(
      /\/api\/|accessToken|refreshToken|Authorization|signed[_-]?url|\bWebView\b|console\./u,
    );
  });
});
