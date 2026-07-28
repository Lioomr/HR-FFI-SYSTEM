# Expo SDK 54 Compatibility Pin â€” Restored

## Current purpose

The dependency tree was temporarily pinned to Expo SDK 54 only to allow a preliminary physical-iPhone smoke test in Expo Go 54.0.2. That temporary state did not pass Gate 2 and was not approved as the production or native-acceptance baseline.

## Mandatory restoration rule

**Restoration completed on 2026-07-24.** Expo SDK 57 is now required for all feature work, dependency upgrades, EAS builds, native acceptance runs, and Gate 3 activity. Do not layer upgrades or new application work on the former SDK 54 dependency tree.

The validated SDK 57 baseline is:

- Expo `~57.0.7`, React Native `0.86.0`, React/React DOM `19.2.3`, TypeScript `~6.0.3`.
- Expo Router `~57.0.7`, Jest Expo `~57.0.2`, and ESLint Config Expo `^57.0.0`.
- `@expo/ui ~57.0.7`, `expo-constants ~57.0.6`, `expo-dev-client ~57.0.7`, `expo-device ~57.0.1`, `expo-font ~57.0.1`, `expo-glass-effect ~57.0.1`, `expo-image ~57.0.1`, `expo-linking ~57.0.3`, `expo-localization ~57.0.1`, `expo-secure-store ~57.0.1`, `expo-splash-screen ~57.0.4`, `expo-status-bar ~57.0.1`, `expo-symbols ~57.0.1`, `expo-system-ui ~57.0.1`, and `expo-web-browser ~57.0.1`.
- `@react-native-community/netinfo 12.0.1`, `react-native-gesture-handler ~2.32.0`, `react-native-reanimated 4.5.0`, `react-native-safe-area-context ~5.7.0`, `react-native-screens 4.25.2`, `react-native-web ~0.21.0`, and `react-native-worklets 0.10.0`.
- `@types/react ~19.2.2`.

## Restoration evidence

1. Metro and Expo Go smoke-test use were stopped before the dependency transition.
2. `package.json` and the lockfile were rebuilt as one coherent SDK 57 dependency tree.
3. `npx expo install --check` reports that dependencies are up to date.
4. TypeScript, lint, formatting, Jest (81 tests), Expo Doctor (20/20), public config, and the iOS export all pass.
5. `npx expo config --type public --json` reports `sdkVersion: 57.0.0`.
6. `react-native-screens` uses Expo's required SDK 57 patch version `~4.26.0`.

Do not weaken authentication, certificate validation, SecureStore handling, API-origin validation, or tests during future dependency changes.
