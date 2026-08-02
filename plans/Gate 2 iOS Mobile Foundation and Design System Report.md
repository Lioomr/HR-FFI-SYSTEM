# Gate 2 — iOS Mobile Foundation and Design System Report

**Date:** 2026-07-28  
**Repository:** `D:\FFI HR SYSTEM\HR-FFI-SYSTEM`  
**Decision:** **PASS — native iOS Simulator acceptance approved**

## Executive result

Gate 2 produced the requested Expo/React Native employee client and passed every validation available on this Windows host. The app has a protected five-tab shell, the approved Option 2 home dashboard, secure rotating-token handling, English/Arabic RTL support, accessible design primitives, foreground REST notification polling, and regression/security tests. The temporary Expo SDK 54 Expo Go smoke-test pin was removed on 2026-07-24; the validated Expo SDK 57 baseline now passes dependency compatibility, TypeScript, lint, formatting, Jest (81 tests), Expo Doctor (20/20), public-config, and iOS-export checks.

No critical or high security blocker was found. The native acceptance requirement was subsequently completed on 2026-07-28 using the finished EAS iOS Simulator build `a2c59ef1-877b-4b17-8ec2-3c12467a641a`, SDK 57, and the isolated HTTPS staging API `https://api-mobile-dev.asecopro.com`. The project owner installed and launched the build on a macOS-hosted Simulator, approved the native test, and explicitly approved Gate 2.

`MobileApp/` was created only after the completed Gate 1 report was reviewed. No backend code, migration, API path, API response contract, `SECURITY_POLICY.md`, `plans/Global API Rules (v1).txt`, or `plans/API Route Status Matrix.md` was changed during Gate 2.

## Implemented changes

### Foundation and configuration

- Expo SDK 57, React Native 0.86, React 19, TypeScript 6, Expo Router, and React Compiler.
- iOS-first light application with Android-compatible configuration.
- Bundle/package identifier `com.ffihr.employee`, URL scheme `ffihr`, and development, iOS Simulator, preview, and production EAS profiles.
- Validated `EXPO_PUBLIC_API_BASE_URL` as an origin only. Release profiles require HTTPS; development permits loopback HTTP. Credentials, query strings, fragments, and URL paths are rejected.
- ESLint with zero-warning enforcement, Prettier, Jest/Expo, React Native Testing Library, and Expo Doctor commands.

### Navigation and state

- Expo Router `(auth)` and `(protected)` route groups guarded with protected routes.
- Five tabs: Home, Attendance, Leave, Notifications, and More.
- Authenticated bootstrap, login, session-expired transition, password change, and logout.
- Localized loading, empty, error, offline, and session-expired states.
- User, active company, dashboard, and unread notification data are memory-only.

### Authentication and API security

- Exact verified Gate 1 endpoints:
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `POST /auth/change-password`
  - `GET /auth/me`
- Access and refresh tokens are stored atomically in a single Expo SecureStore record. iOS uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and a dedicated Keychain service.
- Central fixed-origin API client adds `Authorization: Bearer ...` and `x-active-company-id` only to authenticated requests.
- Single-flight refresh and one-time replay prevent parallel refresh races. Refresh sends only the refresh body and no stale bearer/company header.
- Invalid refresh responses, refresh failure, a second 401, logout, password change, and failed restore purge the session. Network and server details are normalized to safe errors.
- Requests omit browser credentials and reject redirects. Screens do not call `fetch` directly.

### Design system, accessibility, and localization

- Approved palette: orange `#FF7F3E`, cream `#FFF6E9`, near-black `#1F1F1F`, muted `#6B6B6B`, border `#E5E5E5`; extra colors are semantic status colors only.
- Reusable tokens and primitives for type, spacing, radii, elevation, motion, screen layout, text, icons, buttons, fields, cards, state views, and the attendance pulse.
- Option 2 visual direction: quiet cream canvas, restrained cards, high-information spacing, and a warm attendance pulse/orbit motif.
- Minimum 44-point touch targets, Dynamic Type, safe-area layout, screen-reader labels/hints/live regions, reduced-motion behavior, and RTL-aware layout/text.
- QA identified that orange foreground text/icons and an orange-only focus border did not meet contrast requirements on cream. The design was remediated to use dark text/icons and focus borders, with orange retained for filled buttons, soft selected containers, and redundant decorative emphasis. A regression invariant now prevents reintroducing orange foreground text/icon tones.
- Typed English and Arabic translations, device/per-app locale selection with English fallback, RTL metadata/helpers, and locale-aware date, time, number, and currency formatting. Locale is not persisted by the app.

### Home dashboard and REST polling

- Option 2 home includes greeting, attendance status/timeline, leave balances, announcements, unread summary, pull to refresh, and Request Leave navigation.
- It uses the exact verified paths:
  - `GET /api/attendance/me/?page=1&page_size=7`
  - `GET /api/leaves/employee/leave-balance/?year=<current-year>`
  - `GET /api/announcements/?page=1&page_size=3`
  - `GET /api/notifications/unread-count/`
- Dashboard sections use independent settled requests; a failure in one section does not discard successful data from the others. Session-expired errors still transition the whole app to unauthenticated state.
- Unread count polls immediately and every 20 seconds only while authenticated and foregrounded. Polling stops on background, logout, and unmount. No WebSocket, push registration, background polling, or persistent notification cache was introduced.

## Changed files

All application changes are under `MobileApp/`; planning/context changes are listed separately.

- Project/config: `.env.example`, `.gitignore`, `.prettierignore`, `.prettierrc.json`, `app.config.ts`, `eas.json`, `eslint.config.js`, `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `AGENTS.md`, editor settings, and generated application assets.
- Accessibility/localization: `src/accessibility/**`, `src/i18n/**`.
- App/router/providers: `src/app/**`, `src/providers/**`.
- Auth/API/config: `src/auth/**`, `src/services/api/**`, `src/config/**`.
- Design/UI: `src/design-system/**`, `src/components/ui/**`.
- Features: `src/features/home/**`, `src/features/shell/**`.
- Independent QA: `src/qa/gate2-security-invariants.test.ts`.
- Documentation: `plans/Employee Mobile App Master Plan.md`, `.agents/context/mobile_app.md`, and this report.

## Bounded agent findings

| Agent | Ownership | Finding/result |
|---|---|---|
| Architecture | Scaffold/config/tooling only | SDK 57 scaffold, identifiers, EAS profiles, environment validation, and quality tooling are compatible; Expo Doctor passes 20/20. |
| Design system | Tokens and shared UI primitives | Implemented the approved Option 2 system with reusable accessible primitives, touch sizing, Dynamic Type, RTL, and reduced motion. |
| Navigation/shell | Router, auth shell, tabs, polling provider | Protected routing, five tabs, state screens, password change/logout, and foreground-only 20-second REST polling work with provider tests. |
| Authentication client | Auth and shared API services | Gate 1 auth contract, atomic SecureStore rotation, single-flight refresh, revocation-driven clearing, company header, and safe errors are covered by regression tests. |
| Home dashboard | Home feature only | Exact attendance/leave/announcement/unread paths, partial-failure handling, pull refresh, and the Option 2 dashboard are tested without persistent caching. |
| Localization/accessibility | i18n and accessibility helpers | English/Arabic, RTL, locale formatters, screen-reader helpers, touch sizing, and reduced-motion support are covered by tests. |
| Independent QA/security | Read-only production review plus `src/qa/**` tests | Recommended code/security PASS with zero critical/high findings. Found the orange-on-cream contrast defect; remediation was rechecked and the security/accessibility invariant suite passes. The lead orchestrator keeps the overall gate BLOCKED because the explicit acceptance rule requires a native iOS build/run. |

## Validation evidence

Commands were run from `MobileApp/` unless noted.

| Command | Result |
|---|---|
| `npm ci` | Passed; lockfile installation is reproducible. |
| `npm run type-check` | Passed; TypeScript emitted no errors. |
| `npm run lint` | Passed with zero warnings. |
| `npm run format:check` | Passed; all tracked source/config/document files match Prettier. Generated iOS export output is ignored. |
| `npm test -- --runInBand` | Passed: **17 suites, 76 tests, 0 failures**. |
| `npx expo-doctor` | Passed: **20/20 checks**. |
| `npx expo install --check` | Passed; installed Expo dependencies are compatible and up to date. |
| `npx expo export --platform ios --output-dir dist-ios-final --clear` | Passed: **1,826 modules**, one iOS Hermes bytecode bundle (~3.8 MB), 23 assets. |
| `npm audit signatures` | Passed: **1,089 registry signatures** verified, including 178 attestations. |
| `npm audit --audit-level=high` | Exit 0; **0 critical, 0 high, 11 moderate** transitive findings. |
| Production static scan for AsyncStorage/localStorage/sessionStorage/WebSocket/query tokens/unsafe evaluation/production console calls | Passed; no forbidden production pattern found. |
| `npx expo prebuild --platform ios --no-install` | Failed as expected on Windows: Expo skipped iOS native project generation and requires another supported host. No `ios/` directory was created. |
| `npx eas-cli@latest whoami` and `project:info` | Passed: authenticated as `lioomr`; project `@lioomr/ffi-hr-employee` matches `ed02af1e-e111-41b0-b28f-758f538a27d6`. |

The test suite covers environment rejection paths; exact auth and dashboard routes; token persistence/rotation/clearing; refresh concurrency and replay; company header behavior; no stale auth on refresh; login/session/logout/password-change providers; five-tab route bounds; foreground/background notification polling; Option 2 rendering; partial dashboard failure; English/Arabic/RTL/formatting; design tokens; touch/accessibility helpers; and independent storage/network/logging/WebSocket/token-route invariants.

## Security and API review

- Backend authorization remains authoritative. The mobile router and tab visibility are UX boundaries only.
- No API path or response contract was changed. The earlier scaffold default that included `/api` in the base URL was corrected before acceptance; base configuration is now origin-only, avoiding `/api/auth/...` and `/api/api/...` drift.
- No token is placed in AsyncStorage, browser storage, SQLite, a URL, route parameters, log, WebSocket, push payload, or HR-data cache.
- Neither SQLite nor AsyncStorage is installed; no SQLite process or database was run or created.
- No WebSocket dependency or URL exists in production source. REST polling remains the baseline established by Gate 1.
- Private document and payslip behavior was not reimplemented or weakened in the client. Those screens remain Gate 3 work and must consume the authenticated Gate 1 endpoints on demand.
- No backend file was changed, so the Gate 1 Docker/PostgreSQL authorization evidence remains the acceptance source for attendance, tenant isolation, attachments, documents, and payslips.

## Remaining risks and follow-up work

1. **Native iOS acceptance — passed:** the iOS Simulator development build was installed and launched on macOS against isolated staging. Password-change session revocation was specifically approved. Repeat the full native regression matrix before any release candidate.
2. **Moderate transitive tooling advisory — tracked, not blocking:** 11 moderate `uuid` findings arrive through Expo's `xcode`/config tooling. The offered forced audit fix changes Expo dependencies incompatibly, so it was not applied. Recheck when Expo publishes a compatible resolution.
3. **Device-only behavior — release follow-up:** repeat Keychain availability, per-app language/RTL restart behavior, Dynamic Type extremes, VoiceOver focus order, safe areas, background/foreground polling, and reduced motion during release-candidate validation.
4. **Placeholder feature tabs — expected scope:** Attendance, Leave, Notifications, and More have a working shell/state architecture, but full employee workflows are Gate 3.
5. **Release configuration — future gates:** production API origin, EAS project/account ownership, Apple signing, privacy declarations, deep-link policy, protected document viewing, and release assets require later security/release gates. No secret or production value was added.
6. **Scanner availability — disclosed, not blocking:** common secret-signature scans passed and only `.env.example` exists; `gitleaks` and `trufflehog` are not installed on this host.

## Explicit Gate 2 decision

**PASS (2026-07-28).** The implementation, API/security review, regression tests, accessibility remediation, Expo project checks, iOS bundle export, and project-owner-approved native Simulator run pass with no critical/high finding.

For future release-candidate regression:

1. Add the approved reachable HTTPS `EXPO_PUBLIC_API_BASE_URL` to the EAS `development` environment without committing credentials.
2. Run `eas build --platform ios --profile ios-simulator` for a Simulator build, or use the `development` profile for a registered physical iPhone.
3. Install and exercise login, refresh/session restore, logout, password-change revocation, five-tab navigation, Option 2 home partial failures/pull refresh, background/foreground polling, English/Arabic RTL, Dynamic Type, VoiceOver, reduced motion, and offline/session-expired states.
4. Record the build URL/ID, device/Simulator and iOS version, results, screenshots/logs without sensitive data, then change this decision to PASS only if all acceptance checks succeed.

## Recommended Gate 3 scope after Gate 2 passes

- Complete employee attendance timeline and check-in/check-out flows using the verified Gate 1 endpoints and failure states.
- Complete leave list, balance, detail, and request submission with server-side ownership/company enforcement.
- Add announcement detail and notification list/read behavior while retaining foreground REST polling.
- Add on-demand profile/status, payslip list/detail/download, and employee document list/download; keep sensitive data memory-only and use protected temporary viewing/download handling.
- Add feature-level contract, ownership-response, accessibility, RTL, offline, and session-expiry tests plus a repeat iOS Simulator/device smoke pass.
- Continue to exclude HR/admin/approval consoles, offline submissions, push, payroll administration, and WebSockets unless separately approved.
