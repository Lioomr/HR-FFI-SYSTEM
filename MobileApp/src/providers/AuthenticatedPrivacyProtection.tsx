import * as ScreenCapture from 'expo-screen-capture';
import { type PropsWithChildren, useEffect } from 'react';
import { Platform } from 'react-native';

const SCREEN_CAPTURE_KEY = 'authenticated-hr-content';
const APP_SWITCHER_BLUR_INTENSITY = 1;

export interface ScreenCaptureController {
  allowScreenCaptureAsync(key?: string): Promise<void>;
  disableAppSwitcherProtectionAsync(): Promise<void>;
  enableAppSwitcherProtectionAsync(blurIntensity?: number): Promise<void>;
  preventScreenCaptureAsync(key?: string): Promise<void>;
}

interface AuthenticatedPrivacyProtectionProps extends PropsWithChildren {
  active: boolean;
  platform?: typeof Platform.OS;
  screenCapture?: ScreenCaptureController;
}

function disableProtection(
  screenCapture: ScreenCaptureController,
  protectAppSwitcher: boolean,
): Promise<PromiseSettledResult<void>[]> {
  const operations = [screenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY)];
  if (protectAppSwitcher) operations.push(screenCapture.disableAppSwitcherProtectionAsync());
  return Promise.allSettled(operations);
}

export function AuthenticatedPrivacyProtection({
  active,
  children,
  platform = Platform.OS,
  screenCapture = ScreenCapture,
}: AuthenticatedPrivacyProtectionProps) {
  useEffect(() => {
    if (!active) return undefined;

    const protectAppSwitcher = platform === 'ios';
    const operations = [screenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY)];
    if (protectAppSwitcher) {
      operations.push(screenCapture.enableAppSwitcherProtectionAsync(APP_SWITCHER_BLUR_INTENSITY));
    }

    const activation = Promise.allSettled(operations);
    return () => {
      // Cleanup runs immediately and again after any in-flight activation, so a fast
      // logout cannot leave a late native enablement behind. Android Recents is covered
      // by FLAG_SECURE; the additional app-switcher overlay is iOS-only.
      void disableProtection(screenCapture, protectAppSwitcher);
      void activation.then(() => disableProtection(screenCapture, protectAppSwitcher));
    };
  }, [active, platform, screenCapture]);

  return children;
}
