import type { ConfigContext, ExpoConfig } from 'expo/config';

import { parseEnvironment } from './src/config/environment-parser';

export default ({ config }: ConfigContext): ExpoConfig => {
  const requireExplicitApiOrigin = process.env.FFI_REQUIRE_EXPLICIT_API_ORIGIN === 'true';
  const { apiBaseUrl } = parseEnvironment(process.env.EXPO_PUBLIC_API_BASE_URL, {
    isDevelopment: !requireExplicitApiOrigin,
  });

  return {
    ...config,
    name: 'FFI HR Employee',
    slug: 'ffi-hr-employee',
    scheme: 'ffihr',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.ffihr.employee',
      icon: './assets/expo.icon',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.ffihr.employee',
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
      supportsRTL: true,
      eas: {
        projectId: 'ed02af1e-e111-41b0-b28f-758f538a27d6',
      },
    },
  };
};
