# FFI HR Employee Mobile

iOS-first, Android-compatible employee self-service client built with Expo SDK 57,
React Native, TypeScript, and Expo Router.

> **SDK baseline:** the project is restored to Expo SDK 57 for EAS and native
> acceptance work. The earlier SDK 54 Expo Go smoke-test pin is recorded in
> `SDK_VERSION_NOTICE.md`; do not reintroduce it for feature or native work.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `EXPO_PUBLIC_API_BASE_URL` to the Django origin (for example,
   `https://hr.example.com`, with no `/api` suffix).
3. Run `npm install`.
4. Run `npm start`, `npm run ios`, or `npm run android`.

Plain HTTP API URLs are accepted only in development or for loopback hosts. Preview
and production builds require an explicit HTTPS URL.

## EAS iOS validation

The app is linked to the EAS project declared in `extra.eas.projectId`. Every EAS
profile fails closed unless `EXPO_PUBLIC_API_BASE_URL` is defined in its selected
EAS environment. The value is public client configuration, not a secret, and must
be an HTTPS origin with no credentials, query, fragment, or `/api` path suffix.

Before a cloud build, configure the approved non-production API origin in the EAS
`development` environment, then verify the resolved configuration:

```powershell
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_BASE_URL --value https://mobile-api.example.com --environment development --visibility plaintext
npx eas-cli@latest config --platform ios --profile ios-simulator
npx eas-cli@latest build --platform ios --profile ios-simulator
```

Replace the example origin with the approved reachable HTTPS test API. Do not use
`localhost` for a physical iPhone. Preview and production environments must be
configured separately before those profiles are used.

## Project structure

- `src/app`: Expo Router route groups and screen entry points.
- `src/auth`: session state and secure credential lifecycle.
- `src/config`: validated public runtime configuration.
- `src/design-system`: tokens and reusable visual foundations.
- `src/features`: feature-owned components, hooks, types, and API adapters.
- `src/services`: shared platform and network services.
- `src/components`: shared presentation primitives.

Screens must not call the network directly. Authentication credentials are stored
only through Expo SecureStore; sensitive HR server data remains memory-only.

## Quality checks

```powershell
npm run type-check
npm run lint
npm run format:check
npm test
npm run doctor
```
