# Backend delivery report for the Delivery Manager

TASK_ID: Not supplied; manager assignment required.  
FEATURE: Attendance scheduling/late/absence classification, contract-expiry decisions, and associated workflow/email/PDF changes. **Scope inferred from commit `e64d280`, not confirmed against an acceptance ticket.**  
BRANCH: `main`  
REPORT DATE: 2026-09-02, Asia/Riyadh  
REVIEWED HEAD: `6f4e0240d3f8594ff77d102c7b9979cddbc21689`  
BASELINE: `53a180fac2fb032edd71e76b71d63b4452cf835a` (`e64d280^`)  
STATUS: **NEEDS_REVIEW**  
FINAL RECOMMENDATION: **RETURN FOR FIXES**

## 1. Executive summary

The request in this session was to prepare an evidence-based backend delivery report. No feature specification, task identifier, or comparison branch was supplied. The checkout was clean on `main`; the latest commit changes frontend token refresh only. The most recent substantive backend delivery is `e64d280`, titled `feat: deliver attendance and contract workflow updates`. This report reviews that implementation at the current HEAD, including the subsequent removal of two generated PDF field-map files. It does not claim this session authored the feature or verified its original acceptance criteria.

Implemented in the reviewed commit:

- A global work schedule with a start time, grace period, working weekdays, and enabled-by-default absence detection; late classification on BioTime ingestion and employee check-in; preservation of the late flag in CEO approval; automatic absence detection and a backfill command.
- Company-scoped contract-decision list/detail/submission/approval/rejection, salary snapshots and proposed terms, HR-to-CEO workflow, 90/45/31/17-day reminders, reminders at 10-hour intervals, automatic approval after 48 hours, automatic renewal after expiry without HR action, and manual-resolution/final-notification state.
- Shared bilingual email templates, notification rendering changes, an annual-entitlements blank PDF, a changed loan PDF, and Celery beat process health checks.

The existing 26 feature tests passed on a fresh PostgreSQL 16 database. Independent review probes expose defects the feature tests miss, including a termination failure for BioTime-mapped employees, invalid salary acceptance, inconsistent salary totals, incomplete workflow history, and email HTML injection. The changed loan PDF path also has a pre-existing ownership bypass. These findings prevent acceptance even if other regression tests pass. Detailed results, including incomplete attempts and mistakes in review fixtures, appear in section 6.

Work performed in this session: source/diff review, route resolution, isolated test execution, additional reproduction tests, and this report. **No application fixes, migrations, commits, pushes, or deployments were made.** Proposed remedies below are outstanding work.

## 2. Changed files

The net backend delivery relative to the baseline contains 53 files under `Backend/`, plus two Compose files. `A` means added, `M` modified, and `D` deleted. Paths below are relative to the repository. The frontend/mobile implementation is companion work and was inspected only where needed to assess integration, not certified by this backend report.

| File | Change and reason | Frontend integration effect |
|---|---|---|
| `Backend/admin_portal/migrations/0003_systemsettings_attendance_schedule.py` | A: four schedule fields and defaults; persists attendance policy. | Indirect: migration must precede API use. |
| `Backend/admin_portal/models.py` | M: start time, grace, absence switch and weekday list on singleton settings. | Yes: additional settings fields; one policy across companies. |
| `Backend/admin_portal/serializers_settings.py` | M: exposes/persists those fields, validates grace/weekdays, audits changed values through the existing view. | Yes: nested `attendance` payload and response. |
| `Backend/admin_portal/views_users.py` | M: reset-password email context/rendering uses the generic template and contact/logo settings. | Email appearance changes; reset API JSON unchanged. |
| `Backend/attendance/absence.py` | A: eligible-profile/approved-leave filtering, bulk absence creation, summary audit. | Yes: system `ABSENT` rows appear in lists. |
| `Backend/attendance/management/commands/backfill_absences.py` | A: date-range administrative replay with `--dry-run`; supports historical population. | Indirect: changes attendance history. Dry-run does not calculate a preview. |
| `Backend/attendance/migrations/0011_attendancerecord_is_late_flagged.py` | A: default-false late flag on existing/new records. | Indirect: required schema. |
| `Backend/attendance/models.py` | M: stores original late classification through pending approval. | Yes: read-only `is_late_flagged`. |
| `Backend/attendance/schedule.py` | A: schedule loading, cutoff calculation, classification and leave helper. | Yes: defines late behavior and displayed minutes. |
| `Backend/attendance/serializers.py` | M: exposes flag and computed minutes; caches schedule per serializer. | Yes: two added read-only fields in record responses. |
| `Backend/attendance/services.py` | M: classifies BioTime punches, updates eligible system rows, preserves overrides and acknowledgment gate. | Yes: ingested rows may be `LATE`; late punches may resolve `ABSENT`. |
| `Backend/attendance/tasks.py` | M: yesterday's absence task and cache overlap guard. | Asynchronous changes to attendance lists. |
| `Backend/attendance/test_schedule_absence.py` | A: 12 tests for schedule, ingestion, absence eligibility/idempotency and audit. | No runtime effect. |
| `Backend/attendance/tests.py` | M: deterministic schedule setup in existing tests. | No runtime effect. |
| `Backend/attendance/views.py` | M: late flag at self check-in; transactional manager/CEO actions; CEO approval retains `LATE`. | Yes: check-in side effects and decision outcomes. |
| `Backend/config/celery.py` | M: hourly contract processing and daily absence schedule. | Indirect: timing of visible state transitions. |
| `Backend/config/settings.py` | M: optional `EMAIL_CONTACT_NAME` and `EMAIL_CONTACT_PHONE`. | Email footer metadata; no API field change. |
| `Backend/core/services/bird_email_service.py` | M: hosted-logo fallback, generic bilingual detail rows, shared leave/document/meeting/invite/delegation rendering. | Email content/links change; see HTML injection finding. |
| `Backend/core/services/pending_approval_email.py` | M: distinct recipient queries; generic approval email context. | Email presentation; deduplicated recipient query. |
| `Backend/core/services/request_submission_email.py` | M: generic receipt email and detail rows. | Submission emails change. |
| `Backend/core/services/workflow_engine.py` | M: contract template/adapter/events, review paths and pending-inbox item type. | Yes: `CONTRACT_DECISION` inbox items and workflow fields. |
| `Backend/core/templates/emails/announcement_notification.html` | M: adapts announcement content to revised shared layout. | Announcement email presentation. |
| `Backend/core/templates/emails/base_email.html` | M: shared bilingual layout, styling, actions, footer. | All dependent emails change visually. |
| `Backend/core/templates/emails/delegation_notification.html` | D: replaced by generic delegation rendering. | Email-only; external callers using the old template name would break. |
| `Backend/core/templates/emails/document_expiry_reminder.html` | D: replaced by generic document reminder rendering. | Same template-name compatibility concern. |
| `Backend/core/templates/emails/generic_notification.html` | A: reusable bilingual rows/actions template. | Email-only; raw-HTML extension points need escaping controls. |
| `Backend/core/templates/emails/invite_user.html` | D: replaced by generic invitation rendering. | Email-only; old template name removed. |
| `Backend/core/templates/emails/leave_request_approved.html` | D: replaced by generic approval rendering. | Email-only; old template name removed. |
| `Backend/core/templates/emails/leave_request_rejected.html` | D: replaced by generic rejection rendering. | Email-only; old template name removed. |
| `Backend/core/templates/emails/leave_request_submitted.html` | D: replaced by generic submission rendering. | Email-only; old template name removed. |
| `Backend/core/templates/emails/meeting_notification.html` | D: replaced by generic meeting rendering. | Meeting email links affected. |
| `Backend/core/templates/emails/password_reset_email.html` | D: reset rendering moved to generic template. | Reset email appearance; JSON unchanged. |
| `Backend/core/templates/emails/pending_approval_email.html` | D: pending approval rendering moved to generic template. | Approval email appearance. |
| `Backend/core/templates/emails/request_submission_email.html` | D: submission receipt rendering moved to generic template. | Receipt email appearance. |
| `Backend/core/tests_email_service.py` | M: test now uses generic template name. | No runtime effect; filename requires expanded pytest discovery. |
| `Backend/core/tests_templates.py` | M: asserts annual-entitlements catalog entry. | No runtime effect; filename requires expanded pytest discovery. |
| `Backend/core/views_templates.py` | M: adds annual-entitlements catalog/download key. | Yes: new catalog item and downloadable file. |
| `Backend/employees/contract_expiry.py` | A: decision lifecycle, snapshots, term parsing, reminders, automatic actions, audits and retries. | Yes: core contract behavior. |
| `Backend/employees/migrations/0017_contractdecision.py` | A: contract decision table, relationships, indexes and cycle uniqueness. | Indirect: required before endpoints/workers. |
| `Backend/employees/migrations/0018_contractdecision_manual_resolution.py` | A: adds manual-resolution status choice. | Yes: additional status for UI. |
| `Backend/employees/migrations/0019_contractdecision_automatic_renewal_metadata.py` | A: records automatic-renewal flag/reason. | Yes: explanation fields. |
| `Backend/employees/migrations/0020_contractdecision_final_notification_state.py` | A: persists notification attempt/sent timestamps and count. | Yes: delivery-progress fields. |
| `Backend/employees/models.py` | M: adds `ContractDecision`; preserves existing employee model schema. | Yes: serialized contract record. |
| `Backend/employees/serializers.py` | M: contract read/submit/comment serializers; workflow and safe delivery summaries. | Yes: complete contract shape described below. |
| `Backend/employees/tasks.py` | M: contract processing task with database-error retries and attention logging. | Indirect: periodic finalization and notifications. |
| `Backend/employees/test_contract_expiry.py` | A: 14 service/API tests including basic role and tenant rejection. | No runtime effect. |
| `Backend/employees/urls.py` | M: registers contract-decision read/action routes before generic employee routes. | Yes: exact route additions. |
| `Backend/employees/views.py` | M: employee submission action and company-scoped contract list/detail/approve/reject viewset. | Yes: new endpoints and list filters. |
| `Backend/in_app_notifications/dispatcher.py` | M: generic branded fallback email instead of minimal HTML. | Email presentation; queue API unchanged. |
| `Backend/job_offers/notifications.py` | M: bilingual generic submission/decision/starting-work email content and links. | Email notifications change; HTTP schemas unchanged. |
| `Backend/loans/views.py` | M: adds machine-readable loan-title text to generated PDF. | Yes: downloaded PDF content; pre-existing access defect requires correction. |
| `Backend/static/pdf_templates/annual_entitlements_disbursement_blank.pdf` | A: new blank bilingual entitlement form. | Yes: new download; visual layout not independently approved here. |
| `Backend/static/pdf_templates/loan_request_blank.pdf` | M: replaced loan form artwork. | Yes: PDF appearance; production rendering needs visual review. |
| `docker-compose.dev.yml` | M: adds a Celery beat process health check. | Indirect: local scheduling operations. |
| `docker-compose.yml` | M: same beat process health check for deployed layout. | Indirect: operational status; not proof that tasks execute. |

Two additional files were added by `e64d280` and deleted by `e4e865c`, so are absent in the net baseline-to-HEAD diff: `Backend/static/pdf_templates/annual_entitlements_disbursement_blank_field_map.json` and `Backend/static/pdf_templates/loan_request_blank_field_map.json`. They were generated template-coordinate metadata; their removal was artifact cleanup. No dependency on them was established in the reviewed change; do not treat them as deployment deliverables.

Companion frontend integration already exists in `contractDecisionsApi.ts`, `ContractDecisionsPage.tsx`, `PendingInboxPage.tsx`, `AttendancePreviewPage.tsx`, `AttendancePage.tsx`, settings/weekday components, routes, navigation, translations and attendance/API types. Frontend tests/build and mobile changes are outside this backend verification. The later frontend refresh commit is outside the feature comparison.

## 3. Database changes

| Model | Schema and migration | Compatibility and verification |
|---|---|---|
| `SystemSettings` | `admin_portal.0003_systemsettings_attendance_schedule`: `work_day_start_time=09:00`, `late_grace_minutes=15`, `absence_detection_enabled=True`, weekdays `[6,0,1,2,3]` (Sunday–Thursday). | Additive schema, but enabling absence detection is a behavioral rollout. Singleton is deployment-wide, not company-specific. Fresh PostgreSQL migration passed. |
| `AttendanceRecord` | `attendance.0011_attendancerecord_is_late_flagged`: boolean default `False`. | Existing records receive false; no historical late backfill is included. Computed minutes use current settings, so old flags/status may disagree after policy changes. Fresh PostgreSQL migration passed. |
| `ContractDecision` | `employees.0017_contractdecision`: non-null protected company/employee FKs; nullable user references; dates/JSON terms/status/comments/timestamps; unique `(employee_profile, original_contract_expiry)`; company/status and status/deadline indexes. | New table; does not migrate old contracts into decisions. Scheduler/endpoint creates decisions at runtime. Fresh PostgreSQL migration passed. |
| `ContractDecision.status` | `employees.0018_contractdecision_manual_resolution`. | Extends choices; clients must handle the new state. Fresh PostgreSQL migration passed. |
| `ContractDecision` automation metadata | `employees.0019_contractdecision_automatic_renewal_metadata`. | Adds boolean/reason with defaults. Fresh PostgreSQL migration passed. |
| `ContractDecision` notification state | `employees.0020_contractdecision_final_notification_state`. | Adds attempt count and nullable last-attempt/sent timestamps. Fresh PostgreSQL migration passed. |

There is no feature data migration. `makemigrations --check --dry-run` reports no model/migration drift. A clean PostgreSQL migration chain completed, and fresh test databases applied the migrations. Production-data upgrade, reversal with existing decisions, migration lock duration and rollback rehearsal were **not** tested. Reversing schema changes would discard new decision/schedule metadata and must not be presented as a safe production rollback without a plan.

SQLite migration execution fails in the pre-existing PostgreSQL tenant-integrity migration (`employees.0015_database_tenant_integrity`, SQL `DO $$`). This is an environment limitation, not a demonstrated defect in the six new migrations. PostgreSQL is required for meaningful trigger/locking validation.

## 4. API contract

### Common conventions and source authority

Routes below are based on Django URL resolution and actual view/serializer code, not the older route examples in context notes. [Route evidence](../output/backend-delivery-2026-09-02/route-inventory.json) resolves 31 concrete paths, including aliases. Headers for protected HTTP calls:

```http
Authorization: Bearer <access-token>
x-active-company-id: <authorized-company-id>
Content-Type: application/json
Accept: application/json
```

Omit `Content-Type` on bodyless GET/download requests; use `Accept: application/octet-stream` for private PDFs if desired. Missing/invalid authentication normally returns 401; most role denials are 403. Authentication is `VersionedJWTAuthentication`. Most feature API tests use DRF `force_authenticate`, so they verify authorization/business behavior rather than JWT parsing.

`x-active-company-id` selects an authorized company; it does not grant access. Invalid, conflicting or unauthorized selectors return 403. Without a selector, organization services choose an available default. Contract/HR attendance queries use exactly the active company, including for SystemAdmin, and exclude null-company rows. Employee-like users including CEO use their profile company; organization-access rows alone do not grant them HR-style multi-company access. Settings and blank template catalog are global exceptions described below.

Define `S(value)` as `{"status":"success","data":value}`. An optional message is returned only when explicitly supplied. Define `P(rows)` as:

```json
{"status":"success","data":{"items":[],"page":1,"page_size":25,"count":0,"total_pages":1}}
```

Actual error formats:

```json
{"status":"error","message":"Not found"}
```

```json
{"status":"error","message":"This field is required.","errors":[{"field":"decision_type","message":"This field is required."}]}
```

```json
{"status":"error","message":"This contract decision is no longer awaiting HR action.","errors":["This contract decision is no longer awaiting HR action."]}
```

DRF exceptions may additionally return `detail`; errors can be lists of strings or `{field,message}` objects. Validation generally returns 422, malformed JSON 400, invalid page 404, and unsupported method 405. Unhandled exceptions are masked as `{"status":"error","message":"Server error"}` with HTTP 500. Error text may be localized. Clients must use HTTP status and support both error-list forms.

### Contract decision object and submission schema

`ContractDecisionReadSerializer` returns all of the following:

- Identity: `id`, `company`, `employee:{id,employee_id,full_name,company_id}`.
- Decision: `decision_type`, `decision_type_label`, `status`, `status_label`.
- Dates/terms: `original_contract_date`, `original_contract_expiry`, `proposed_contract_date`, `proposed_contract_expiry`, `original_terms`, `proposed_terms`.
- Actors: `requested_by`, `ceo_decided_by`, `finalized_by` (user IDs or null).
- Explanations: `hr_comment`, `ceo_comment`, `failure_reason`, `automatic_renewal_reason`.
- Timing/counts: `submitted_at`, `ceo_deadline`, `ceo_decided_at`, `last_ceo_reminder_at`, `ceo_reminder_count`, `finalized_at`, `created_at`, `updated_at`.
- Automation: `finalized_by_system`, `automatic_renewal`.
- Notification persistence: `final_notification_sent_at`, `final_notification_attempts`, `last_final_notification_attempt_at`.
- `workflow:{status,current_stage,current_actor,current_approver_role,can_approve,can_reject,can_cancel,history}`. Actors may include ID/name/email; history includes action/stage/actor/time/note/transitions/metadata.
- `notification_status:[{id,event_key,milestone,created_at,deliveries:[{channel,status}]}]`. It does not expose provider errors, authorization material, full provider payloads or recipient addresses. This is decision-level delivery visibility for authorized reviewers, not a recipient's private notification inbox.

Dates are `YYYY-MM-DD`; datetimes are ISO 8601 with an offset or UTC. Terms use numeric strings or null. Allowed term keys: `basic_salary`, `transportation_allowance`, `accommodation_allowance`, `telephone_allowance`, `petrol_allowance`, `other_allowance`, `total_salary`.

Submission body `D`:

```json
{"decision_type":"RENEW_WITH_CHANGES","proposed_contract_date":"2026-12-02","proposed_contract_expiry":"2027-12-01","proposed_terms":{"basic_salary":"1500.00"},"hr_comment":"Proposed renewal"}
```

Only `decision_type` is required; choices are `RENEW`, `RENEW_WITH_CHANGES`, `TERMINATE`. Proposed dates are optional/nullable, terms optional object, comment optional string. Termination clears submitted dates/terms. Renewal derives missing dates from original duration. Both renewal types currently accept term changes; do not assume `RENEW` enforces unchanged salary. Unknown term keys and ordinary invalid numeric strings are rejected, but non-finite and oversized values are **incorrectly accepted**. Extra top-level contract fields are not explicitly rejected by these serializers. No employee/company/actor/status field is writable through this body.

### Contract endpoints

All require authentication and the common company rules. The five `/api/...` routes also exist without `/api` because `employees.urls` is included twice; both slash/no-slash forms are supported by that router. Use the `/api/.../` forms in new frontend code. This duplication is an existing URL-layout deviation requiring documentation, not a new compatibility rename.

| Method and exact route | Permission and request | Success and example | Validation / permission / not-found behavior |
|---|---|---|---|
| `POST /api/employees/{employee_profile_id}/contract-decisions/` | HRManager or SystemAdmin. Body `D`; employee must be in active scope, normally unarchived, with contract expiry. | 200 `S(ContractDecision)` in `PENDING_CEO`. Example: POST `/api/employees/42/contract-decisions/` with `{"decision_type":"RENEW"}` → `S({id:7,employee:{id:42,...},status:"PENDING_CEO",...})`. | 422 missing expiry/type, invalid dates/terms or non-submittable cycle. 403 wrong role/company selector. 404 absent/out-of-scope employee. Existing cycle only resubmits from `PENDING_HR` or `MANUAL_RESOLUTION_REQUIRED`. |
| `GET /api/employees/contract-decisions/` | HR/Admin: active-company decisions. CEO approver: pending CEO, personally decided, or manual/failure records in company. Other authenticated users: empty list. Optional `status`, `employee_id` substring of business employee code, `page`, `page_size`. | 200 `P(ContractDecision[])`. Example GET `...?status=PENDING_CEO&page=1&page_size=25` → `P([{id:7,status:"PENDING_CEO",...}])`. | Unknown status is not choice-validated and generally returns empty rows. 403 invalid scope. Invalid/nonexistent page 404. No 403 merely for ordinary employee list access; it is empty. |
| `GET /api/employees/contract-decisions/{decision_id}/` | Same visibility as list. No body. | 200 `S(ContractDecision)`. Example GET `/api/employees/contract-decisions/7/` → `S({id:7,status:"PENDING_CEO",...})`. | 404 missing or invisible record, including ordinary employee. 403 invalid scope. No additional input fields. |
| `POST /api/employees/contract-decisions/{decision_id}/approve/` | CEO-approver identity plus `can_user_act_on_instance`; optional `{"comment":"Approved"}`. Identity includes CEO/SystemAdmin, applicable department approvers and delegation, not only the CEO group. | 200 `S(ContractDecision)`, normally `APPROVED`; stale snapshot can instead return `MANUAL_RESOLUTION_REQUIRED` **with HTTP 200**. Example POST `/.../7/approve/` → `S({id:7,status:"APPROVED",...})`. | 422 malformed comment/service state or date error; 403 non-approver/workflow cannot act (including duplicate approval); 404 out-of-scope/missing record. Known mapped-employee termination and invalid persisted terms can produce 500. |
| `POST /api/employees/contract-decisions/{decision_id}/reject/` | Same approval authority; optional `{"comment":"Not approved"}`. Empty comment currently allowed. | 200 `S(ContractDecision)` with `REJECTED`; employee contract unchanged. Example POST `/.../7/reject/` → `S({id:7,status:"REJECTED",ceo_comment:"Not approved",...})`. | 422 invalid comment/state; 403 cannot act; 404 missing/invisible record. Rejected cycle has no resubmit/reopen endpoint in this implementation. |

These shorthand examples refer to the complete object schema above, not literal abbreviated JSON payloads. [Captured synthetic requests' response bodies](../output/backend-delivery-2026-09-02/api-samples.json) contain full submission, list, rejection and validation examples from an actual test run.

### Settings endpoint

`GET /settings/`: any authenticated user; global singleton; no employee ownership or company-specific values; no body/query required. 200 `S(Settings)`. There is no object-not-found case because `get_solo()` creates/loads the singleton. Wrong authentication returns 401.

`PUT /settings/`: SystemAdmin only; global update, company selector does not limit policy to a company. Existing required top-level objects remain mandatory; this is not PATCH. Unknown top-level fields return 422. If `attendance` is present, `geofence_enabled` remains required. New fields are optional. `late_grace_minutes` is 0–240; `work_week_days` is a nonempty list of up to seven integers 0–6, deduplicated/sorted on update. Time must parse as a time value. 200 returns full settings, 422 validation, 403 wrong role, 401 unauthenticated; no object 404. Updates emit `settings_updated` with before/after differences.

Example PUT body; GET/PUT success is `S(this object plus updated_at)`:

```json
{
  "password_policy":{"min_length":8,"require_upper":true,"require_lower":true,"require_number":true,"require_special":true},
  "session":{"timeout_minutes":30},
  "invites":{"default_expiry_hours":72},
  "security":{"max_login_attempts":5},
  "attendance":{"geofence_enabled":false,"work_day_start_time":"09:00","late_grace_minutes":15,"absence_detection_enabled":true,"work_week_days":[0,1,2,3,6]}
}
```

### Attendance endpoints affected by shared record serialization or action changes

Record schema `A` contains `id`, `employee_profile`, `employee_name`, `employee_name_en`, `employee_name_ar`, `employee_email` when available, `date`, `check_in_at`, `check_out_at`, `status`, `source`, `biotime_emp_code`, `biotime_terminal_sn`, manager/CEO decision timestamps/IDs/notes, `is_overridden`, `override_reason`, `notes`, `workflow`, `created_at`, `updated_at`, and the added `is_late_flagged:boolean`, `late_minutes:integer`.

Status values include `PENDING`, `PENDING_MGR`, `PENDING_HR`, `PENDING_CEO`, `PRESENT`, `LATE`, `ABSENT`, `REJECTED`. The Python enum member named `PENDING_MANAGER` serializes as **`PENDING_MGR`**. Source is `SYSTEM`, `EMPLOYEE`, or `HR`. Added fields are read-only. Minutes are whole minutes after the current grace cutoff; a check-in seconds after cutoff can be flagged late with zero minutes. Nonworking-day status is never classified late, but `late_minutes` itself does not check working weekdays. Historical minutes are not a frozen policy snapshot.

All routes below require authentication. `HR` means HRManager/SystemAdmin. `Self` means Employee/Manager/HRManager with a linked, nonarchived profile in the active company. `Manager` means SystemAdmin or recognized manager/delegate with report authority; manager scope uses `manager_scope_q`, including explicit cross-company attendance capability where granted. Ordinary role assignment alone does not confer report access. `CEO` means `IsDepartmentCEOApprover`.

| Method and route | Permission, payload/filter | Success and example | Validation / denial / missing record |
|---|---|---|---|
| `GET /api/attendance/` | HR, active company. `date` or `date_from/date_to`, `search`, profile-PK `employee_id`, `status`, `source`, ordering, pagination. Default last 30 days. | 200 `P(A[])` plus `data.summary` status counts. GET `?date=2026-09-01` → rows for that day with flags/minutes. | Invalid date/source filter 400; wrong role/scope 403; page 404; empty result 200. |
| `GET /api/attendance/{id}/` | HR, active company and queryset date filters. | 200 `S(A)`. GET `/api/attendance/9/` → record 9 with added fields. | 404 absent/out-of-scope/out-of-date-window record; 403 role/scope. |
| `GET /api/attendance/me/` | Self; caller's records. Same date/status/source filters, pagination. | 200 `P(A[])`. GET `?date=2026-09-01` → own rows only. | 403 disallowed role/scope; invalid date/source may produce empty rows here because this action does not surface list's filter-error response; page 404. |
| `POST /api/attendance/me/check-in/` | Self, 10/min throttle. Empty JSON when geofence disabled; GPS fields when enabled. Server chooses employee/date/time/status. | 201 `S({id,date,check_in_at,status})`. POST `{}` → pending manager/HR/CEO; added flag is stored but **not included** in this compact response. Refetch own list. | 400 duplicate; 404 no profile; 403 archived/company mismatch/disallowed role/outside site; 422 invalid/poor GPS; 429 throttle. |
| `POST /api/attendance/me/check-out/` | Self, same geofence/throttle; no new feature payload. | 200 `S({id,date,check_in_at,check_out_at,status})`. POST `{}` → server checkout timestamp. | 400 no check-in/already checked out; 404 no profile; same 401/403/422/429 rules. This route's code was not changed, but included to distinguish compact response from `A`. |
| `PUT /api/attendance/{id}/` | HR. Optional `check_in_at`, `check_out_at`, `status`, `notes`, `override_reason`; PUT routes to partial override logic. | 200 `S(A)`. PUT `{"status":"LATE","override_reason":"Verified arrival"}` → HR override. | 422 core change without reason, invalid field values, or pending CEO record originating from HR. 403 role/scope; 404 missing/invisible record. |
| `PATCH /api/attendance/{id}/` | Same as PUT. | 200 `S(A)`. PATCH `{"notes":"Reviewed"}` → updated record with added read fields. | Same as PUT. Flag is not recomputed by override. |
| `GET /api/manager/attendance/` | Manager report scope. Status/order/page filters. | 200 `P(A[])`. GET `?status=PENDING_MGR` → actionable report rows. | 403 no manager access/invalid selector; page 404; empty list 200. |
| `GET /api/manager/attendance/{id}/` | Manager report scope. | 200 **bare `A`**, inherited retrieve; example GET `/api/manager/attendance/9/` → `{id:9,...}`. | 404 missing/not in report scope; 403 role. Existing envelope deviation. |
| `POST /api/manager/attendance/{id}/approve/` | Manager actor capability; optional `{"notes":"Reviewed"}`. | 200 `S(A)`, `PENDING_MGR` → `PENDING_HR`. Example POST `/.../9/approve/` preserves late flag. | 422 wrong state; 403 actor cannot act; 404 outside queryset/missing. Notes have no dedicated serializer. |
| `POST /api/manager/attendance/{id}/reject/` | Same manager authority; nonempty `notes` required. | 200 `S(A)` with `REJECTED`. Example `{"notes":"Incorrect attendance"}`. | 422 empty notes/wrong state; 403 actor; 404 scope/missing. Message mentions comment but this action reads `notes`. |
| `GET /api/ceo/attendance/` | CEO, active company. Both `date_from` and `date_to` together, status, search, ordering, pagination. | 200 `P(A[])` plus summary. GET `?status=PENDING_CEO` → pending rows. | 403 role/scope; invalid parsed date range returns empty rows; invalid status may be 422 from filter backend; page 404. |
| `GET /api/ceo/attendance/{id}/` | CEO, active-company queryset. | 200 **bare `A`**, inherited retrieve. Example GET `/api/ceo/attendance/9/`. | 404 absent/invisible/filter mismatch; 403 role/scope. |
| `POST /api/ceo/attendance/{id}/approve/` | CEO; optional `notes`; disallows approval of own HR-origin record. | 200 `S(A)`, pending CEO → `LATE` if flag true, otherwise `PRESENT`. Example `{"notes":"Confirmed"}` → `S({id:9,status:"LATE",is_late_flagged:true,...})`. | 422 wrong state/self-approval; 403 role/scope; 404 missing/invisible. |
| `POST /api/ceo/attendance/{id}/reject/` | CEO; trimmed nonempty `notes`; same self-approval protection. | 200 `S(A)` with `REJECTED`. Example `{"notes":"Not confirmed"}`. | 422 empty notes/wrong state/self action; 403 role/scope; 404 absent/invisible. |

When geofencing is enabled, check-in/out body is, for example, `{"latitude":"24.713600","longitude":"46.675300","accuracy_meters":"10.00"}`. Latitude must be within -90–90, longitude -180–180, accuracy 0–100 metres, all finite and within serializer precision. The coordinates must fall inside an active work location for that employee's company. This example is not a guarantee that those coordinates match a configured site.

No new direct attendance-create/delete API: existing direct POST/DELETE remain 405. Correction APIs and BioTime routes keep existing request contracts; BioTime ingestion calls the changed classification service. They are covered by regression tests rather than presented as new endpoint contracts.

### Pending inbox, templates, PDF and email-only endpoint changes

| Method and exact route | Authentication, permission/scope and request | Success / example | Validation, permission and not-found behavior |
|---|---|---|---|
| `GET /api/core/pending-requests/` | Authenticated; only caller's actionable workflows within active company. Query `request_type=CONTRACT_DECISION`, `search`, page/page_size (max 100). | 200 `P(InboxItem[])`. Item fields: `id,workflow_id,name,request_type,request_type_label,action,details,time,avatar,review_path,current_approver_role,company_name`. Example `request_type:"CONTRACT_DECISION"`, review path `/ceo/contract-decisions/7`. | 401 unauthenticated, 403 invalid scope, 404 invalid page; unknown type returns empty. Shared endpoint gains a type, not a new method. |
| `GET /api/core/templates/` | Authenticated HR/Admin. Global static catalog; no employee/tenant data; no payload. | 200 `S({items:[Template],count})`. New key `annual_entitlements_disbursement`. Fields: `key,category,filename,title_en,title_ar,description_en,description_ar,available,updated_at`. | 401/403; no object 404. Missing individual files have `available:false`. |
| `GET /api/core/templates/annual_entitlements_disbursement/download/` | Authenticated HR/Admin, global blank form; no body or upload. | 200 PDF bytes, `application/pdf`, attachment filename `annual_entitlements_disbursement_blank.pdf`. Example GET this path → `%PDF-...` binary. | 401/403; 404 unavailable file or unknown catalog key; no new payload validation. |
| `GET /api/core/templates/loan_request/download/` | Same global blank-form rules. | 200 attachment PDF with revised artwork, filename `loan_request_blank.pdf`. | Same 401/403/404 rules. Optional existing PDF-password behavior is not changed/certified by this feature. |
| `GET /api/loans/loan-requests/{id}/pdf/` | Authenticated. Active loan, company/access queryset. **Intended owner-or-HR check is ineffective because custom `get_permissions()` ignores the action decorator. See F1.** No body. | 200 generated PDF; `application/octet-stream`, attachment, private no-store and nosniff, download audit. GET `/api/loans/loan-requests/5/pdf/` → binary. | 401; 403 invalid scope; 404 missing/out-of-scope/inactive. Same-company unrelated caller incorrectly receives 200. Rendering errors may return 500. |
| `GET /api/loans/hr/loan-requests/{id}/pdf/` | Alias of the same view/action, including the permission defect. | Same PDF bytes/headers; example `/api/loans/hr/loan-requests/5/pdf/`. | Same error/security behavior; alias is not a stronger HR permission boundary. |
| `POST /users/{user_id}/reset-password/` | Authenticated SystemAdmin; global user lookup, no tenant restriction. Body `{"mode":"temporary_password"}` or `{"mode":"reset_link"}`. Only email rendering changed. | 200 `S({mode,message:"Password reset processed."})`. Example reset-link body returns processed acknowledgment without reset material. | 422 invalid mode, 403 wrong role, 401 unauthenticated, 404 nonexistent user. Success acknowledgment is not external delivery confirmation. No live reset/send was performed. |

Shared notification changes also affect existing invite, leave, announcement/meeting, delegation and job-offer operations. Their route/payload/JSON contracts were not changed by the email-template refactor. This report certifies neither every unrelated producer endpoint nor live email-client rendering. The security finding is in the shared meeting renderer, reached from announcement notification processing.

## 5. Security review

| Control | Assessment and evidence |
|---|---|
| Server-side authorization | Present for new contract APIs: HR/Admin submission; CEO identity plus workflow permission for decisions; filtered querysets for reads. Existing feature test `test_contract_decision_api_enforces_roles_and_ceo_approval` passed. **Not a blanket pass:** loan PDF effective permission defect F1. |
| Employee ownership | Attendance check-in/out takes profile from `request.user`; contract decisions are reviewer-only, not employee self-service. Anonymous/employee contract probe verifies 401, empty list, 404 detail and 403 submission. Loan PDF owner check fails F1. |
| Company isolation | Contract list/detail/actions use active-company querysets; supplied employee/company/actor fields do not override server ownership. Existing foreign-company submission test passed. Additional company-selection probe results are recorded in section 6. Global schedule/catalog/admin-user operations are explicit exceptions. Manager attendance uses separate delegated-report capability scoping; do not assume a universal raw company filter. |
| IDOR protection | Contract lookup is scoped before service mutation. Missing/inaccessible IDs return 404 or invalid-selector 403. **Fails for same-company loan PDF:** unrelated employee receives 200 in F1. PDF generation was mocked solely to isolate authorization; no real employee PDF was accessed. |
| Private storage/downloads | No new upload field. Existing `PrivateUploadStorage` configures the private root; protection depends on authenticated download views and not serving that directory publicly. The class itself does not override URL generation. Loan PDF is generated on demand and returned as attachment with private/no-store/nosniff headers; headers do not fix missing authorization. New blank template is non-personal global content, served as `application/pdf`. Production bucket/volume/edge configuration was not inspected. |
| MIME/extension/size/content checks | Not applicable to new contract/settings JSON endpoints. Existing employee document serializer checks PDF/JPEG/PNG extension, size (default 5 MiB), claimed MIME when supplied, and leading signature. These are preserved source controls, not malware/full-document scanning. No new upload validation implementation is claimed; regression evidence must be read with its actual test results. |
| Audit logging | Settings and attendance actions call `audit`; absence has one summary audit per completed working-day run. Contract submit creates workflow-transition audit; approvals/rejections/auto-renewals have explicit audits. **Incomplete on resubmission:** F6 loses repeated HR workflow event/audit due fixed legacy signature. Auto-renew failure/manual branches also lack a dedicated explicit domain audit; persisted state alone is not full audit proof. |
| Sensitive exposure | Contract term snapshots expose salary to authorized HR/CEO reviewers; workflow history exposes actor email/name. Notification summary removes provider details. Loan PDF leaks sensitive content to same-company nonowners (F1). Email rendering accepts raw injected HTML from a URL (F2). No live secrets, production records, provider calls or user messages were used. |
| Concurrency | New manager/CEO attendance actions and contract services use transactions/row locks, including `of=("self",)` for nullable employee-user joins. This is source evidence, not a concurrent-execution stress test. Scheduler reminders do not recheck reminder time after locking; overlap can produce extra reminders. Default Django cache is process-local unless configured, weakening multi-worker absence overlap guard. |

The repository's zero-security-regression rule prevents accepting F2. F1 is pre-existing in the reviewed PDF route, but remains a release risk exposed by this delivery review. No security approval is inferred from passing ordinary workflow tests.

## 6. Testing evidence

All commands ran from `D:\HR-FFI-SYSTEM`, with each block executed in a fresh PowerShell process (review flags do not carry between blocks). Commands below use the attached [isolated runner](../output/backend-delivery-2026-09-02/run_verification.py); it changes into `Backend`, prevents `.env` loading, uses temporary private/media storage and in-memory email/cache/channel infrastructure, blocks external Python socket connections, and points database connections only at the disposable PostgreSQL instance. The initial guard blocked loopback too; T11 corrects that test-harness defect. No production or existing development database was migrated.

Runtime: Windows; Python 3.13.3; installed Django 6.0.2; DRF 3.16.1; pytest 9.0.3; pytest-django 4.12.0; psycopg2-binary 2.9.11; Docker image `postgres:16-alpine`. This differs from repository context describing Django 5.2; `requirements.txt` allows `Django>=5.0`. Deployment-version equivalence is unverified.

Provisioning command:

```powershell
docker run --rm -d --name ffi-delivery-review-20260902 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=ffi_delivery_review -p 127.0.0.1:55439:5432 postgres:16-alpine
```

This is a temporary loopback-only fixture database. Readiness initially returned no response during startup and subsequently passed. It is removed at the end of review. Application security settings are not changed.

For brevity, the repeated executable prefix in the following exact commands is unchanged; PowerShell output redirection simply stored each named log.

**T1 — Initial focused SQLite attempt**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest attendance/test_schedule_absence.py employees/test_contract_expiry.py -q --create-db --junitxml=../output/backend-delivery-2026-09-02/focused.xml
```
Result: Exit 1; setup failed on PostgreSQL-only `DO` SQL; 26 errors in 8.68 seconds.  
Passed: 0.  
Failed: 0 assertion failures; **26 setup errors**, no feature bodies executed.  
Evidence: [focused.log](../output/backend-delivery-2026-09-02/focused.log), [JUnit](../output/backend-delivery-2026-09-02/focused.xml).

**T2 — Focused feature, permission and tenant tests on PostgreSQL**

Command:
```powershell
$env:FFI_REVIEW_POSTGRES='1'
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest attendance/test_schedule_absence.py employees/test_contract_expiry.py -q --create-db --junitxml=../output/backend-delivery-2026-09-02/focused-postgres.xml
```
Result: Exit 0; 26 passed in 51.92 seconds, normal configured password hasher.  
Passed: 26 (12 attendance, 14 contract).  
Failed: 0.  
Evidence: [focused-postgres.log](../output/backend-delivery-2026-09-02/focused-postgres.log), [JUnit](../output/backend-delivery-2026-09-02/focused-postgres.xml).

This includes late/on-time/nonworking-day classification, ingestion, absence exclusions/idempotency/audit, milestone persistence/retry, CEO reminders, approval/auto-approval/renewal, stale snapshot/manual state, final-notification retry, basic termination, one API role scenario and one cross-company submission rejection. It does not test mapped termination, malicious term bounds, concurrent workers or external delivery.

**T3 — Full suite attempt with normal password hashing, incomplete**

Command:
```powershell
$env:FFI_REVIEW_POSTGRES='1'
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest -q -o 'python_files=tests.py test_*.py *_tests.py tests_*.py' --junitxml=../output/backend-delivery-2026-09-02/full-postgres.xml
```
Result: Stopped during execution after prolonged fixture hashing; progress reached at least 32% and displayed a failure marker. No final JUnit/summary; **not a passing full-suite result**.  
Passed: Not finalized.  
Failed: At least one marker; no reliable final count.  
Evidence: [partial log](../output/backend-delivery-2026-09-02/full-postgres.log).

**T4 — Full backend/regression suite with a test-only fast hasher**

Command:
```powershell
$env:FFI_REVIEW_POSTGRES='1'
$env:FFI_REVIEW_FAST_HASHER='1'
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest -q -o 'python_files=tests.py test_*.py *_tests.py tests_*.py' -o faulthandler_timeout=60 --junitxml=../output/backend-delivery-2026-09-02/full-postgres-fast.xml
```
Result: Exit 1; **594 passed, 39 failed**, 42 warnings, 27 additional passing subtests in 177.68 seconds.  
Passed: 594 tests plus 27 subtests.  
Failed: 39 tests; zero skipped.  
Evidence: [full log](../output/backend-delivery-2026-09-02/full-postgres-fast.log), [JUnit](../output/backend-delivery-2026-09-02/full-postgres-fast.xml).

Expanded discovery deliberately includes `tests_*.py`, which the repository's default `python_files` does not include. That ensures modified email/template tests and other regression files execute. The fast hasher is MD5 **inside this isolated test process only**; this run validates workflow/authentication logic, not production password hashing strength or cost. Providers are mocked/disabled; real email, WhatsApp, OCR, Redis workers, proxy behavior and browser rendering are not verified by it.

Failure breakdown (all node IDs/messages in [full-failure-summary.json](../output/backend-delivery-2026-09-02/full-failure-summary.json)):

| Count | Tests / observed failure | Classification |
|---:|---|---|
| 23 | `job_offers/tests/test_api.py::JobOfferApiTests`: setup creates company code `FFI`, already present from migration seed data; PostgreSQL unique violation. | Existing fixture/seed incompatibility; bodies not verified. Do not report these feature scenarios as passed. |
| 7 | `job_offers/tests/test_approval_workflow.py::JobOfferApprovalWorkflowTests`: mocks target removed `job_offers.notifications.EmailService`. | Direct test regression from the notification refactor; update mocks to the actual provider boundary and rerun CV/role/workflow tests. |
| 4 | `core/tests_messaging_providers.py::MessagingProviderTests`: database access from `SimpleTestCase`. | Test isolation mismatch; unresolved. Not established as introduced by this commit. |
| 1 | `core/tests_messaging_providers.py::PendingApprovalWhatsAppTests::test_pending_approval_uses_whatsapp_first_dispatcher`: expected one dispatch, observed zero. | Unresolved expectation/behavior mismatch; requires investigation. |
| 1 | `core/test_tenant_scope_contract.py::TenantScopeContractTests::test_hr_can_create_cross_company_manager_assignment_without_changing_direct_manager`: 422 invalid manager-profile PK instead of 201. | Unresolved cross-company assignment contract regression/expectation; outside newly added contract-decision API. |
| 3 | `in_app_notifications/tests.py::NotificationWebSocketDeferredTests`: Windows event loop's internal socket blocked by runner. | Harness-induced; all three pass after loopback correction in T11. This does not convert T4 into a passing full suite. |

After the targeted harness correction, **36 of the broad run's failures remain unresolved**. There was no second passing full-suite run. The XML reports 660 cases because it includes the 27 subtests; CLI reports 633 tests (594 + 39).

Security/regression coverage within T4 includes all 64 attendance tests, all 98 employee tests and all 24 account tests passing in this test configuration. The remaining 30 ordinary loan tests pass despite the new independent PDF-IDOR probe failing: their passing result does not prove owner enforcement. New contract cross-company submission is also covered by T2; the corrected independent scope probe passes in T5. Counts above are from JUnit and do not imply separately executed commands or measured code coverage.

**T5 — Independent review probes, definitive run**

Command:
```powershell
$env:FFI_REVIEW_POSTGRES='1'
$env:FFI_REVIEW_DB='ffi_delivery_probes'
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest ../output/backend-delivery-2026-09-02/test_delivery_review.py -q --junitxml=../output/backend-delivery-2026-09-02/review-probes-final.xml
```
Result: Exit 1; **3 passed, 8 failed** in 40.02 seconds, normal configured password hasher.  
Passed: 3 (anonymous/employee restrictions; CEO unauthorized-selector rejection plus admin active-company list/detail/action isolation; captured successful submit/list/reject and validation contract).  
Failed: 8 assertions across seven findings F1–F7.  
Evidence: [probe source](../output/backend-delivery-2026-09-02/test_delivery_review.py), [log](../output/backend-delivery-2026-09-02/review-probes-final.log), [JUnit](../output/backend-delivery-2026-09-02/review-probes-final.xml).

Review-fixture corrections and earlier attempts are retained, not counted as additional feature coverage:

- Initial probe command used the same file with `--create-db` and `--junitxml=../output/backend-delivery-2026-09-02/review-probes.xml`: **16 passed, 7 failed**, including 14 unintentionally rediscovered existing tests. Failures included incorrect fixture field `joining_date`, omitted renderer argument, and an invalid expectation that CEO organization-access entries expand their company access. Four contract defects were already reproduced; this was not the final probe result.
- Second command omitted `--create-db`, output `review-probes-v2.xml`: **2 passed, 9 failed**. A wrongly cased fixture node type (`COMPANY` instead of `company`) caused the tenant and absence tests to fail before meaningful assertions. The other seven failures reproduced implementation risks.
- A targeted command added `-k tenant`, output `tenant-probe-v3.xml`: **0 passed, 1 failed, 10 deselected** due the same invalid node-type fixture. Final fixtures use `OrganizationNode.NodeType.COMPANY`. These are review-harness mistakes, not evidence of a tenant leak.
- Original source snapshots/logs are included in the evidence bundle. The definitive T5 rerun uses corrected fixtures and excludes duplicate imported tests. There were no application fixes between these attempts.

Exact earlier probe commands, each with `$env:FFI_REVIEW_POSTGRES='1'` and `$env:FFI_REVIEW_DB='ffi_delivery_probes'` in a fresh process:

```powershell
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest ../output/backend-delivery-2026-09-02/test_delivery_review.py -q --create-db --junitxml=../output/backend-delivery-2026-09-02/review-probes.xml
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest ../output/backend-delivery-2026-09-02/test_delivery_review.py -q --junitxml=../output/backend-delivery-2026-09-02/review-probes-v2.xml
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest ../output/backend-delivery-2026-09-02/test_delivery_review.py -q -k tenant --junitxml=../output/backend-delivery-2026-09-02/tenant-probe-v3.xml
```

**T6 — Django system check**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py manage check
```
Result: Exit 0; `System check identified no issues (0 silenced).`  
Passed: System check.  
Failed: 0 check issues.  
Evidence: [check.log](../output/backend-delivery-2026-09-02/check.log).

**T7 — Migration drift**

Command:
```powershell
$env:FFI_REVIEW_POSTGRES='1'
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py manage makemigrations --check --dry-run
```
Result: Exit 0; `No changes detected`.  
Passed: Model/migration consistency.  
Failed: 0.  
Evidence: [migration-drift.log](../output/backend-delivery-2026-09-02/migration-drift.log).

**T8 — Fresh PostgreSQL migration chain**

Command:
```powershell
$env:FFI_REVIEW_POSTGRES='1'
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py manage migrate --noinput
```
Result: Exit 0; full chain applied to disposable `ffi_delivery_review`, including all six feature migrations.  
Passed: Six feature migrations plus prerequisite chain.  
Failed: 0.  
Evidence: [migrate-postgres.log](../output/backend-delivery-2026-09-02/migrate-postgres.log). Production-data upgrade and reversal not executed.

**T9 — Changed-Python-file lint**

Command:
```powershell
$reviewFiles = @(git diff --name-only --diff-filter=AM e64d280^ e64d280 -- Backend | Where-Object { $_ -like '*.py' })
& .\Backend\.venv\Scripts\ruff.exe check @reviewFiles
```
Result: Exit 1; three findings: import order in `attendance/test_schedule_absence.py` and `attendance/views.py`; unused `html.escape` in `in_app_notifications/dispatcher.py`.  
Passed: Not an all-pass lint result.  
Failed: 3 lint findings.  
Evidence: [ruff.log](../output/backend-delivery-2026-09-02/ruff.log). No automatic fixes applied.

**T10 — Route resolution**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py script output/backend-delivery-2026-09-02/route_inventory.py
```
Result: Exit 0; 31 example routes resolved to their Django view/action mappings.  
Passed: 31 resolutions.  
Failed: 0.  
Evidence: [route-inventory.json](../output/backend-delivery-2026-09-02/route-inventory.json). Resolution verifies paths, not authorization by itself.

**T11 — Windows event-loop/WebSocket tests after correcting the runner**

Command:
```powershell
$env:FFI_REVIEW_POSTGRES='1'
.\Backend\.venv\Scripts\python.exe output/backend-delivery-2026-09-02/run_verification.py pytest in_app_notifications/tests.py::NotificationWebSocketDeferredTests -q --junitxml=../output/backend-delivery-2026-09-02/websocket-rerun.xml
```
Result: Exit 0; loopback sockets allowed solely in review harness; external network remains blocked.  
Passed: 3 in 0.51 seconds.  
Failed: 0.  
Evidence: [websocket-rerun.log](../output/backend-delivery-2026-09-02/websocket-rerun.log), [JUnit](../output/backend-delivery-2026-09-02/websocket-rerun.xml). The three failures in T4 were not application defects.

Coverage percentage, type checking, full Ruff/format checks, pre-commit, frontend/browser tests, load tests and production smoke tests were not executed. No coverage percentage is inferred from test counts. No push occurred, so the pre-push gate was not exercised.

## 7. Frontend integration contract

The frontend should use the `/api/employees/.../contract-decisions/` family, `/api/core/pending-requests/`, `/api/attendance/...`, role-specific attendance routes and `/settings/` exactly as in section 4. Shared `apiClient` supplies authorization/company headers. Do not add a second `/api` prefix or use business `employee_id` where the URL requires employee-profile primary key.

Payload/response obligations:

- Submit only decision type, proposed dates/terms and HR comment. Approval/rejection uses `comment`; attendance decisions use `notes`. Settings PUT sends the existing required sections and optional new attendance fields.
- Read `data.items` for paginated lists. Existing manager/CEO attendance **detail** responses are bare records; do not assume every route uses the same envelope.
- Render salary strings/null, all eight contract statuses, original/proposed terms, automation reasons, failure reason and workflow permissions. HTTP 200 approval can mean manual resolution; show the returned state, not an unconditional approval-success message.
- `final_notification_sent_at` means notifications were persisted for recipients, not that WhatsApp/email providers delivered them. Use `notification_status[].deliveries[].status` (`pending/sent/failed/skipped`) for channel progress. External delivery happens later.
- Check-in response omits late fields; refetch the attendance timeline. Keep `LATE`, `ABSENT` and pending late flag separate. `late_minutes` is computed from current policy; it is not an immutable historical value.
- Contract/settings have no file upload. Download PDFs as authenticated blobs and honor `Content-Disposition`; never navigate to private URLs with tokens in query strings. New blank template appears in catalog when available.

Expected asynchronous states: HR pending; CEO pending with 48-hour deadline; channel delivery pending/retry; hourly scheduler-driven automatic transitions; daily absence creation, default 10:00 for yesterday after BioTime's morning sync. The automatic schedule is not an SLA and requires healthy beat/worker/broker. Disable repeat submissions while requests are pending, refetch after writes/company switching, and preserve useful error messages after 401/403/404/422/500 responses.

Frontend work still required/verified gap: `ContractDecisionsPage.tsx` enables HR submission only for `PENDING_HR`, while backend permits `MANUAL_RESOLUTION_REQUIRED`; manual resolution cannot be submitted from that screen. Its CEO success toast also assumes a successful approval action means approval, even when the backend returns manual resolution. No existing retry operation handles `AUTO_RENEWAL_FAILED` or a rejected cycle. The manager must agree a recovery contract before frontend invents one. Frontend build/tests were not run in this review.

## 8. Reliability assessment

Scores: 1 = serious blocker or little evidence; 3 = usable with significant gaps; 5 = fully verified for intended deployment. Scores apply to the reviewed delivery and are not organization-wide ratings.

| Dimension | Score / 5 | Evidence and limitation |
|---|---:|---|
| Correctness | 2 | 26 feature tests pass, but mapped termination, salary validation/total, and historical absence behavior fail independent checks. |
| Completeness | 2 | Main workflow and endpoints exist; task acceptance criteria missing, failure/rejection recovery incomplete, UI manual-resolution gap and incomplete repeated audit history. |
| Security | 1 | Confirmed PDF ownership bypass in changed route and new email HTML injection; cannot attest safe release. Basic contract role/scope protections exist. |
| Test coverage | 2 | Fresh feature and broad regression execution, plus independent probes; discovered meaningful omitted scenarios, no percentage measurement, concurrency/deployment gaps. |
| API stability | 3 | Additive routes/fields and preserved paths; exact contracts reviewed. Mixed detail envelopes, numeric-validation holes, unbounded general page size and changing historical minutes reduce predictability. |
| Maintainability | 3 | Domain service and serializers separate responsibilities; workflow adapters reuse existing engine. Fixed-signature history bug, broad exception handling, missing dependency pins and three lint findings remain. |
| Production readiness | 1 | Security/correctness fixes outstanding; actual deployment versions/configuration, existing-data migrations, scheduler execution and external delivery unverified. |

## 9. Known problems

### Reproduced implementation findings

| ID | Severity / provenance | Finding, evidence and required follow-up |
|---|---|---|
| F1 | High security; pre-existing defect on a modified PDF path | Another employee in the same company receives **200** for a non-owned loan PDF. `LoanRequestViewSet.get_permissions()` falls through to `IsAuthenticated` for `pdf`, overriding the decorator's `IsOwnerOrHR`; object permission check therefore does not enforce ownership. Probe `test_other_employee_cannot_export_same_company_loan_pdf`. Fix effective permission dispatch and add owner/nonowner/role/company tests for both aliases. |
| F2 | High security; new regression | A URL accepted by Django URL validation containing a quote and harmless HTML marker becomes raw HTML in meeting email. `_join_links()` interpolates URL into markup, and generic template applies `safe`. Probe `test_valid_meeting_url_cannot_inject_email_markup` renders injected `<strong>` markup. This proves HTML injection, not successful script execution in a particular email client. Escape URL attributes/use safe formatting and test all raw-HTML helpers. |
| F3 | High correctness; new contract path | Approving termination of an employee with a BioTime mapping returns **500**. Contract termination archives directly without retiring the mapping, violating existing database guard. Probe `test_termination_with_biotime_mapping_completes`; archive endpoint already has a mapping-retirement flow. Reuse the established archive workflow and verify rollback/login/mapping/report relationships. |
| F4 | High validation/reliability; new | Contract submission accepts `Infinity` and values exceeding DecimalField capacity with **200**, leaving invalid proposed terms pending CEO. `_parse_term_values` only converts via `Decimal`, without finite/precision/range validation. Two probes fail expected 422. Align validation with persistence schema and validate sign/rounding policy; test finalization and automatic paths. |
| F5 | Medium data correctness; new | Renewing basic salary from 1000 to 1500 while allowances remain 100+200 leaves stored `total_salary=1300`, not 1800. Probe `test_renewal_updates_total_salary_with_changed_component`. Model only computes missing total and service saves selected fields. Establish whether total is derived or intentionally independent; current endpoint does not enforce consistency or explain the discrepancy. |
| F6 | Medium audit integrity; new integration with existing engine | Submit → stale approval/manual resolution → HR resubmission records only one HR workflow action. Fixed `legacy_signature:"hr"` is deduplicated across attempts; repeated CEO events have the analogous source risk. Probe `test_manual_resolution_resubmission_retains_both_hr_workflow_events` expected 2, got 1. Use event/attempt-specific immutable signatures and preserve all transition audits. |
| F7 | Medium attendance accuracy; new | Absence detection does not limit historical eligibility by `hire_date`. The corrected probe creates an employee hired 2026-01-06; detection creates an `ABSENT` row for 2026-01-05. Assertion expected no record, found one. Restrict eligibility by target-date employment history and define how archived/former employees should be treated in backfills. |

Two salary-validation assertions represent one root finding (F4); findings count is not the same as failing-test count. Reviewer fixture failures are explicitly excluded from this table.

Source pointers: F1 `Backend/loans/views.py:575` and `:880`; F2 `Backend/core/services/bird_email_service.py:682` plus `Backend/core/templates/emails/generic_notification.html`; F3/F5 `Backend/employees/contract_expiry.py:399`; F4 `Backend/employees/contract_expiry.py:290`; F6 `Backend/core/services/workflow_engine.py:1235` and signature deduplication in `sync_workflow`; F7 `Backend/attendance/absence.py:38`. The attached failing probes provide executable reproductions on synthetic records.

### Unverified assumptions, gaps and operational concerns

- Acceptance scope is inferred; no product confirmation of 48-hour automatic approval (including termination), automatic renewal date arithmetic, exact-day reminder windows, global schedule or default-enabled absence marking. These are implemented behaviors, not approved policy claims.
- `AUTO_RENEWAL_FAILED` is rendered as requiring manual resolution but submission rejects that status. Rejected decisions cannot be reopened for the same expiry cycle. Manual resolution after changing expiry can create a different cycle instead of repairing the earlier row. Recovery and migration policy needs design and tests.
- Historical `is_late_flagged=False` defaults are not backfilled; `late_minutes` changes with current settings and can show positive values on nonworking days. HR corrections/overrides do not universally reconcile flag/status/minutes.
- Default cache is not a distributed lock. Multiple workers can overlap absence runs; a TTL/delete guard also needs ownership semantics. Contract reminder interval is checked before the row lock without a second time check. Concurrent approval/scheduler races were not exercised.
- Scheduler scans all active contract profiles hourly and materializes all absence-eligible profiles for each date. General `StandardPagination` has no maximum page size. Decision notification history is unbounded per decision. Performance at production volume is unmeasured.
- Contract scheduler pending queues do not repeat all original active-company/active-employee filters; moving/deactivating an employee/company after a decision is created needs tests. Snapshot checks cover contract dates/terms, not every lifecycle/tenant change.
- Exact 90/45/31/17-day checks miss reminders if the scheduler is unavailable throughout the matching day. Generic exception handling on automatic approval logs failure but does not consistently increment a dedicated auto-approval failure counter.
- `backfill_absences --dry-run` prints that each date is skipped; it does not calculate eligible/created counts or apply schedule preview logic. Actual backfill uses `force=True` and bypasses the absence-enabled toggle. Do not advertise the dry-run as a reliable impact preview.
- Shared email layout was not rendered in Gmail/Outlook or visually approved; meeting labels currently use HTML entities in escaped text, which can display literal `&amp;`/`&middot;`. Some Arabic contexts reuse English text. Global templates should be checked bilingually.
- Job-offer helper still sends email synchronously through the provider wrapper. The broader queued-notification contract does not prove every producer is asynchronous; timeout/latency behavior needs review.
- PostgreSQL 16, Redis/broker, separate Celery worker and beat, correct application timezone, appropriate absence hour/minute, reachable provider configuration and template assets are deployment requirements. Beat's process-presence health check does not verify task registration, dispatch, completion or provider delivery. No AWS/server configuration was changed or inspected.
- New schedule/migration defaults can change behavior immediately when a worker starts. Apply schema before starting updated backend/workers; agree rollout switches and backup/rollback procedure. Existing-data migration testing and production smoke checks remain outstanding.
- Installed Django is 6.0.2, whereas repository context says 5.2 and requirements are broad. Pin/confirm supported runtime and repeat required gates on the deployment image.
- Three lint findings remain. Default pytest discovery misses `tests_*.py`; the broad run explicitly expands it. Coverage, concurrency, full secret/permission surface audit and production configuration review are not complete.

## 10. Synchronization status

- **Is the frontend contract complete?** Documented from current backend for the scoped routes, but not integration-approved. There are explicit envelope/state/recovery differences, incomplete original feature requirements and a manual-resolution UI gap.
- **Breaking changes?** No public route removal or required new contract payload field. Existing employee prefixes/aliases remain. Behavioral changes include global default-enabled absence marking, late classification, automatic contract updates/termination, changed PDF/email assets, and removed internal template names. These require release notes and product approval; they are not harmless merely because fields are additive.
- **Could frontend work proceed safely?** Contract mapping and UI/error-state work can proceed using fixtures and this document. Do not approve production integration/release of sensitive PDF or contract mutation workflows until the reproduced blockers are fixed and retested.
- **What must the manager verify?** Confirm task/feature scope and acceptance criteria; resolve F1–F7; agree recovery/self-approval/automatic-action policies; check both backend and frontend response handling, roles, company switching, pagination, manual-resolution states, timestamps, audit history and blob downloads; run frontend tests and deployment-image regressions; inspect actual PDF/email rendering; rehearse migrations and scheduled jobs.
- **Next recommended action:** Assign fixes with owners and focused regression tests, then rerun failed probes and required backend/frontend gates on the intended deployment runtime. Update the route matrix/spec with the verified contract and deviations before sign-off.

## 11. Final recommendation

**RETURN FOR FIXES.** Existing happy-path evidence does not outweigh confirmed authorization, email-rendering, contract correctness and audit defects. Acceptance requires fixes plus successful reruns of the relevant failed tests, documented resolution of remaining regressions, confirmed feature scope and frontend/deployment integration verification. No completion or production-readiness claim is made.

Evidence is local under `output/backend-delivery-2026-09-02/` (git-ignored). Preserve or attach the evidence bundle to the delivery ticket; a repository link alone will not publish ignored logs. Report source changes are limited to this document; reproduction scripts live in that evidence directory.
