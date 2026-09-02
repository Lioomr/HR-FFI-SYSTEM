import type { ConfigContext, ExpoConfig } from 'expo/config';

import { parseEnvironment } from './src/config/environment-parser';

type AppVariant = 'production' | 'test';

function getAppVariant(): AppVariant {
  return process.env.FFI_APP_ENV === 'test' ? 'test' : 'production';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appVariant = getAppVariant();
  const isTestVariant = appVariant === 'test';
  const requireExplicitApiOrigin = process.env.FFI_REQUIRE_EXPLICIT_API_ORIGIN === 'true';
  const { apiBaseUrl } = parseEnvironment(process.env.EXPO_PUBLIC_API_BASE_URL, {
    isDevelopment: !requireExplicitApiOrigin,
  });

  return {
    ...config,
    name: isTestVariant ? 'FFI HR Employee Test' : 'FFI HR Employee',
    // EAS project IDs are permanently associated with one Expo slug. The test
    // variant remains isolated through its package ID, display name, and scheme.
    slug: 'ffi-hr-employee',
    scheme: isTestVariant ? 'ffihr-test' : 'ffihr',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: false,
      bundleIdentifier: isTestVariant ? 'com.ffihr.employee.test' : 'com.ffihr.employee',
      icon: './assets/expo.icon',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: isTestVariant ? 'com.ffihr.employee.test' : 'com.ffihr.employee',
      adaptiveIcon: {
        backgroundColor: '#FFF6E9',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: true,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-localization',
        {
          supportedLocales: {
            ios: ['en', 'ar'],
            android: ['en', 'ar'],
          },
          supportsRTL: true,
        },
      ],
      [
        // Foreground location only. Background, "always", motion, and the Android
        // foreground service are all explicitly disabled: attendance takes a single fix
        // while the employee is in the app and never tracks location afterwards.
        'expo-location',
        {
          locationWhenInUsePermission:
            'FFI HR uses your location only at the moment you check in or out, to confirm you are at an approved work location.',
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          motionUsagePermission: false,
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: false,
          isAndroidMotionActivityEnabled: false,
        },
      ],
      [
        // Gate 4 local re-authentication. iOS needs an explicit Face ID usage string or
        // the first challenge fails; Android gains only the biometric permissions.
        'expo-local-authentication',
        {
          faceIDPermission:
            'FFI HR uses Face ID to confirm it is you when you open the app and when you record attendance.',
        },
      ],
      [
        'expo-splash-screen',
        {
          backgroundColor: '#FFF6E9',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      apiBaseUrl,
      appEnvironment: appVariant,
      supportsRTL: true,
      eas: {
        projectId: 'ed02af1e-e111-41b0-b28f-758f538a27d6',
      },
    },
  };
};
