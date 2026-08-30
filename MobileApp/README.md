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

## Isolated test app

The test app variant installs separately from production:

- App name: `FFI HR Employee Test`
- iOS bundle ID: `com.ffihr.employee.test`
- Android package: `com.ffihr.employee.test`
- URL scheme: `ffihr-test`

For local testing, copy `.env.test.example` to `.env.test.local` if you want a
saved local reference, then run one of the test scripts:

```powershell
npm run start:test
npm run ios:test
npm run android:test
npm run web:test
```

The local scripts point at `http://localhost:8000`, except Android emulator builds
which use `http://10.0.2.2:8000`. For a physical phone, replace the API origin with
a reachable HTTPS test API.

For an isolated EAS build, configure the preview environment with the test API
origin, then build the `test` profile:

```powershell
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_BASE_URL --value https://test-api.example.com --environment preview --visibility plaintext
npx eas-cli@latest build --platform ios --profile test
npx eas-cli@latest build --platform android --profile test
```

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
- `src/features`: feature-owned components, hooks, types, and API adapters
  (`attendance`, `leave`, `notifications`, `more`, `home`, `shell`, plus
  cross-feature helpers in `shared`).
- `src/services`: shared platform and network services.
- `src/components`: shared presentation primitives.
- `src/qa`: independent security/accessibility invariant suites and the test harness.

Screens must not call the network directly. Authentication credentials are stored
only through Expo SecureStore; sensitive HR server data remains memory-only.

## Feature conventions

- Load data with `useResource(load)` from `@/features/shared` and pass a
  `useCallback`-stable loader. Render failures with `<ResourceFailure />` so every
  screen shares one offline / forbidden / not-found / session-expired vocabulary.
- Show record detail in a `DetailSheet` driven by in-memory selection. Do not add
  route parameters or `useLocalSearchParams` — the route surface is fixed at seven
  token-free paths and `src/qa/gate3-security-invariants.test.ts` enforces it.
- Render status with `<StatusBadge>`: a translated label plus a redundant
  non-colour glyph. Register new server enums in `src/features/shared/status.ts`
  and in both translation dictionaries.
- Server text may reach the UI only through `ApiError.details`, which is populated
  for HTTP 400/422 only and sanitized in `src/services/api/api-error.ts`.
- Every callable endpoint is allowlisted in the Gate 3 invariant suite. Verify the
  Django route and update `plans/API Route Status Matrix.md` before adding one.
- Protected binary files are web-app-only for the first mobile release. The app shows
  structured payslip details, employee document metadata, and announcement metadata,
  but must not fetch, render, persist, share, export, open a WebView, deep-link to, or
  use signed URLs for protected binaries. Future mobile viewing requires a separate
  security-reviewed design; this decision does not mark Gate 4 passed.

## Quality checks

```powershell
npm run type-check
npm run lint
npm run format:check
npm test
npm run doctor
```
