import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { PropsWithChildren } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LocalizationProvider } from '@/i18n';
import {
  AuthenticatedPrivacyProtection,
  AuthProvider,
  NotificationPollingProvider,
  useAuth,
} from '@/providers';

function RootNavigator() {
  const { status } = useAuth();
  const isAuthenticated = status === 'authenticated';
  // An unreachable bootstrap is not "bootstrapped": neither group may take over the
  // stack, so the entry route keeps rendering its retryable offline state.
  const hasBootstrapped = status === 'authenticated' || status === 'unauthenticated';

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={hasBootstrapped && !isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={hasBootstrapped && isAuthenticated}>
        <Stack.Screen name="(protected)" />
      </Stack.Protected>
    </Stack>
  );
}

function AuthenticatedRuntime({ children }: PropsWithChildren) {
  const { status } = useAuth();
  const isAuthenticated = status === 'authenticated';

  return (
    <AuthenticatedPrivacyProtection active={isAuthenticated}>
      {isAuthenticated ? (
        <NotificationPollingProvider>{children}</NotificationPollingProvider>
      ) : (
        children
      )}
    </AuthenticatedPrivacyProtection>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LocalizationProvider>
          <AuthProvider>
            <AuthenticatedRuntime>
              <StatusBar style="dark" />
              <RootNavigator />
            </AuthenticatedRuntime>
          </AuthProvider>
        </LocalizationProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
