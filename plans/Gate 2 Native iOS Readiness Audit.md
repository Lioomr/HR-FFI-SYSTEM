# Gate 2 Native iOS Readiness Audit

**Date:** 2026-07-28  
**Repository:** `D:\FFI HR SYSTEM\HR-FFI-SYSTEM`  
**Decision:** **PASS — project-owner native iOS Simulator acceptance approved**

> **SDK restoration (2026-07-24):** the temporary Expo SDK 54 Expo Go smoke-test pin has been removed. `MobileApp/` is restored to the validated SDK 57 baseline and passed dependency, TypeScript, lint, formatting, Jest, Expo Doctor, public-config, and iOS-export checks. See `MobileApp/SDK_VERSION_NOTICE.md`.

## Executive finding

The existing mobile implementation is ready for final native validation after one EAS configuration defect was remediated. Before remediation, all EAS profiles could resolve the development fallback `http://localhost:8000`; this could produce a preview or production binary with an unusable fixed origin. EAS profiles now select their named environments and set `FFI_REQUIRE_EXPLICIT_API_ORIGIN=true`, so configuration fails closed unless an explicit valid HTTPS origin is present.

No critical or high security finding remains. The originally blocking native run was completed on a borrowed macOS host using an EAS iOS Simulator development build against the isolated staging API `https://api-mobile-dev.asecopro.com`. The project owner approved Gate 2 on 2026-07-28. Gate 3 has not started.

## Native acceptance evidence (2026-07-28)

- EAS iOS Simulator build `a2c59ef1-877b-4b17-8ec2-3c12467a641a` completed successfully for SDK 57 and bundle identifier `com.ffihr.employee`.
- The build was installed and launched on a macOS-hosted iOS Simulator. The application reached the login screen and connected to the isolated HTTPS staging API; no production system or production data was used.
- Project-owner testing approved the native run. Password change was specifically exercised: success ends the session, the old password is rejected, and the new password can be used to sign in again.
- The project owner made the explicit Gate 2 PASS decision. Sanitized screenshots remain with the project owner and are not stored in the repository.

## Readiness findings

### EAS and application configuration

- **G2-EAS-001 — Medium — resolved.** `MobileApp/app.config.ts` now treats every EAS build as non-development when the profile supplies `FFI_REQUIRE_EXPLICIT_API_ORIGIN=true`; `MobileApp/eas.json` maps development, preview, and production profiles to their corresponding EAS environments. Missing origins fail configuration instead of falling back to localhost.
- EAS authentication passes for account `lioomr`. Project lookup resolves `@lioomr/ffi-hr-employee`, matching project ID `ed02af1e-e111-41b0-b28f-758f538a27d6` in the app config.
- The iOS bundle identifier is `com.ffihr.employee`; URL scheme is `ffihr`; the `ios-simulator` profile extends development and sets `ios.simulator=true`.
- `EXPO_PUBLIC_API_BASE_URL` is treated as public client configuration, not a secret. Parsing requires an origin, rejects credentials/query/fragment and `/api` suffixes, and requires HTTPS outside local development.
- Development, preview, and production EAS environments currently contain no configured plain-text or sensitive variables. This is deliberate fail-closed readiness, but the approved development HTTPS origin must be added before the native build.

### Authentication and data handling

- Tokens are stored as one atomic Expo SecureStore record using a dedicated Keychain service and `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; AsyncStorage, SQLite, local/session storage, and persistent HR caches are absent.
- Login, `/auth/me`, single-flight refresh, refresh-token rotation, one-time request replay, logout, password change, restore failure, terminal refresh failure, and second-401 session expiration are implemented and covered.
- Refresh requests do not reuse a stale bearer token or company header. Logout clears locally in a `finally` path; successful password change clears the session. Validation errors do not unnecessarily discard a still-valid session.
- The fixed-origin client omits browser credentials and rejects redirects. Static review found no token in logs, URLs, query parameters, WebSockets, errors, or non-Keychain storage. Errors exposed to UI are normalized.

### UI, navigation, accessibility, and localization

- The protected shell contains exactly five tabs: Home, Attendance, Leave, Notifications, and More. Expo Router protected routes separate authenticated and unauthenticated screens.
- Localized loading, empty, offline, recoverable error, and expired-session states exist. Home sections settle independently so one failed service does not erase successful sections.
- Option 2 colors and contrast remediation are enforced by tests. Safe-area primitives, minimum 44-point targets, scalable text, VoiceOver labels/hints/live regions, logical source ordering, RTL helpers, and reduced-motion alternatives exist in code.
- English and Arabic translation keys have typed parity; Expo configuration advertises both localizations and RTL support.
- Actual VoiceOver focus order, extreme Dynamic Type layouts, RTL mirroring, safe-area behavior, reduced motion, and foreground/background transitions remain native-only observations.

### Canonical API integration and server authority

The production mobile source issues only these requests, all of which match the canonical route matrix, global rules, and Django routes:

| Method | Mobile request |
|---|---|
| `POST` | `/auth/login` |
| `POST` | `/auth/refresh` |
| `POST` | `/auth/logout` |
| `POST` | `/auth/change-password` |
| `GET` | `/auth/me` |
| `GET` | `/api/attendance/me/?page=1&page_size=7` |
| `GET` | `/api/leaves/employee/leave-balance/?year=<year>` |
| `GET` | `/api/announcements/?page=1&page_size=3` |
| `GET` | `/api/notifications/unread-count/` |

No invented or stale mobile endpoint was found. Backend authorization remains authoritative:

- attendance self-service checks authentication/role, derives the employee from the user, and fails closed on active-company mismatch;
- leave balance is employee-only and evaluates the authenticated user within the active company;
- announcements use company-scope filtering plus target-role/user filtering;
- notification unread counts are filtered by recipient and permitted active/access companies.

The mobile route guard and tab shell are UX controls only; they are not treated as authorization boundaries. The current Docker/PostgreSQL suites verify authentication lifecycle and the listed ownership/company boundaries.

## Files changed by this readiness audit

- `MobileApp/app.config.ts` — fail-closed API-origin behavior for EAS profiles.
- `MobileApp/eas.json` — explicit EAS environment selection and release-like origin enforcement.
- `MobileApp/src/config/eas-readiness.test.ts` — regression coverage for project identity, iOS identifiers, profile environments, fail-closed flags, and Simulator profile.
- `MobileApp/README.md` — EAS origin setup and validation instructions.
- `plans/Employee Mobile App Master Plan.md` — replaced stale EAS-authentication blocker wording.
- `plans/Gate 2 iOS Mobile Foundation and Design System Report.md` — refreshed EAS status, test counts, and clearance steps.
- This audit report.

No backend code, API route, response contract, migration, security control, secret, or production data was changed.

## Commands and results

Commands ran from `MobileApp/` unless stated otherwise.

| Command/check | Result |
|---|---|
| `npm ci` | PASS — 1,089 packages installed from lockfile. |
| `npm run type-check` | PASS. |
| `npm run lint` | PASS — zero warnings. |
| `npm run format:check` | PASS. |
| `npm test -- --runInBand` | PASS — 17 suites, 76 tests, 0 failures. |
| `npx expo-doctor` | PASS — 20/20 checks. |
| `npx expo install --check` | PASS — dependencies compatible/up to date. |
| iOS Expo export with sanitized HTTPS origin | PASS — 1,826 modules, 23 assets, one Hermes bundle (~3.8 MB); output was outside the repository. |
| `npm audit signatures` | PASS — 1,089 signatures and 178 attestations verified. |
| `npm audit --audit-level=high` | PASS at the required threshold — 0 critical/high; 11 moderate transitive `uuid` findings in Expo configuration/Xcode tooling remain tracked. The incompatible force fix was not applied. |
| Production storage/network/log/token static scan | PASS — no SQLite, AsyncStorage/browser storage, WebSocket, console leakage, token query, dynamic evaluation, or unsafe HTML pattern. |
| `npx eas-cli@latest whoami` | PASS — `lioomr`. |
| `npx eas-cli@latest project:info` | PASS — project ID matches app config. |
| EAS environment lists | PASS — confirmed all three named environments currently have no configured variables. |
| `eas config` without API origin | PASS as a negative test — exits nonzero with `EXPO_PUBLIC_API_BASE_URL is required outside development.` |
| `eas config` for Simulator/preview/production with shell-only `https://mobile-test.example.com` | PASS — correct environment, bundle ID, project ID, and fixed origin resolved. No remote variable was created. |
| `docker compose exec -T backend python manage.py check` | PASS — no system-check issues. |
| `docker compose exec -T backend python manage.py migrate --check` | PASS — no pending migrations. |
| Focused Django tests in Docker/PostgreSQL | PASS — 107 tests in 69.505s covering auth, attendance, employee leave scoping, announcements, and notifications. SQLite was not used. |

The backend container health probe remains 503 because optional notification dependencies report unavailable, as already recorded in the Gate 1 report. Django is serving, system/migration checks pass, PostgreSQL is healthy, and the focused employee API/security tests pass; this health signal is not an attendance-contract failure.

## Follow-up native regression checklist

1. Install and launch the EAS development binary on a macOS-hosted iOS Simulator and/or registered iPhone.
2. Confirm Keychain persistence/clearing across relaunch, refresh rotation, logout, password change, expired access/refresh tokens, and forced server revocation.
3. Exercise all five tabs and protected-route transitions during cold start, background/foreground, offline recovery, 401/403/404/5xx, empty data, and partial dashboard failure.
4. Inspect notched and non-notched safe areas, keyboard avoidance, rotation policy, and all 44-point targets.
5. Test English and Arabic per-app language changes, RTL mirroring, Arabic/date/number rendering, and restart behavior.
6. Test VoiceOver labels, hints, reading/focus order, announcements, and keyboard/form errors.
7. Test every Dynamic Type size including accessibility sizes, Increase Contrast, Bold Text, Reduce Motion, and color contrast in native rendering.
8. Confirm foreground-only 20-second notification polling stops in background/logout and resumes once without duplicate timers.
9. Capture sanitized screenshots/logs and the EAS build ID, device/Simulator model, and iOS version.

## Sanitized test data required

- The approved reachable non-production HTTPS API origin, without `/api`; this is public app configuration, not a secret.
- Synthetic Employee A in Company A with an employee profile, active/default Company A, one recent attendance row, leave balances, three announcements, and at least one unread notification.
- Synthetic Employee B in Company B for negative ownership/company tests. Optionally use a synthetic dual-company employee to validate active-company switching if that workflow is enabled.
- A synthetic password rotation pair supplied out of band and never committed, logged, or placed in screenshots.
- Server-created expired/revoked access and refresh states; do not paste raw tokens into tickets, reports, URLs, screenshots, or logs.
- No real employee PII, payroll information, documents, production credentials, or production tokens.

## Exact steps after Apple Developer access is active

### Configure and validate EAS

1. From `MobileApp/`, confirm `npx eas-cli@latest whoami` returns the approved account and `npx eas-cli@latest project:info` returns the configured project ID.
2. Add the approved test origin: `npx eas-cli@latest env:create --name EXPO_PUBLIC_API_BASE_URL --value https://<approved-test-origin> --environment development --visibility plaintext`.
3. Verify it with `npx eas-cli@latest env:list --environment development`; do not print or store test-account passwords/tokens.
4. Run `npx eas-cli@latest config --platform ios --profile ios-simulator` and confirm bundle ID `com.ffihr.employee`, the expected project ID, environment `development`, and the approved HTTPS origin.

### Simulator build and run

5. Run `npx eas-cli@latest build --platform ios --profile ios-simulator` and record the build ID/URL. Apple Developer membership is not required for an iOS Simulator build, but macOS with the Simulator is required to run it.
6. On the Mac, install with `npx eas-cli@latest build:run --platform ios --latest`, then launch the app and execute the native-only checklist above.

### Physical iPhone build and run

7. Accept all Apple Developer agreements/team invitations, then register the test device with `npx eas-cli@latest device:create`.
8. Run `npx eas-cli@latest build --platform ios --profile development`; allow EAS to create/select the development certificate and provisioning profile for the approved team.
9. Install from the internal-distribution link on the registered iPhone. If the development client requires Metro, run `npx expo start --dev-client` on a reachable network.
10. Execute the same auth, API, navigation, accessibility, localization, safe-area, offline, and lifecycle matrix on the physical device.
11. Record only sanitized evidence. Update this report and the master plan to PASS only after every required native check passes; otherwise retain BLOCKED with the observed defect. Do not begin Gate 3 before that decision.

## Gate decision

**PASS (2026-07-28).** Code/configuration checks, contract review, EAS identity, iOS export, Docker/PostgreSQL security regression tests, and the approved native Simulator acceptance pass with no critical/high unresolved finding. The follow-up checklist remains the regression baseline for later releases; it is not a Gate 2 blocker.
