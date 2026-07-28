# FFI Employee Mobile App — Master Plan

**Status:** Gate 3 passed on 2026-07-28 with one deferred item (protected binary file download → Gate 4)  

**SDK restoration note (2026-07-24):** the temporary Expo SDK 54 Expo Go smoke-test pin was removed. `MobileApp/` is restored to the validated Expo SDK 57 baseline for EAS/native acceptance.
**Last reviewed:** 2026-07-28  
**Scope:** Secure employee self-service mobile application and required backend readiness.

## Source-of-truth hierarchy

1. `SECURITY_POLICY.md` — mandatory security controls.
2. This document — mobile phases, gates, and handoffs.
3. `plans/Global API Rules (v1).txt` — reconciled API contract.
4. `.agents/context/` — concise implementation context.
5. `.agents/rules/` — engineering rules.
6. `.agents/skills/` — domain procedures.
7. `.agents/tasks/` — execution checklists.

If documents conflict with code, record the mismatch in `plans/API Route Status Matrix.md` before implementing the affected feature. Do not silently change security, API behavior, or scope.

## Product decisions

- Client: React Native + Expo + TypeScript in a separate `MobileApp/` workspace.
- First release: employee self-service only; iOS first, Android-compatible architecture.
- Django remains the sole business-rule and authorization authority.
- English and Arabic, including RTL, are required.
- UI palette: follow `plans/UIUX To-Do Checklist (v1).txt` exactly — primary orange `#FF7F3E`, cream background `#FFF6E9`, text `#1F1F1F`, muted text `#6B6B6B`, border `#E5E5E5`; use additional semantic colors only for status meaning.
- MVP: login, password change, dashboard, profile/status, attendance, leave, payslips, announcements, notifications, and logout.
- HR/admin/approval consoles and offline submission are excluded initially.
- Selected visual direction: Option 2 — simple iOS-first dashboard with an attendance timeline, leave balance summary, prominent Request Leave action, simple announcements, and bottom navigation.
- Initial bottom navigation: Home, Attendance, Leave, Notifications, More. Payslips, announcements, profile/status, language, password change, and logout are reached from feature routes or More.
- Initial notification transport: authenticated REST polling. The WebSocket compatibility path rejects every handshake with code `4403`; JWT query/header parsing and session authentication were removed. Realtime remains deferred until an opaque company-bound ticket, expiry, and revocation-disconnect design is approved.
- Sensitive server data remains in memory only for the MVP. Tokens use Expo SecureStore/Keychain; profile, salary, identity, attendance, payslip, document, and leave data must not be placed in persistent query caches.
- Accessibility use of the approved palette: normal text on primary orange uses main text `#1F1F1F`, not white; border `#E5E5E5` is decorative and cannot be the only focus/control boundary.

## Gate status

| Gate | Status | Evidence / blocker |
|---|---|---|
| Gate 0 — documentation and truth inventory | **Complete (2026-07-20)** | Mandatory hierarchy read; live Django routes, serializers, permissions, web consumers, and tests audited; route matrix reconciled. |
| Gate 1 — API and security readiness | **Passed (2026-07-20)** | Auth lifecycle/revocation, attendance, tenant isolation, protected attachments/documents/payslips, and realtime containment implemented and covered by Docker/PostgreSQL tests. |
| Gate 2 — mobile foundation | **Passed (2026-07-28)** | SDK 57 EAS iOS Simulator build `a2c59ef1-877b-4b17-8ec2-3c12467a641a` launched on macOS against isolated staging; the project owner approved the native test. |
| Gate 3 — employee MVP | **Passed (2026-07-28)** | Attendance, leave, notification/announcement, profile, payslip, and document workflows implemented on verified Gate 1 endpoints. 31 suites / 206 tests, TypeScript, zero-warning lint, Prettier, Expo Doctor 20/20, iOS export 1,865 modules. Protected binary file download deferred to Gate 4 under security review. See `plans/Gate 3 Employee Mobile Workflows and UI Report.md`. |
| Gates 4-6 | Not started | Depend on the preceding gates. |

## Gate 0 security disposition (historical findings)

- **Critical:** authentication lifecycle is not mobile-ready. Refresh is unrouted/undelivered, access-token lifetime is overridden by configurable session timeout, and logout/password change do not provide the required revocation and audit guarantees.
- **High:** query-string WebSocket JWTs and connection lifetime; cross-company announcement exposure; anonymous seven-day announcement attachment links; employee document validation/download/audit gaps.
- **Medium:** `/api/employees/me/` over-fetches identity and compensation data; payslip/leave active-company semantics and tests are incomplete; push registration/privacy architecture is absent.
- **Accepted risks:** none. Existing cross-company leave delegation remains an explicit product/security decision, not an accepted mobile risk.

## Gate 1 security disposition

- **Authentication:** login preserves `token` and adds `access`/rotating `refresh`; `/auth/refresh` is routed; access lifetime is fixed at 15 minutes; refresh lifetime is 14 days. Used refresh tokens are blacklisted. Logout and password change globally revoke prior access/refresh tokens through a server-enforced version claim and emit audits. Legacy unversioned JWTs are rejected at deployment.
- **Attendance:** the intentional maintenance 503s and module skip were removed. Employee timeline/check-in/check-out, HR, manager, CEO, and correction flows are active-company scoped and failure-path tested.
- **Tenant isolation/private files:** announcements, employee self leave, employee documents, and employee payslips enforce ownership and active-company scope. Uploaded documents validate extension, claimed MIME, size, and signature. Private downloads are authenticated, audited, forced attachments with `nosniff` and no-store headers.
- **Realtime:** URL/header JWT and session WebSocket authentication was removed. `/ws/notifications/` is a preserved but unavailable compatibility path that closes pre-accept with `4403`; web and mobile use REST polling.
- **Critical/high blockers:** none unresolved for Gate 1. Remaining lower-priority product work is recorded in the Gate 1 report and does not authorize MobileApp creation within this task.

## Phases and gates

### 0. Documentation and truth inventory

Read `AGENTS.md`, `SECURITY_POLICY.md`, this plan, the API contract, and relevant `.agents/context` entries. Compare Django routes, frontend API services, permissions, settings, models, and tests. Update the route matrix.

**Gate:** every mobile-required endpoint is current, legacy, compatibility, missing, or security-review-required.

**Completed evidence (2026-07-20):**

- Resolved routes were compared with serializers, permission/queryset logic, web API consumers, and relevant tests.
- `plans/API Route Status Matrix.md` now classifies every MVP route and records contract/security gaps.
- Docker/PostgreSQL validation passed `manage.py check`, `migrate --check`, 118 focused tests, and 4 subtests; the main attendance test module was skipped by its explicit maintenance guard.
- Gate 0 changed documentation only. No application code, migration, secret, credential, or production data was added.

### 1. API and security readiness

Reconcile paths, envelopes, pagination, organization scoping, ownership checks, throttles, audit events, private downloads, and notification transport. Add backend changes only when required and preserve compatibility routes deliberately.

**Gate:** backend tests cover IDOR, cross-company access, unauthorized downloads, token refresh/logout, and sensitive-action auditing.

**Required remediation sequence:**

1. Approve and implement the login/refresh/logout/password-change contract, cap access lifetime, add audit events, and define rotation, reuse, revocation, and expiry behavior.
2. Re-enable or deliberately replace employee attendance timeline/check-in/check-out; remove the current route/test contradiction.
3. Fix employee announcement company scoping and make protected attachments authenticated, forced-download, and non-public by default.
4. Add active-company and IDOR coverage for payslip list/detail/download; reconcile year filtering and response types. Harden employee document signature/MIME validation, inert download headers, audit, and negative authorization tests.
5. Reconcile employee leave-list active-company behavior and the intentional cross-company delegation exception.
6. Keep mobile notifications on REST polling until realtime authentication, organization binding, expiry, and logout disconnect controls are approved and tested.
7. Normalize the endpoint-specific pagination and error contracts used by mobile types.

**Completed evidence (2026-07-20):**

- Added `accounts.0004_user_auth_token_version`; Docker startup applied it and `makemigrations --check`, `migrate --check`, and `manage.py check` pass.
- The rebuilt Docker/PostgreSQL focused Gate 1 suite passed 82 tests; the isolated tenant suite passed 27 tests; the
  final full backend suite passed 339 tests plus 12 subtests.
- Frontend realtime/polling tests passed 5/5; TypeScript, ESLint (zero errors), targeted changed-file Prettier, and the
  production build pass.
- Exact full-suite results, route/security checks, remaining risks, and the explicit pass decision are in `plans/Gate 1 API and Security Remediation Report.md`.

### 2. Mobile foundation

Implement environment configuration, typed API access, native secure token storage through Android Keystore/iOS Keychain (for example Expo SecureStore), refresh/logout handling, network states, i18n/RTL, and error boundaries. Never use AsyncStorage or browser localStorage for tokens.

**Gate:** login, refresh, logout, session expiry, secure storage, and RTL tests pass.

**Approved architecture boundary:** separate Expo project with route groups for `(auth)` and `(protected)`, feature-owned API/types/queries/components, a central typed API client, a narrow SecureStore-backed session interface, centralized environment validation, in-memory server state, and no direct network calls from screens. Exact package versions, bundle identifiers, and EAS profiles are selected during this phase after Gate 1.

**Implemented evidence (2026-07-21):**

- Created `MobileApp/` with Expo SDK 57, React Native 0.86, React 19, TypeScript 6, Expo Router protected route groups, the iOS bundle identifier `com.ffihr.employee`, and development, iOS Simulator, preview, and production EAS profiles.
- Implemented the five approved tabs and the Option 2 home dashboard. Home loads attendance, current-year leave balances, announcements, and unread notification count independently so one failed section does not hide the others.
- Implemented a fixed-origin typed API client against the verified Gate 1 paths. The configured value is an origin only, with no `/api` suffix; authenticated requests add the bearer token and `x-active-company-id` centrally.
- Implemented atomic rotating access/refresh credential storage through Expo SecureStore with iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. User, company, notification, and dashboard state remain memory-only. Refresh is single-flight; invalid refresh, repeated 401, logout, password change, and restore failure clear credentials.
- Implemented English and Arabic localization, RTL metadata/helpers, locale-aware date/number/currency formatting, Dynamic Type, minimum 44-point targets, reduced-motion support, and dark accessible foreground/focus treatments for the approved orange/cream palette.
- Implemented authenticated foreground-only REST notification polling every 20 seconds. It stops in the background and on logout; WebSockets, push, and persistent HR data caches remain absent.
- Passed TypeScript, zero-warning lint, Prettier, 74 unit/security tests across 16 suites, Expo Doctor 20/20, and an iOS Metro/Hermes export of 1,826 modules. Static scans found no browser/plaintext token storage, WebSockets, route/query tokens, unsafe evaluation, or production logging.
- `npm audit --audit-level=high` reports zero high/critical findings and 11 moderate transitive `uuid` findings under Expo's `xcode` build tooling. The offered forced fix is a breaking Expo downgrade and was not applied.
- Formal Gate 2 acceptance remains blocked: Expo cannot generate or run the native iOS project or Simulator on Windows. The EAS account/project link is verified, but the development environment still needs the approved reachable HTTPS API origin. Gate 3 is not authorized until an iOS development build is installed and exercised on a macOS Simulator or physical iPhone.

### 3. Employee MVP

Implement only employee self-service screens. Fetch sensitive profile, salary, identity, and document data on demand; do not cache unnecessarily.

**Gate:** employee ownership and company scoping are verified by the server for every protected operation.

**Implemented evidence (2026-07-28):**

- Attendance: local-day status, check-in/check-out gated to the states the server accepts, 30-day timeline, and distinct offline/forbidden/duplicate/throttled/session-expired states on `GET /api/attendance/me/`, `POST .../check-in/`, and `POST .../check-out/`.
- Leave: balance, own request list and detail, create through `POST /api/leaves/leave-requests/` with the verified `leave_type` field, and owner-only cancel restricted to the three cancellable statuses. Balance, requests, and leave types load independently.
- Notifications and announcements: paginated recipient-scoped list, unread state, mark-one/mark-all read, and announcement list plus on-demand detail. The existing 20-second foreground-only `NotificationPollingProvider` remains the only timer; no duplicate polling was added.
- More: on-demand profile/status, payslip list and full breakdown, employee document metadata through the server-side `/api/employees/me/documents/` alias, session-scoped English/Arabic switching, password change, and global logout.
- Sensitive sheets mount only while open and discard their data on close. `parseProfile` deliberately projects no salary, allowance, passport, national-ID, or date-of-birth field.
- UI/UX: shared `ListRow`, `StatusBadge` (text label plus non-colour glyph), motion-free skeletons, `DetailSheet` full-screen detail driven by in-memory selection, and a `ScreenHeader`/`SectionHeader`/`DetailRow` hierarchy. The route surface remains the same seven token-free paths.
- Security posture improved: server validation text is surfaced only for HTTP 400/422 through a sanitizing channel that rejects credentials, JWT-shaped values, URLs, source paths, tracebacks, and markup; 403 and 404 now map to distinct generic access states.
- Deferred: protected binary file download (payslip PDF, employee document, announcement attachment). Implementing it would require persisting decrypted HR content to device storage or an unreviewed WebView, both of which contradict current decisions. The limitation is stated honestly in-app in both languages and is a Gate 4 security decision.

### 4. Mobile security hardening

Apply TLS-only networking, secure deep links, protected sensitive screens, privacy-safe push payloads, protected PDF handling, no sensitive logs, and approved biometric/local re-authentication for sensitive operations. Review WebSocket authentication; do not introduce tokens in URLs without security approval.

**Gate:** no unresolved critical/high findings from dependency, secret, static, API, and mobile security review.

### 5. Test, stage, and pilot

Run backend tests, mobile type-check/lint/unit tests, iOS simulator/device builds, API contract checks, accessibility checks, and device testing. Pilot with a small employee group and verify audit events, crashes, notifications, and rollback.

### 6. Production and operations

Release iOS first with separate production secrets, App Store credentials, provisioning profiles, and signing certificates. Define update, account-revocation, incident-response, monitoring, and rollback procedures. Prepare Android release configuration after the iOS pilot is accepted.

## Agent handoff rules

- Start with `.agents/context/INDEX.md`; load only task-relevant context.
- Verify actual routes before adding or changing an API client.
- Backend authorization is the security boundary; client guards are UX only.
- Sensitive changes require audit coverage and security review.
- Record decisions and unresolved mismatches in this plan and the route matrix.
- Do not add secrets, production data, or undocumented compatibility behavior.

## Acceptance criteria

- Every documented active mobile endpoint exists or is explicitly marked planned, legacy, or compatibility-only.
- Employees can access only their own data within their active organization.
- Tokens and sensitive data are stored and transmitted securely.
- Payslip/document access is authenticated, authorized, private, and audited.
- English/Arabic and RTL work on supported devices.
- Backend and mobile quality/security gates pass before pilot and production.

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-07-20 | Expo React Native in a separate `MobileApp/` client. | Reuses React/TypeScript knowledge and enables native secure storage/notifications. |
| 2026-07-20 | Django remains the authorization authority. | Prevents duplicated business rules and client-side privilege decisions. |
| 2026-07-20 | Option 2 and five-tab navigation are the selected MVP direction. | Matches the approved dashboard, attendance, leave, announcement, and bottom-navigation brief without expanding scope. |
| 2026-07-20 | Use REST polling for initial mobile notifications. | Keeps the deferred WebSocket route closed until tenant binding, expiry, and revocation-disconnect controls exist. |
| 2026-07-20 | Persist only session credentials in platform secure storage; keep HR server data in memory. | Reduces salary, identity, payslip, document, and attendance exposure on lost or shared devices. |
| 2026-07-20 | Use main text on primary orange and stronger non-color focus cues. | The approved orange/white and border/white pairs are insufficient for normal-text/control-boundary contrast. |
| 2026-07-20 | Historical Gate 0 disposition: Gate 1 was blocked and mobile scaffolding was deferred. | At Gate 0, the truth inventory was reconciled, but refresh, attendance, announcement, payslip, and realtime blockers remained. |
| 2026-07-20 | Login returns backward-compatible `token` plus `access` and rotating `refresh`; logout/password change revoke all account sessions. | Completes the mobile authentication lifecycle while preserving the existing access-token field. |
| 2026-07-20 | Reject legacy JWTs without `token_version` when Gate 1 deploys. | Prevents pre-remediation long-lived access tokens from bypassing the new immediate revocation boundary. |
| 2026-07-20 | Preserve `/ws/notifications/` but reject all handshakes with `4403`; use REST polling. | Removes JWTs from URLs and eliminates unbound/overlong realtime sessions until a secure ticket design exists. |
| 2026-07-20 | Historical handoff: Gate 1 passed and authorized Gate 2. | Authentication, attendance, IDOR/company isolation, private downloads, documents, and payslips met the Gate 1 criteria with Docker/PostgreSQL evidence. |
| 2026-07-21 | Use Expo SDK 57 with Expo Router protected routes and bundle identifier `com.ffihr.employee`. | Matches the current Expo scaffold and keeps authenticated navigation state declarative while preserving Android-compatible architecture. |
| 2026-07-21 | Treat `EXPO_PUBLIC_API_BASE_URL` as an origin only; append the verified paths unchanged. | Prevents accidental `/api/api/...` or `/api/auth/...` path drift and keeps requests same-origin. |
| 2026-07-21 | Store only one atomic access/refresh record in Expo SecureStore; retain user, active company, notification, and HR data in memory. | Supports token rotation without persisting sensitive employee data. |
| 2026-07-21 | Poll unread notifications every 20 seconds only while authenticated and foregrounded. | Preserves the Gate 1 REST baseline without adding WebSockets, push, or background data retention. |
| 2026-07-21 | Use dark foregrounds and focus borders on cream; reserve orange for filled actions, soft selection, and redundant decorative emphasis. | The approved orange is not contrast-safe as foreground text or the sole control boundary on cream. |
| 2026-07-21 | Gate 2 is blocked pending a native iOS development build and Simulator/device run. | All implementation and local checks pass; EAS ownership is verified, but Windows cannot run the iOS Simulator and the approved EAS API-origin value has not been supplied. |
| 2026-07-28 | Render record detail as in-memory full-screen sheets instead of parameterized routes. | Keeps the route surface at the seven token-free paths Gate 2 locked down and keeps record identifiers out of navigation state, while matching iOS detail conventions. |
| 2026-07-28 | Surface server validation text only for HTTP 400/422 through a sanitizing channel. | Employees need the real reason a leave request was rejected; every other status stays fully redacted, and accepted strings are bounded and stripped of credentials, JWT-shaped values, URLs, source paths, tracebacks, and markup. |
| 2026-07-28 | Map 403 to `forbidden` and 404 to `not_found`, rendering identical generic copy. | Gives screens honest recovery states without narrowing the generic responses the server deliberately returns for IDOR and cross-company attempts. |
| 2026-07-28 | Communicate status with a text label plus a non-colour glyph, and render nothing for unmapped enums. | Status must survive greyscale and colour-blindness, and an unmapped server enum must never leak a raw internal identifier into the UI. |
| 2026-07-28 | Switch language in session memory only, without `I18nManager.forceRTL`. | Avoids persisting a user preference on a shared device and avoids a forced process restart; direction-aware helpers already mirror text and rows. Native container mirroring remains a device-validation item. |
| 2026-07-28 | Defer protected binary file download to Gate 4 and disclose the limitation in-app. | Downloading would persist decrypted HR content to device storage against the memory-only decision, and a browser/WebView flow cannot carry the bearer token and needs security review. Viewing is delivered through the authenticated JSON detail endpoints instead. |

## Change checklist

- [x] Relevant source-of-truth documents read.
- [x] Route/status matrix checked and reconciled for the employee MVP.
- [x] Security impact assessed; identified Gate 1 blockers were resolved and verified.
- [x] API/types and audit behavior documented.
- [x] Gate 0 tests and validation evidence recorded.
- [x] Plan status and decision log updated for Gate 0.
- [x] Gate 1 remediation, regression/security tests, migration evidence, and pass decision recorded.
- [x] Gate 2 scaffold, design system, five-tab shell, secure auth client, Option 2 home, localization/RTL, accessibility, tests, and security review implemented.
- [x] Gate 2 local TypeScript, lint, format, unit/security, Expo Doctor, iOS bundle export, audit, and static-scan evidence recorded.
- [x] Native iOS development build installed and validated on a macOS Simulator; Gate 2 approved on 2026-07-28.
- [x] Gate 3 employee attendance, leave, notification/announcement, profile, payslip, and document workflows implemented on verified endpoints with full state, localization, and accessibility coverage.
- [x] Gate 3 contract, authorization, session-expiry, RTL, accessibility, and interaction tests added (31 suites, 206 tests) plus an independent Gate 3 invariant suite.
- [x] Gate 3 TypeScript, lint, format, test, Expo Doctor, iOS export, and audit evidence recorded, with the tooling-only `brace-expansion` advisory disclosed.
- [ ] Gate 4 decision on protected mobile file handling (payslip PDF, employee document, announcement attachment).
- [ ] Native iOS re-validation of the Gate 3 screens before a release candidate.
