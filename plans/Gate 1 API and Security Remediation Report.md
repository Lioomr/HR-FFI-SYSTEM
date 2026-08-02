# Gate 1 — API and Security Remediation Report

**Decision:** **PASS**  
**Date:** 2026-07-20  
**Acceptance environment:** rebuilt Docker backend using PostgreSQL 16; SQLite was not used  
**Mobile status:** `MobileApp/` was not created

Gate 1 passes because the authentication lifecycle, attendance contract, tenant isolation, and private-file controls are
implemented and covered by regression/security tests. No critical or high unresolved security blocker remains.

## Changes made

### Authentication lifecycle

- Added the routed `POST /auth/refresh` contract without removing the legacy login `data.token` field. Login now also
  returns identical `data.access` plus `data.refresh`.
- Fixed token lifetimes at 15 minutes for access and 14 days for refresh. Successful refresh rotates and blacklists the
  submitted refresh token; reuse, expiry, revocation, and invalid token-version cases return a generic `401`.
- Added `User.auth_token_version` in migration `accounts.0004_user_auth_token_version`. Versioned authentication rejects
  legacy/unversioned tokens and makes logout or password change invalidate all prior access tokens immediately.
- Logout and password change increment the token version, blacklist all outstanding refresh tokens, and emit audit events.
  Authentication audit records and error responses do not expose credentials, tokens, or account-enumeration detail.

### Attendance reliability

- Removed the maintenance `503` guards and the skipped attendance test module that had hidden the invalid mobile contract.
- Restored employee timeline, check-in, and check-out; retained explicit role permissions for HR, manager, and CEO actions.
- Enforced employee ownership and active-company scope, including fail-closed behavior when a profile has no company.
- Added atomic duplicate check-in handling, row-locked checkout, explicit `405` for unsupported direct creation, workflow
  audit coverage, and correction-request company isolation.
- Corrected the web CEO approval client to use the actually routed `/api/ceo/attendance/...` path.

### Tenant isolation and private files

- Scoped announcements, employee self-service leave, employee documents, and employee payslips by authenticated owner and
  active company. Cross-company and object-identifier probes return generic not-found responses.
- Applied active-company scope to announcement role/team targeting. The legacy `attachment-public` URL is retained only as
  a deprecated compatibility route and now requires authentication, company scope, and a valid signature.
- Employee document and announcement uploads validate allowed extension, claimed MIME, size, and file signature.
- Private uploads are downloaded as forced attachments with `nosniff` and private/no-store cache controls. Downloads are
  audited; untrusted uploaded files are never rendered inline.
- Payslips are owner-only, active-company scoped, limited to active records in completed/paid runs, and audited on list,
  detail, and download. Year input is validated and employee override parameters are rejected.

### Realtime containment

- Deferred mobile/web WebSockets. `/ws/notifications/` remains routed for compatibility but rejects every handshake before
  acceptance with close code `4403`, including query-token, authorization-header, and session-cookie attempts.
- Removed JWT query/header parsing and session authentication from the WebSocket path. The web runtime now performs an
  immediate authenticated REST poll and repeats every 20 seconds, clearing its scope on logout, user change, or company
  change. REST polling is the mobile baseline.

### Contract and policy synchronization

- Updated `Global API Rules (v1).txt`, `API Route Status Matrix.md`, and the mobile master plan for every intentional
  contract change or containment decision.
- Updated `SECURITY_POLICY.md` for token versioning/revocation, file validation/download behavior, and realtime deferral.
- Updated project context and the realtime implementation plan so active behavior is not described as WebSocket delivery.

## Verification evidence

All backend acceptance commands below ran inside the rebuilt Docker backend against the Docker PostgreSQL service.

| Area | Evidence | Result |
|---|---|---|
| Full backend regression | `docker compose exec -T backend pytest -q --create-db` | **339 passed, 12 subtests passed**, 2 pypdf deprecation warnings |
| Focused Gate 1 regression | Accounts, attendance, announcements, documents, leave, payslips, and deferred realtime tests | **82 passed** |
| Tenant isolation | Announcement, document, leave self-service, and payslip security modules | **27 passed** |
| Django configuration | `python manage.py check` | Passed; zero issues |
| Migration consistency | `python manage.py makemigrations --check --dry-run` and `python manage.py migrate --check` | Passed; no model drift or unapplied migration |
| Frontend polling | Notification polling manager tests | **5 passed** |
| Frontend regression | Full Vitest run | **80 passed** across 9 files |
| Frontend static/build | TypeScript, ESLint, changed-file Prettier, production build | Passed; ESLint had zero errors and 35 pre-existing warnings |

Route-resolution checks covered login, refresh, logout, password change, employee attendance, correction requests,
announcement attachments, employee documents, payslips, and notification REST endpoints. Protected unauthenticated probes
returned `401`; login/refresh GET probes returned `405`; the deprecated announcement compatibility download returned `401`
before object or signature processing.

Security tests explicitly verify:

- **Authentication:** response shape, fixed expiry, refresh rotation/blacklist/reuse, generic failures, required token version,
  deployment rejection of legacy tokens, immediate logout/password-change revocation, and audit events.
- **Attendance:** restored non-503 self-service, permission boundaries, ownership, company scope, duplicate/missing-state
  failures, direct-create rejection, correction scope, and BioTime administrative permission.
- **Tenant isolation:** cross-company list/detail/object probes for announcements, leave, documents, attachments, and payslips.
- **Documents/attachments:** upload size/type/signature rejection; forced private download headers; authenticated, scoped,
  audited access; anonymous and cross-company denial.
- **Payslips:** owner/company/run-state filters, invalid year/override failures, generic IDOR denial, protected download, and
  list/detail/download audit events.
- **Realtime:** plain, query-token, authorization-header, and session-cookie handshakes all close pre-accept with `4403`.

Static review found no remaining attendance maintenance `503` guard or module skip, no public attachment `AllowAny`, no
production WebSocket JWT construction/query-token acceptance, and no common private-key/API-token signature in the scoped
changed files. `MobileApp/` is absent.

## Remaining risks

- Docker `/healthz/` currently reports optional notification dependencies `celery_worker=down` and `evolution_api=down`
  when the Evolution/WhatsApp profile is not running, and the notification worker retries. This is an operational messaging
  configuration issue, not an authentication/API authorization bypass. Deployment must either enable the approved provider
  stack or explicitly disable optional WhatsApp delivery before production health acceptance.
- `requirements.txt` uses a loose `Django>=5.0` constraint, so a fresh image currently resolves Django 6.0.7 while project
  documentation refers to the 5.2 line. Pinning the validated dependency set is recommended for reproducible releases.
- The repository-wide Prettier check includes 238 pre-existing unformatted files, and ESLint reports 35 pre-existing
  warnings. Changed Gate 1 frontend files pass targeted formatting and no lint error remains.
- Two full-suite warnings come from deprecated pypdf `PageObject.replace_contents()` behavior in the existing leave-request
  PDF test path. They do not affect Gate 1 authorization, but should be removed before pypdf 7.
- Realtime delivery remains intentionally unavailable. Any future enablement requires an approved opaque, short-lived,
  company-bound ticket and tested expiry/logout/password-change disconnect behavior; JWTs must not be placed in URLs.

None of these remaining items is a critical or high unresolved Gate 1 security blocker.

## Final decision

**Gate 1 passes.** Authentication lifecycle and global revocation are verified; attendance no longer fails unexpectedly;
cross-company/IDOR tests pass; private attachments and documents are protected; and no critical/high security blocker is
open. Gate 2 may be planned separately, but this remediation task did not create or scaffold `MobileApp/`.
