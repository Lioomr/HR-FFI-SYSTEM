# API Route Status Matrix

**Last reviewed:** 2026-07-30
**Gate 1 status:** **Pass**; API/security blockers remediated and verified with Docker/PostgreSQL.  
**Gate 3 status:** **Pass**; the employee mobile client now consumes these routes. No route, permission, or response contract was changed — the 2026-07-28 edits record verification only.  
**Purpose:** reconciled mobile endpoint index. Django URL resolution, views, serializers, permissions, and tests are authoritative.

## Employee mobile MVP routes

| Area | Actual route and method | Status | Verified behavior / required action |
|---|---|---|---|
| Login | `POST /auth/login` | Current; Gate 1 verified | Throttled and lockout-protected. Preserves `data.token` and adds the identical `data.access` plus rotating `data.refresh`. Access lifetime is fixed at 15 minutes; refresh lifetime is 14 days. Login success/failure audits contain no credentials or tokens. |
| Refresh | `POST /auth/refresh` | Current; Gate 1 verified | Accepts `{refresh}` and returns `token`, `access`, and a rotated `refresh`. Used tokens are blacklisted; reuse, expiry, revocation, and missing/incorrect version claims return a generic 401. An expired access header does not block body-token refresh. |
| Change password | `POST /auth/change-password` | Current; Gate 1 verified | Validates current password and policy, emits `password_changed`, increments the server token version, and blacklists all outstanding refresh tokens. Every prior access/refresh token is immediately rejected. |
| Logout | `POST /auth/logout` | Current; Gate 1 verified | Global account logout: emits `logout`, increments the server token version, blacklists all outstanding refresh tokens, and immediately rejects all prior access/refresh tokens. Realtime accepts no connections, so no authenticated socket can survive logout. |
| Current user | `GET /auth/me` | Current | Returns identity, role, accessible organizations, and default organization in the success envelope. |
| Self profile/status | `GET /api/employees/me/` | Current; contract review required | Owner-fixed lookup. Returns a wide serializer containing identity, salary, employment status, and leave balances. Define least-data/on-demand mobile types and active-company behavior. |
| Employee documents | `GET/POST /api/employees/{id}/documents/`, `POST .../{document_id}/extract/`, and `GET .../{document_id}/download/` | Current; Gate 1 verified | Owner/HR permission and active-company scope return generic 404s for IDOR/cross-company attempts. Uploads validate extension, claimed MIME, size, and PDF/JPEG/PNG signatures. Passport, Iqama/Saudi ID, and Visa OCR is queued to the Celery worker; HR/SystemAdmin can retry Pending/Failed extraction. Downloads are audited `application/octet-stream` attachments with `nosniff` and private no-store headers. |
| Employee documents (`me` alias) | `GET /api/employees/me/documents/` | Current; Gate 3 verified | `EmployeeProfileViewSet._document_profile_for_request` resolves `pk == "me"` to the caller's own active-company profile, so a client never holds or transmits a profile identifier. Same permission, scope, and audit behavior as the numeric form. Mobile uses this alias. The list serializer keeps `file` write-only, so no download URL or storage path is emitted. |
| Leave types | `GET /api/leaves/leave-types/` | Current; Gate 3 verified | `LeaveTypeViewSet.list` allows any authenticated user, applies `filter_queryset_by_company_scope`, and restricts the `Employee` role to `is_active=True`. Write actions remain HR/SystemAdmin only. Mobile uses this to populate the leave-request form. |
| Cancel own leave request | `POST /api/leaves/leave-requests/{id}/cancel/` | Current; Gate 3 verified | `IsLeaveRequestOwner` plus a re-filter on `employee=request.user, is_active=True`; non-owned returns 404. Only `submitted`, `pending_hr`, and `pending_manager` are cancellable; anything else returns 422. Emits a `cancel` audit and a `leave.cancelled` notification. |
| Employee route compatibility | `/employees/*` and `/api/employees/*` | Compatibility duplication | Both resolve because `employees.urls` is included twice. Mobile must use `/api/employees/*`; preserve/remove the root family only through an approved compatibility change. |
| Manager capability access | `GET /api/employees/manager/access/` and compatibility `/employees/manager/access/` | Current | Capability is derived from active `EmployeeProfile.manager_profile` direct reports (or an active same-company delegation), not Manager-group membership. Returns `has_access`, `managed_employee_count`, `source`, and the manager scopes. Archived/inactive reports do not count. |
| Dashboard summary | `/employee/summary` | Legacy/missing | No route exists. Compose the dashboard from approved current endpoints or add a reviewed aggregate endpoint. |
| Separate profile/status | `/employee/profile`, `/employee/status` | Legacy/missing | No routes exist. Do not implement these examples in a client. |
| Attendance timeline/check-in/out | `GET /api/attendance/me/`; `POST /api/attendance/me/check-in/`; `POST /api/attendance/me/check-out/` | Current; Gate 1 verified | Maintenance 503 guards and module skip were removed. Employee ownership, allowed roles, active-company match, 10/min mutations, duplicate/missing-state failures, row locking, workflow sync, and audits are covered. Profiles without a company fail closed. |
| Attendance corrections | `/api/attendance-correction-requests/` | Current; Gate 1 verified | Employee ownership/workflow controls remain; HR/SystemAdmin, manager, and CEO querysets are active-company scoped with cross-company negative coverage. Direct attendance create returns deliberate 405 rather than 503. |
| Submit leave | `POST /api/leaves/leave-requests/` | Current | Server fixes ownership to the caller. Actual field is `leave_type`, not the legacy `leave_type_id`. Upload validation and submit audit exist. |
| My leave requests | `GET /api/leaves/employee/leave-requests/` and `/{id}/` | Current; Gate 1 verified | Owner-only, active-company scoped, and paginated with `data.items`; employee override parameters are rejected. HR/delegated routes were not changed. |
| Leave balance | `GET /api/leaves/employee/leave-balance/?year=` | Current | Employee-only, active-company-aware calculation with audit coverage. |
| Annual Leave settlement | `GET/POST /api/leaves/annual-leave-payments/`; `GET /api/leaves/annual-leave-payments/eligibility/`; `POST /api/leaves/annual-leave-payments/{id}/review/`; `POST .../{id}/approve/`; `POST .../{id}/reject/` | Current | Contract-date accrual is 1.75 days per completed calendar month; employee payment requests are limited to the final 5 contract-year days, reviewed by HR, and finally decided by CEO. Eligibility is calculated server-side. HR may create a post-year-end pay/carry-forward decision for an employee when no request was submitted. All routes are authenticated and active-company scoped. |
| Payslips | `GET /employee/payslips/`; `GET /employee/payslips/{id}/`; `GET /employee/payslips/{id}/download/` | Current; Gate 1 verified | Owner-only, active-company, active-record, and completed/paid-run filters return generic 404 for IDOR. List supports validated `year`; list/detail/download audits and protected download headers are tested. Mobile DTOs must still follow the backend serializers. |
| Announcements | `GET /api/announcements/`; `GET /api/announcements/{id}/` | Current; Gate 1 verified | All employee/manager/CEO/HR branches and team targeting use active-company scope. Cross-company list/detail/attachment attempts are tested and hidden. |
| Announcement attachment | `GET /api/announcements/{id}/attachment/` | Current; Gate 1 verified | Authenticated/scoped, audited, forced `application/octet-stream` attachment with `nosniff` and private no-store headers; inline rendering is not supported. |
| Public announcement attachment | `GET /api/announcements/{id}/attachment-public/?token=...` | Deprecated authenticated compatibility | Path is preserved, but anonymous access is rejected. It requires normal authentication, active-company object access, and the signed token, then returns the same audited forced-download response plus deprecation headers. Do not use it in mobile. |
| Notifications REST | `GET /api/notifications/`; `GET /unread-count/`; `POST /{id}/read/`; `POST /read-all/` | Current | Recipient and company scoped; delivery details are role-redacted. REST polling is the initial mobile transport. |
| Notifications WebSocket | `WS /ws/notifications/` | Intentionally deferred; Gate 1 contained | Compatibility path remains routed but every handshake closes before acceptance with code `4403`. JWT query/header parsing and session authentication were removed. Web/mobile use recipient/company-scoped REST polling; a future realtime design needs approved opaque ticket, company binding, expiry, and revocation disconnect controls. |
| Push registration | No route | Planned/missing | Define device registration/revocation and privacy-safe payload contracts only after security approval. |

## Contract reconciliation notes

- Paginated mobile endpoints currently use `{status, data: {items, page, page_size, count, total_pages}}`; do not type them as DRF `{count,next,previous,results}` without verifying the target endpoint.
- The employee payslip web DTO contains fields not emitted by the backend serializers. Mobile types must follow the reconciled backend contract.
- Cross-company leave delegation is intentional in current tests but remains a security/product exception requiring explicit acceptance.
- Loans, assets, agent memory, and all HR/admin/approval families are outside the first employee mobile release unless the master plan is changed explicitly.
- `payroll.permissions.IsEmployeeOnly` requires exactly the `Employee` role, while `leaves.permissions.IsEmployeeOnly` also allows `Manager` and `HRManager`. A Manager therefore reaches leave and attendance self-service but receives 403 on payslips. This asymmetry is existing intentional backend behavior; the mobile client surfaces it as a generic access-unavailable state. Product confirmation is outstanding.
- Announcement detail returns its payload wrapped as `data.announcement`, unlike the list route which returns the standard `data.items` page. Type both shapes separately.
- Protected binary downloads (`payslips/{id}/download/`, `documents/{id}/download/`, `announcements/{id}/attachment/`) remain current for the authenticated web application but are **not** consumed by `MobileApp` in the first release. Mobile renders authenticated structured payslip details, employee document metadata, and announcement/attachment metadata only. Mobile must not fetch, render, persist, share, export, use a WebView, deep-link, or use signed URLs for protected binaries. Any future mobile viewing requires a separate security-reviewed design. This approved product decision does not mark Gate 4 passed.

## Gate 1 evidence

- Authentication tests cover login shape, fixed expiry, refresh rotation/blacklist/reuse, generic errors, version mismatch,
  deployment rejection of legacy unversioned tokens, logout/password-change revocation, and audits.
- IDOR and active-company tests cover payslips, leave lists, announcements, attendance/corrections, and protected downloads.
- Attendance self-service is restored and its previously skipped suite is active.
- Announcement/document downloads comply with authenticated, forced-download, no-inline, audit, and content-validation rules.
- WebSocket credential exposure is removed by deliberate deferral; REST polling is the approved web/mobile baseline.
- Docker/PostgreSQL focused Gate 1 suite: 82 passed. Tenant-isolation suite: 27 passed. Final rebuilt-image backend
  suite: 339 passed plus 12 subtests. See the Gate 1 remediation report for commands and complete evidence.

This matrix records Gate 1’s reconciled contract; continue inspecting the implementation before every future change.
