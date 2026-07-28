# Mobile App Context

- Implemented client: Expo SDK 57 + React Native 0.86 + React 19 + TypeScript 6 in `MobileApp/`, using Expo Router protected route groups.
- First release: employee self-service, iOS first, Android-compatible architecture.
- Existing Django API remains the sole business-rule and authorization authority.
- Read `plans/Employee Mobile App Master Plan.md` and `plans/API Route Status Matrix.md` before mobile work.
- Store mobile tokens only in Android Keystore/iOS Keychain through a native secure-storage library such as Expo SecureStore.
- The implemented credential adapter atomically stores only access and rotating refresh tokens with iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; user, active-company, notification, and HR data remain memory-only.
- Never use AsyncStorage or browser localStorage for tokens or sensitive HR data.
- Enforce ownership and organization scoping on the server; client guards are not security boundaries.
- Do not place JWTs in deep links, push payloads, logs, analytics, or uncontrolled WebSocket URLs.
- Protect payslip/document retrieval and avoid unnecessary offline caching.
- MVP: login, password change, dashboard, profile/status, attendance, leave, payslips, announcements, notifications, logout, English/Arabic, and RTL.
- `EXPO_PUBLIC_API_BASE_URL` is an origin only (no `/api` suffix). Central API code appends the verified Gate 1 paths and sends `x-active-company-id` on authenticated requests.
- HR/admin/approval consoles and offline submission are out of scope initially.

## Gate 3 implementation (2026-07-28)

- Feature layout: `src/features/{attendance,leave,notifications,more,home,shell}/`, each owning `*-api.ts`, `types.ts`, and its screens. Cross-feature helpers live in `src/features/shared/` (`Resource`, `useResource`, `ResourceFailure`, status maps, locale formatters).
- `useResource(load)` is the single load/refresh/retry/session-expiry hook. Pass a `useCallback`-stable loader; it holds no cache and writes nothing to storage.
- Failure vocabulary is `offline | forbidden | not-found | session-expired | unavailable`, derived only from `ApiError`. Render it with `<ResourceFailure />` rather than bespoke copy.
- Detail views are `DetailSheet` modals driven by in-memory selection. Do not add route parameters or `useLocalSearchParams`; the route surface is fixed at seven token-free paths and a QA invariant enforces it.
- Sensitive sheets (profile, payslips, documents) are conditionally mounted so data is fetched on open and discarded on close.
- Status is rendered with `<StatusBadge>` — a translated label plus a non-colour glyph. Unmapped server enums render no badge rather than leaking a raw identifier. Add new enums to `src/features/shared/status.ts` and both translation dictionaries.
- Server text reaches the UI only through `ApiError.details`, populated for HTTP 400/422 only and sanitized in `src/services/api/api-error.ts`. Never render `error.message`, `response.statusText`, or a response body.
- `src/qa/gate3-security-invariants.test.ts` holds an allowlist of every callable endpoint. Adding a path there is a deliberate contract decision — verify the Django route and update `plans/API Route Status Matrix.md` first.
- Mobile-only route facts: `/api/employees/me/documents/` is a real server-side `me` alias; announcement detail is wrapped as `data.announcement`; payslips require the strict `Employee` role while leave self-service also allows `Manager`/`HRManager`.
- Protected binary download (payslip PDF, employee document, announcement attachment) is deliberately **not** implemented — it would persist decrypted HR data to the device. `expo-file-system`, `expo-sharing`, and download helpers are blocked by invariant. This is a Gate 4 security decision.
- Language switching is session-scoped in `LocalizationProvider` state and must never be persisted. RTL comes from `directionHelpers`; `I18nManager.forceRTL` is not used.
