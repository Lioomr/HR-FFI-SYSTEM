# Gate 3 — Employee Mobile Workflows and UI/UX Enhancement Report

**Date:** 2026-07-28
**Repository:** `D:\FFI HR SYSTEM\HR-FFI-SYSTEM`
**Client:** existing `MobileApp/` Expo SDK 57 application (continued, not recreated)
**Staging API:** `https://api-mobile-dev.asecopro.com` (isolated, synthetic data only)
**Decision:** **PASS with one explicitly deferred item — protected binary file download (see §7).**

---

## 1. Executive result

Gate 3 replaced the placeholder Attendance, Leave, Notifications, and More tabs with real
employee self-service workflows built exclusively on Gate 1-verified endpoints, and raised the
whole app onto one shared set of state, status, and list primitives so the five tabs read as a
single product.

No backend file was changed. No API path, permission, queryset, ownership check, company scope,
private-download control, or response contract was modified. The client's authority boundary is
unchanged: Django decides, the app renders.

Validation: TypeScript clean, ESLint zero-warning, Prettier clean, **31 suites / 206 tests passing**
(up from 19 / 81), Expo Doctor 20/20, and a successful iOS Hermes export of 1,865 modules.

---

## 2. Features implemented

### 2.1 Attendance (`src/features/attendance/`)

- Current-day status card deriving one of three states (`not-checked-in`, `checked-in`,
  `checked-out`) from the record whose `date` matches the **local** calendar day, matching the
  server's `timezone.localdate()` semantics.
- Check-in and check-out actions. Each button is enabled only in the state the server accepts, so
  the UI never invites a call the backend will reject.
- 30-day history timeline with per-row approval status.
- Full state coverage: skeleton, empty, retry, offline, forbidden, not-found, session-expired, and
  server-error. Forbidden and duplicate/throttled responses map to distinct honest messages rather
  than a generic failure.

Check-in/check-out **is** supported by the current backend contract (Gate 1 removed the maintenance
503 guards), so it is implemented rather than presented as unavailable. When the server refuses —
profile outside the active company, or a role outside `Employee | Manager | HRManager` — the screen
states plainly that the action is not available for that account in that company.

### 2.2 Leave (`src/features/leave/`)

- Leave balance for the current year with entitlement, used, and remaining days.
- The employee's own leave-request list with status badges and day counts.
- Request detail opened from in-memory selection, showing dates, reason, decision, and decision note.
- **Create**: leave-type picker (active types only), start/end dates, reason. Client-side validation
  rejects malformed or reversed dates before any request is sent; server validation text (overlap,
  balance, sick-leave document requirement) is displayed through the sanitized channel described in §5.
- **Cancel**: offered only for `submitted`, `pending_hr`, and `pending_manager` — the exact statuses
  the verified owner-only cancel action accepts. Other statuses show why cancellation is unavailable.

Balance, requests, and leave types are fetched as independent settled requests, so a role that
cannot read balances still sees its request list.

### 2.3 Notifications and announcements (`src/features/notifications/`)

- Segmented Notifications / Announcements tabs in one screen.
- Notification list with read/unread state, an unread marker that is a border + badge + accessibility
  label (never colour alone), per-item detail, mark-one-read on open, and mark-all-read.
- Announcement list and on-demand detail from the verified detail route.
- Foreground-only REST polling is unchanged: the existing 20-second `NotificationPollingProvider`
  remains the single timer. The screen reads its count and calls its `refresh()`; it starts no timer
  of its own, so no duplicate polling was introduced.

### 2.4 More (`src/features/more/`)

- Profile and employment status, fetched on demand and unmounted (discarded) on close.
- Payslip list and full detail breakdown (basic, each allowance, totals, deductions, net, payment mode).
- Employee document list and detail (metadata only).
- In-app English/Arabic language switch, session-scoped and never persisted.
- Change password and global logout, both unchanged in behaviour.

---

## 3. APIs verified and used

Every path below was read from the live Django URLconf, view, serializer, and permission class
before use, and cross-checked against `plans/API Route Status Matrix.md`.

| Workflow | Method and path | Server authority relied on |
|---|---|---|
| Attendance timeline | `GET /api/attendance/me/?page&page_size` | `AttendanceRecordViewSet.me_list`, `IsAttendanceSelfServiceRole`, queryset filtered to `employee_profile__user=user` and active company |
| Check in | `POST /api/attendance/me/check-in/` | Owner fixed server-side, active-company check, 10/min throttle, duplicate-day `IntegrityError` → 400 |
| Check out | `POST /api/attendance/me/check-out/` | Row-locked `select_for_update`, missing/duplicate state → 400 |
| Leave balance | `GET /api/leaves/employee/leave-balance/?year` | `EmployeeLeaveBalanceView`, `IsEmployeeOnly`, active-company-aware calculation |
| Own leave requests | `GET /api/leaves/employee/leave-requests/?page&page_size` | `EmployeeLeaveRequestViewSet`, owner + active company, `employee_id` parameter rejected with 422 |
| Leave types | `GET /api/leaves/leave-types/` | `LeaveTypeViewSet.list`, company-scoped; the `Employee` role sees active types only |
| Submit leave | `POST /api/leaves/leave-requests/` | `IsEmployeeOnly`; server fixes `employee` to the caller; `employee_id` in the body is rejected |
| Cancel leave | `POST /api/leaves/leave-requests/{id}/cancel/` | `IsLeaveRequestOwner`; re-filtered by `employee=request.user`; non-pending → 422 |
| Notifications | `GET /api/notifications/?page&page_size` | Recipient + active-company scoped; delivery detail role-redacted |
| Unread count | `GET /api/notifications/unread-count/` | Same scope (already in use since Gate 2) |
| Mark read | `POST /api/notifications/{id}/read/` | Recipient-scoped lookup; non-owned → 404 |
| Mark all read | `POST /api/notifications/read-all/` | Active-company scope only |
| Announcements | `GET /api/announcements/?page&page_size` | Role/team targeting and active-company scope |
| Announcement detail | `GET /api/announcements/{id}/` | Object-level scope; payload wrapped as `data.announcement` |
| Profile | `GET /api/employees/me/` | Owner-fixed lookup (`EmployeeProfileViewSet.me`) |
| Employee documents | `GET /api/employees/me/documents/` | `_document_profile_for_request` resolves `pk == "me"` to the caller's own profile within active-company scope |
| Payslips | `GET /employee/payslips/?page&page_size` | `IsEmployeeOnly` (strict `Employee` role), owner + active company + completed/paid run |
| Payslip detail | `GET /employee/payslips/{id}/` | Same queryset; IDOR → 404 |

**Two contract facts confirmed and newly recorded in the route matrix** (verification, not change):

1. `GET /api/leaves/leave-types/` is a current, authenticated, company-scoped route. It was not
   previously listed in the matrix; it is now, because the mobile request form depends on it.
2. `/api/employees/me/documents/` is a real server-side alias — `pk == "me"` is resolved to the
   caller's own profile — so the client never has to hold or transmit a profile identifier.

**Endpoints deliberately not called:** `/employee/summary`, `/employee/profile`, `/employee/status`
(non-existent legacy examples), the duplicated root-level `/employees/*` family, `attachment-public`,
`/leave-balances/` and `/api/leaves/hr/*` (HR-only), and `WS /ws/notifications/`. A QA invariant test
asserts none of these appear anywhere in production source.

---

## 4. UI/UX decisions and rationale

The approved Option 2 system — orange `#FF7F3E`, cream `#FFF6E9`, text `#1F1F1F`, muted `#6B6B6B`,
border `#E5E5E5` — is unchanged. No token, palette entry, or safe-area rule was altered.

| Decision | Rationale |
|---|---|
| **One `ListRow` for every list** (attendance, leave, notifications, payslips, documents) | Five tabs previously had five layouts. A single row shape with title / subtitle / meta / trailing makes the app read as one product and gives every list identical RTL, touch-target, and screen-reader behaviour for free. |
| **`StatusBadge` pairs a glyph with a text label** | Status is the highest-value information on these screens and must never be colour-only. Every badge carries a translated word plus a redundant non-colour glyph (`✓ ⋯ ! × –`), so meaning survives greyscale, colour-blindness, and high-contrast modes. |
| **Unknown server enums fall back to no badge** | An unmapped status renders nothing rather than leaking a raw internal identifier like `PENDING_MGR` into the UI. |
| **Static, motion-free skeletons instead of spinners** | Lists now show their own shape while loading, which reduces perceived latency and layout shift. Because the skeleton has no animation, reduce-motion needs no special case and screen-reader focus is not disturbed — one `progressbar` live region announces the whole block. |
| **Detail views are full-screen sheets driven by in-memory selection** | Idiomatic on iOS, and it keeps record identifiers out of navigation state entirely. The route surface stays at the same seven token-free paths Gate 2 locked down; no `useLocalSearchParams` was introduced. |
| **Sensitive sheets are mounted only while open** | Profile, payslips, and documents fetch nothing until opened and their data is discarded on close, honouring the master-plan decision to keep HR data in memory only. |
| **Explicit information hierarchy** (`ScreenHeader` → `SectionHeader` → `DetailRow`) | Replaces ad-hoc `title1`/`title2` usage. Each screen now has exactly one `accessibilityRole="header"` at the top and a predictable heading ladder beneath it. |
| **Actions disabled in states the server rejects** | Check-out is disabled before check-in; cancel is hidden for decided requests; mark-all-read is hidden at zero unread. The UI stops proposing work that would fail — while the server remains the authority that actually enforces it. |
| **Restrained emoji** | Emoji appear only in empty states (`🗓️ 🌴 📄 🔔 📣 🧾 📁 🔒`) as a scannable cue, and are always `accessibilityElementsHidden` with the meaning carried by adjacent text. None appear in status, action, or data surfaces. |
| **Honest unavailability copy** | Where a capability genuinely is not available (file download, an action the role cannot perform), the screen says so specifically and, where relevant, points to the web portal — instead of showing a dead control or a generic error. |

Preserved unchanged: safe areas via `Screen`/`SafeAreaView`, Dynamic Type (`allowFontScaling`, no
`maxFontSizeMultiplier` cap), 44-point minimum targets, reduced-motion support (`DetailSheet`
switches to `animationType="none"`), and the dark-foreground/dark-focus-border remediation that
keeps orange as an accent rather than foreground text.

---

## 5. Security review

**Nothing in the security posture was weakened. Two things were tightened.**

### 5.1 Tightened: sanitized server validation channel

Employees need to know *why* a leave request was rejected (overlap, insufficient balance, missing
medical report). Previously `ApiError` discarded all server text. Gate 3 adds a deliberately narrow
channel in `src/services/api/api-error.ts`:

- Server text is read **only** for HTTP 400 and 422 — the two documented validation statuses.
- Every other status (401/403/404/429/5xx) still carries **zero** server text; `ApiError.details` is
  forced empty for any code other than `validation_failed`.
- Each accepted string is stripped of control characters, truncated to 200 characters, capped at 5
  entries, and dropped entirely if it matches `UNSAFE_DETAIL_PATTERN` — anything resembling
  `Bearer`/`Authorization`, a JWT-shaped triplet, a URL, a source-file path, a traceback, or markup.
- Covered by 8 dedicated tests, including a case asserting that a payload of leaked credentials,
  URLs, stack frames, and script tags yields only the one legitimate field message.

### 5.2 Tightened: distinct authorization failure states

`403` and `404` now map to `forbidden` and `not_found` instead of a generic `request_failed`. Both
render the same deliberately vague "Access unavailable" / "Not available" copy — the server already
returns generic 404s for IDOR and cross-company attempts, and the client does not narrow that.

### 5.3 Invariants preserved (asserted by tests, not assumed)

| Control | Evidence |
|---|---|
| Tokens only in Expo SecureStore / Keychain | `expo-secure-store` still imported by exactly one file; asserted by both Gate 2 and Gate 3 invariant suites |
| No token in URL, query, route, log, or body | Route surface unchanged at 7 token-free paths; no `useLocalSearchParams`; no template-literal router pushes |
| No AsyncStorage / localStorage / SQLite / file system | Gate 3 invariant additionally blocks `expo-file-system`, `downloadAsync`, `writeAsStringAsync`, `createDownloadResumable`, `expo-sharing`, and `MMKV` |
| No WebSocket, no push, REST polling only | `WebSocket`/`socket.io`/`EventSource` absent; polling constant still `20_000` with `clearInterval` teardown |
| No client-chosen ownership, company, or role | Every `*-api.ts` asserted free of `employee_id:`, `company_id:`, `role:`, and company query parameters; company scope travels only in the central `x-active-company-id` header |
| No compensation or identity-document data in the profile feature | `parseProfile` asserted free of `basic_salary`, `total_salary`, allowances, `passport`, `national_id`, `date_of_birth`; a test feeds a full server payload and asserts none of those values survive into the projection |
| No document file path or URL held | `parseDocument` output asserted free of `private_uploads`; the server keeps `file` write-only |
| No logging, `eval`, `new Function`, or WebView | Asserted across all production source |
| No raw transport text rendered | `error.message`, `response.statusText`, and `response.text()` asserted absent from production source |

Identifiers interpolated into paths (`cancel`, `read`, payslip/announcement detail) are
`encodeURIComponent`-encoded; a test asserts a traversal-shaped id becomes `31%2F..%2F..%2Fauth%2Flogout`
rather than a new path.

---

## 6. Tests and command results

All commands run from `MobileApp/`.

| Command | Result |
|---|---|
| `npm run type-check` | **Pass** — no TypeScript errors |
| `npm run lint` | **Pass** — zero errors, zero warnings (`--max-warnings=0`) |
| `npm run format:check` | **Pass** — all files match Prettier |
| `npm test -- --runInBand` | **Pass — 31 suites, 206 tests, 0 failures** (Gate 2 baseline: 19 suites, 81 tests) |
| `npx expo-doctor` | **Pass — 20/20 checks** |
| `npx expo export --platform ios --output-dir dist-ios-gate3 --clear` | **Pass** — 1,865 modules, one iOS Hermes bundle (~4 MB), 23 assets (output directory is gitignored and was deleted after verification) |
| `npm audit --audit-level=high` | Exit 0; **0 critical, 34 high, 12 moderate** — all tooling-only; see §7.1 |

### New test files (125 new tests)

| File | Focus |
|---|---|
| `src/services/api/api-error.test.ts` | Status mapping; validation-detail sanitization; credential/URL/traceback rejection; bounds; non-validation statuses carry no server text |
| `src/services/api/parse.test.ts` | Paginated contract accepted; DRF `{count,results}` shape rejected rather than coerced; scalar coercion rules |
| `src/features/attendance/attendance-api.test.ts` | Exact paths; no employee selector; field projection; local-date boundary; day-state derivation; 403/404/429/400/offline mapping; session-expiry rethrow |
| `src/features/attendance/AttendanceScreen.test.tsx` | Skeleton; action enablement per state; successful check-in reloads; honest unavailable message; forbidden state leaks nothing; offline retry; session expiry; Arabic + RTL; 44-point targets |
| `src/features/leave/leave-api.test.ts` | Exact paths; independent section failure; inactive types hidden; `leave_type` (not `leave_type_id`); no `employee_id`; ISO date validation; cancel status mapping; identifier encoding |
| `src/features/leave/LeaveScreen.test.tsx` | Balance rendering; partial failure; field-level validation blocks submission; successful submit reloads; server validation text shown; detail from memory; cancel success and rejection; cancel hidden when decided; Arabic; session expiry; whole-screen failure |
| `src/features/notifications/notifications-api.test.ts` | Exact paths; read-state derivation; delivery internals not projected; wrapped detail envelope; identifier encoding; failure and session-expiry behaviour |
| `src/features/notifications/NotificationsScreen.test.tsx` | Accessible unread label (not colour); segment switching; mark-read on open; no re-mark when already read; mark-all reloads list and polled count; failure reported honestly; empty/offline states; Arabic |
| `src/features/more/more-api.test.ts` | Exact paths; `me` document lookup; **profile projection excludes salary, allowances, passport, national ID, date of birth**; payslip list/detail; contract-drift rejection; 403 propagation; document metadata carries no file path |
| `src/features/more/MoreScreen.test.tsx` | Nothing sensitive fetched until opened; profile discarded on close; payslip breakdown + honest download notice; forbidden payslips; documents metadata-only; language switch flips the session to Arabic with accessible selection state; change-password routing; logout called once and still succeeds on network failure |
| `src/i18n/translations.test.ts` | EN/AR key parity; placeholder parity; no untranslated Arabic; every renderable enum translated; download limitations stated honestly in both languages; no token/URL in copy |
| `src/qa/gate3-security-invariants.test.ts` | Independent allowlist of every callable endpoint; legacy routes absent; owner-scoped mutations; no ownership/company/role selectors; bounded token-free routes; no persistence or download-to-disk; realtime deferred; no logging/eval/WebView; sanitized-text channel; profile projection; colour-independent status; direction-aware styling; touch targets; language never persisted |

The Gate 2 invariant suite (`gate2-security-invariants.test.ts`) still passes unmodified — no Gate 2
security or accessibility assertion was relaxed to accommodate Gate 3.

### Backend

No backend file was changed, so no backend test run was required and none was performed. The Gate 1
Docker/PostgreSQL evidence (82 focused, 27 tenant-isolation, 339 full-suite tests) remains the
acceptance source for attendance, tenant isolation, attachments, documents, and payslips. **SQLite
was not used at any point.**

---

## 7. Remaining risks and deferred work

### 7.1 Dependency advisory — tracked, not blocking, not caused by Gate 3

`npm audit` now reports 34 high findings where Gate 2 reported 0. Investigation shows this is **one
newly published advisory**, not new exposure:

- Root cause: `brace-expansion@1.1.16` (GHSA-mh99-v99m-4gvg, DoS via unbounded glob expansion),
  hoisted at `node_modules/brace-expansion` and reached through `minimatch@3.1.5`.
- Every path is lint/test/build tooling: `eslint`, `eslint-plugin-*`, `glob`, and
  `test-exclude → babel-plugin-istanbul → @react-native/jest-preset`. `react-native` is listed only
  because it declares that Jest preset.
- The second copy, `brace-expansion@5.0.8` under `@expo/config-plugins` and `@expo/fingerprint`, is
  **outside** the vulnerable range (`<=5.0.7`).
- None of it is bundled into the Hermes bytecode; it does not execute on device.
- The offered fixes are breaking major downgrades (`jest@25`, `expo@46`, `react-native@0.84.1`) that
  would abandon the validated SDK 57 baseline. Not applied — same disposition Gate 2 recorded for the
  `uuid` advisory. Recheck when Expo and Jest publish compatible resolutions.

The 12 moderate findings are the previously recorded `uuid` and `@expo/config-plugins` items.

### 7.2 Deferred: protected binary file download — **the one incomplete item in Gate 3 scope**

Gate 3 scope asked for payslip and document "viewing/download flow". **Viewing is complete**: the
full payslip breakdown and full document metadata are rendered in-app from the verified,
authenticated, owner-scoped JSON endpoints. **Binary download is deliberately not implemented.**

Reasoning:

- Downloading the PDF requires writing decrypted HR content to device storage (`expo-file-system`),
  which directly contradicts the master-plan decision *"Persist only session credentials in platform
  secure storage; keep HR server data in memory"* and would break a Gate 2 security invariant.
- The alternative — opening the download URL in a browser or WebView — cannot attach the
  `Authorization` header (so it would simply 401), and `SECURITY_POLICY.md` requires explicit security
  review before using WebViews for authenticated HR content.

Rather than ship a broken control or silently drop the capability, both sheets state plainly that
PDF download is not enabled in this app version and that the protected file remains available in the
web portal. The same applies to announcement attachments. This is asserted by tests in both
languages.

**This requires a security decision in Gate 4** (mobile security hardening): either approve a
reviewed secure-file-handling design (in-memory render, no-persist temporary file with guaranteed
deletion, or an approved authenticated viewer), or formally accept web-portal-only file access for
the first release.

### 7.3 Other deferred and unchanged items

1. **Native iOS re-validation.** All checks here are static/unit/bundle level on Windows. The Gate 3
   screens have not been exercised on a Simulator or device. Re-run the native matrix — VoiceOver
   focus order, Dynamic Type extremes, per-app language restart, Keychain availability, background/
   foreground polling, offline and session-expiry — before any release candidate.
2. **Arabic RTL uses direction helpers, not `I18nManager.forceRTL`.** Switching language in-app
   re-renders every screen with RTL text alignment and reversed rows through `directionHelpers`,
   which is verified by tests. It does **not** flip native container layout, which on iOS requires a
   process restart. Device validation should confirm this is acceptable, or a restart prompt should
   be added.
3. **Leave document upload not implemented.** Sick leave requires a medical report; the server
   rejects such a request with a clear validation message, which the form displays. File attachment
   from mobile depends on the same Gate 4 file-handling decision as §7.2.
4. **Pagination is first-page only.** Lists request page 1 with a bounded page size (30 attendance,
   25 leave/notifications, 24 payslips, 20 announcements). Infinite scroll is not implemented and is
   not required by Gate 3 scope.
5. **Attendance correction requests not implemented** — outside Gate 3 scope.
6. **Payslips require the strict `Employee` role.** `payroll.permissions.IsEmployeeOnly` requires
   exactly `Employee`, while `leaves.permissions.IsEmployeeOnly` also allows `Manager` and
   `HRManager`. A Manager therefore sees leave and attendance but an honest "Access unavailable" state
   on payslips. This is existing, intentional backend behaviour, surfaced rather than worked around.
   Flagged for product confirmation.

---

## 8. Explicit Gate 3 decision

**PASS.** Employee attendance, leave, notification, announcement, profile, payslip, and document
workflows are implemented against verified Gate 1 endpoints with complete state handling, English/
Arabic RTL support, accessible status semantics, and regression tests. No backend authorization,
company scoping, ownership check, private-download protection, or API response contract was altered,
and no Gate 2 security or accessibility invariant was relaxed. Security posture improved in two
places (sanitized validation channel, distinct authorization states).

One scope item — **protected binary file download** — is deliberately deferred to a Gate 4 security
decision and is disclosed in-app rather than faked. That deferral is the single qualification on this
pass.

**Gate 4 is not marked passed and is not authorized by this report.**

Before a release candidate:

1. Resolve the §7.2 file-handling decision under security review.
2. Build and install an iOS Simulator or device build against isolated staging with synthetic data.
3. Exercise every Gate 3 workflow, both languages, VoiceOver, Dynamic Type, reduced motion, offline,
   forbidden, and session-expiry paths.
4. Record build ID, device/OS, and results — with no secrets, tokens, private HR data, or signed URLs
   in any artefact.
