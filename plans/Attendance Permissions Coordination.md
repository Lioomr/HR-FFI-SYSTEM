# Attendance Permissions Coordination

## Foundation ownership

Backend Agent 1 owns the attendance/BioTime foundation: immutable punch ingestion,
normalization, daily calculation primitives, global attendance-policy settings, and
the employee attendance exemption flag. This work intentionally does not create
Late Permission requests, payroll deductions, or frontend behavior.

## Integration boundaries

- Raw BioTime data is append-only. `BioTimeRawPunch` is the source of truth; its
  provider payload and provider identifier are retained for audit/replay.
- `NormalizedAttendanceEvent` is a deterministic, replaceable projection of a raw
  punch. It never changes the raw punch.
- `AttendanceDailyResult` is the calculated daily projection. Future permission
  workflow work supplies approved minutes through the calculation service rather
  than rewriting punch rows.
- Existing `AttendanceRecord` data remains available to existing clients and HR
  override/Exit Permission compatibility paths. New foundation code must not modify
  legacy rows.
- Policy is global (`SystemSettings` singleton), not company- or employee-specific.

## Handoff rules

Backend Agent 2 may add permission-request models and pass approved durations into
the calculation service. Backend Agent 3 owns final API endpoints and serializers
for today summaries and HR recalculation. Neither should change raw-punch identity
or the normalized event semantics without a migration and a coordination update.

## Backend Agent 1 report

### Delivered foundation

- Models: `attendance.BioTimeRawPunch` (append-only source evidence),
  `attendance.NormalizedAttendanceEvent` (one deterministic event per raw
  punch), `attendance.AttendanceAdjustment` (future approved-time input), and
  `attendance.AttendanceDailyResult` (final daily calculation). Existing
  `AttendanceRecord` remains public/compatible and has a marker only for
  compatibility rows created after this foundation.
- Entry points: `SyncBioTimeService.ingest_transactions()` persists raw evidence
  and calls `AttendanceCalculationService.recalculate(employee_profile, date)`.
  Pure DTO primitives are `resolve_shift()`, `normalize_raw_punches()`, and
  `calculate_daily_attendance()` in `Backend/attendance/calculation.py`.
- Deduplication key: SHA-256 of `provider:{emp_code}:{provider id}` when a
  vendor ID exists. Otherwise it is SHA-256 of canonical JSON containing the
  employee code, UTC punch timestamp, raw punch type, and terminal serial.
- Semantics: reliable BioTime states `0/1/2/3` map to Check In/Check Out/Break
  Out/Break In. Untyped sequences use first=Check In, last=Check Out, with
  interior events alternating break out/in. An unmatched Break Out is a final
  departure when no later Break In occurs before shift end. Raw evidence is
  never changed.
- Global policy: `SystemSettings` now exposes default shift end (18:00), grace
  window and monthly use limit, post-grace tolerance, approved Late Permission
  monthly limit, During Shift maximum duration, and request advance limit. It
  remains global, not tenant- or employee-specific.
- Exemption: `EmployeeProfile.attendance_exempt` is writeable through the
  existing HR/System Admin employee endpoint and included in its generic audit
  before/after snapshot. `is_attendance_exempt(profile)` also recognizes a CEO
  group automatically, without name matching.

### Migration compatibility

Apply `admin_portal.0004`, `employees.0025`, and `attendance.0013` together.
New tables are additive. Existing `AttendanceRecord` rows are neither deleted
nor updated by ingestion; the marker defaults false. Only compatibility rows
created by this foundation can have their projected check-in/out refreshed.

### Verification

- `python -m ruff check attendance admin_portal employees` - passed.
- `python manage.py check` with the SQLite fallback - passed.
- `python manage.py makemigrations --check --dry-run` with the SQLite fallback
  - passed, no changes detected.
- Direct calculation-primitives validation (normal typed break and unreturned
  Break Out cases) - passed.
- `python manage.py test attendance.test_calculation_foundation` could not run:
  the repository's pre-existing `employees.0015_database_tenant_integrity`
  migration emits PostgreSQL SQL that SQLite rejects near `DO`, before these
  tests are installed. The configured PostgreSQL connection has no local
  password in this environment. The focused test file is included for CI or a
  configured PostgreSQL test database.

### Correction report - grace policy and authorization

Changed paths:

- `Backend/attendance/calculation.py` and `Backend/attendance/schedule.py`
- `Backend/admin_portal/models.py`, `serializers_settings.py`, and
  `views_settings.py`
- `Backend/admin_portal/migrations/0004_systemsettings_approved_late_permission_limit_per_month_and_more.py`
- `Backend/attendance/test_calculation_foundation.py` and
  `Backend/admin_portal/test_attendance_policy_settings.py`

`grace_window_minutes` is now canonical. The legacy
`late_grace_minutes` request/response field remains supported and is
synchronized in both API and ORM saves; the migration preserves existing legacy
values when it introduces the canonical field. Legacy schedule classification
reads the canonical value. Foundation late classification now stops at the full
grace window only: 09:16 after a 09:00 start and 15-minute grace is `LATE`.
The five-minute post-grace tolerance is reserved for Backend Agent 3 after
monthly grace exhaustion, which this foundation does not evaluate.

HR Manager and System Admin can `PUT /settings/` with an attendance-only body.
An HR Manager cannot update password, session, security, or invite settings;
System Admin keeps the existing full-settings capability. Settings remain one
global singleton, so the active-company header does not select a tenant policy.

Added regression coverage includes the 09:16 grace boundary, canonical/legacy
grace synchronization, HR Manager success, System Admin success, employee
denial, HR denial for unrelated settings, and global singleton behavior with an
active-company header.

Correction verification evidence:

- `Backend/.venv/Scripts/python.exe -m ruff check attendance admin_portal employees`
  - passed.
- With `DB_ENGINE=django.db.backends.sqlite3`, `python manage.py check` and
  `python manage.py makemigrations --check --dry-run` - both passed.
- A direct Django-shell check of 09:16 against a 15-minute grace plus a
  five-minute post-grace field returned `LATE`; serializer validation of the
  legacy alias populated `grace_window_minutes` - passed.
- `Backend/.venv/Scripts/python.exe manage.py test attendance.test_calculation_foundation admin_portal.test_attendance_policy_settings --verbosity 1`
  - did not execute the 14 discovered tests because the configured PostgreSQL
  connection at `localhost:5432` has no password in this environment.
- Retrying that exact suite with the SQLite fallback also did not execute tests:
  the repository's existing `employees.0015_database_tenant_integrity`
  migration fails before test installation with `sqlite3.OperationalError: near
  "DO": syntax error`.

Accordingly, the new database-backed calculation, settings authorization, and
company-header regression tests are unverified locally, not passed. The Agent 2
contract is ready, but no handoff has been performed.

## Backend Agent 2 report

### Delivered

- `permission_requests` now supports backward-compatible `exit`, `late`, and
  `during_shift` request types. Legacy rows/payloads default to `exit`; Exit
  date, duration, approval chain, routes, and PDF behavior remain intact.
- Late requests require private PDF/image evidence, reject attendance-exempt and
  CEO profiles, observe the global date and final-approved monthly limits, and
  have no employee-entered interval. During Shift requests use the global date
  and duration policy. Exit/During Shift conflict only on overlapping active
  intervals; Late coexists with either.
- Private `PermissionRequestAttachment` evidence has authenticated forced
  download, no public URL, tenant/visibility authorization, no-store headers,
  MIME/10 MB validation, camera metadata, and audit events.
- Final approval upserts source-keyed `AttendanceAdjustment` rows and schedules
  calculation after commit. No raw BioTime punch is written or changed.

### Changed paths and migration order

- `Backend/permission_requests/{models,serializers,services,views}.py`
- `Backend/permission_requests/migrations/0002_permissionrequestattachment_and_more.py`
- `Backend/attendance/models.py` and
  `Backend/attendance/migrations/0014_attendanceadjustment_effective_date_and_more.py`
- `Backend/config/settings.py`
- `Backend/permission_requests/tests/test_attendance_permissions.py` plus
  updated overlap expectations in `test_submission.py`
- `plans/Attendance Permissions API Contract.md`

Apply Agent 1 migrations first (`admin_portal.0004`, `employees.0025`,
`attendance.0013`), then `attendance.0014` and
`permission_requests.0002`. The adjustment uses a string source key instead of
a foreign key to avoid a cross-app migration cycle.

### Verification and handoff to Backend Agent 3

- Ruff passed for `permission_requests`, `attendance`, and `config`.
- `python manage.py check` passed; `makemigrations --check --dry-run` reports no
  changes (with only the known local PostgreSQL-password warning).
- `python -m pytest permission_requests -q` could not create the test database:
  local PostgreSQL at `localhost:5432` requires a password. Run
  `DB_PASSWORD=<configured-password> python -m pytest permission_requests -q`
  from `Backend/` in CI or a configured PostgreSQL environment.
- If using the local SQLite fallback, expect the already-known blocker in
  `employees.0015_database_tenant_integrity` (`near "DO": syntax error`), so
  run PostgreSQL-backed tests rather than treating SQLite failures as feature
  failures.

Agent 3 should consume `AttendanceAdjustment.kind`, `source_key`,
`effective_date`, `start_time`, `end_time`, and `approved_minutes` in summary
and payroll consequences. Do not reinterpret or mutate raw punches. A Late
Permission is always a zero-minute arrival-excusal marker; Agent 3 must evaluate
it against the current normalized check-in during final attendance enforcement.

## Backend Agent 2 correction report - final-limit and Late-marker review

### Corrections

- Final Late-limit enforcement now locks the employee profile before the status
  transition and excludes the request being finalized from the final-approved
  monthly count. The first through third approvals succeed; a fourth pending
  request is rejected at final approval. The same rule covers HR final approval
  and manager-final approval when the requester is an HR approver.
- Late adjustments are durable, source-keyed zero-minute arrival-excusal
  markers. They never derive approved minutes from raw punches. Recalculation
  leaves the marker intact after later BioTime ingestion; Backend Agent 3 uses it
  with the current normalized check-in during final attendance enforcement.
- During Shift remains interval/duration based. Exit remains metadata-only with
  zero minutes unless a later Agent 3 policy explicitly consumes it.
- Restored the applied `attendance.0011_attendancerecord_is_late_flagged`
  migration exactly to its original content. `permission_requests.0002` now
  depends on `attendance.0014`, enforcing the documented integration order in
  Django's migration graph.

### Regression coverage

Added focused tests for third/fourth Late approvals at both HR-final and
manager-final paths, plus a future approved Late marker that remains zero after
later raw-punch ingestion and recalculation. Existing rejected/cancelled
non-consumption coverage remains in place.

### Verification and Agent 3 readiness

Ruff, compile checks, Django system check, and migration-drift check pass.
PostgreSQL-backed tests remain unrun locally because `localhost:5432` requires a
password; the SQLite fallback remains blocked by the pre-existing
`employees.0015_database_tenant_integrity` PostgreSQL `DO` statement. The
correction is ready for Agent 3 consumption once PostgreSQL tests pass, but no
handoff has been made, per instruction.

## Backend Agent 3 handoff report - final policy, payroll, and APIs

### Delivered

- Added a deterministic, employee-locked calendar-month grace reconciliation
  ledger and an auditable one-per-employee/date late-violation ledger. The
  first three 09:01-09:15 arrivals consume grace; after exhaustion, 09:06 and
  later is late. A Late Permission marker excuses the date without consuming
  grace, and explicit/CEO exemption creates neither grace consumption nor a
  violation.
- Final calculation consumes only During Shift adjustment intervals. They are
  unioned, clamped to the scheduled shift, and discounted for physical-work
  overlap. Late markers remain permanently zero minutes through later BioTime
  ingestion; Exit stays zero-minute metadata.
- Violation penalties are durable: lifetime occurrence 1 is warning/zero,
  2 is 5% daily rate, 3 is 10%, and 4+ is 50%; daily rate snapshots monthly
  total salary divided by 30. Reconciled corrections/excusals void an open
  violation, while an already payroll-applied one becomes `manual_review`.
- Added pending/applied/manual-review attendance payroll-deduction claims.
  Payroll claims pending, due penalties only while creating a DRAFT run. A
  locked-period discovery carries forward to the next eligible draft. No
  completed/paid run or payslip is rewritten, and a later invalidation is
  surfaced as manual review rather than an automatic credit.
- Implemented today summary, bounded HR recalculation, and company-scoped
  violation history endpoints. Recalculation and violation/claim changes are
  audited. Existing notification infrastructure remains available to the
  workflow; this policy layer never allows notification failure to roll back
  attendance state.

### Additive migration order and readiness

Apply existing Agent 1 and Agent 2 migrations first, then
`attendance.0015_attendancegraceuse_attendancelateviolation`, followed by
`payroll.0005_attendancepayrolldeduction`. No applied migration, including
`attendance.0011_attendancerecord_is_late_flagged`, was changed.

Focused policy tests cover three grace uses followed by 09:06 late, zero-minute
Late-marker excusal, and overlapping During Shift interval unioning. Agent 3 is
ready for frontend consumption with the endpoint payloads in the API contract.
PostgreSQL database tests still require configured local/CI credentials;
SQLite remains blocked by the pre-existing PostgreSQL-only
`employees.0015_database_tenant_integrity` migration and must not be reported
as feature-test success.

## Backend Agent 3 correction report - scope, lifetime history, and payroll sync

The earlier Agent 3 readiness claim was premature: its PostgreSQL tests had
never run. Running them exposed the defects below in addition to the review
findings. All are corrected; the final contract lives in
`Attendance Permissions API Contract.md`.

### Corrections

- **Active-company scope.** `POST /api/attendance/hr/recalculate/` now calls
  `ensure_company_write_allowed` and resolves the profile through
  `filter_queryset_by_company_scope`. Head-office context and inaccessible
  companies return 403. Out-of-company profiles return 404 and nothing is
  calculated.
  - `GET /api/attendance/me/today-summary/` resolves the caller's single
    profile through the same scope helper.
  - Violation list and detail apply that helper to every role, so another
    company's or another employee's id is a 404.
  - `EmployeeProfile.user` is one-to-one, so "multiple company profiles" means
    a user granted several companies; that case is covered.
- **Durable lifetime history.** `AttendancePolicyService.reconcile_month`
  counts `active`, `applied`, and `manual_review` violations; `void` never
  counts.
  - An `applied` or `manual_review` violation is frozen: it still counts for
    later dates, but its occurrence, rate, and amount are never rewritten and it
    is never reactivated.
  - A later invalidation moves an `applied` violation and its deduction to
    `manual_review`.
  - Open violations keep their salary snapshot. Reconciliation re-sequences
    later months after delayed ingestion, and unchanged reruns write no
    violation or deduction rows.
- **Draft payroll sync.** New `payroll/services.py` provides
  `sync_attendance_deductions` and `finalize_attendance_deductions`.
  - Draft creation claims due pending deductions.
  - Finalization re-syncs, then marks claims and violations `applied` in the
    same transaction as the COMPLETED transition.
  - The run, affected employee profiles, deductions, items, and payslips are
    locked in the same profile-first order attendance reconciliation uses.
  - `claimed_amount` records what is inside item, payslip, and run totals, so
    claims, amount adjustments, and voided-claim releases change totals by the
    exact difference once. Repeated syncs are no-ops.
  - COMPLETED/PAID runs raise `PayrollRunNotDraftError` and are never
    modified.
  - Deduction statuses are now `pending`, `claimed`, `applied`,
    `manual_review`, and `void`.
- **Defects found by the first PostgreSQL run:**
  - `AttendanceLateViolationSerializer` declared a redundant
    `source="employee_profile_id"`, which DRF rejects. The today summary and
    violation history crashed whenever a violation existed. Removed; added a
    read-only `payroll_status`.
  - `attendance/violations` was registered after the `attendance` router, so
    `attendance/{pk}/` captured the violation list. It is now registered first,
    and violation detail returns the standard envelope.
  - `SyncBioTimeService.ingest_transactions` (Agent 1) read
    `employee_profile_id` from the profile objects in its mapping dict. Every
    ingestion with a punch crashed.
  - `PermissionRequestViewSet.get_parsers` (Agent 2) read `self.action` before
    DRF assigns it. Every permission-request API call errored.
  - The Agent 1 compatibility `AttendanceRecord` projection dropped
    `biotime_terminal_sn`, which committed `HEAD` stored. It also refreshed a
    projection row even after its source changed from SYSTEM. It now stores the
    day's sorted, comma-joined terminal serials and refreshes only SYSTEM
    projection rows.
- **Documentation.** The proposed Agent 1 endpoint sections and the first Agent
  3 summary were replaced by one authoritative final contract. It covers
  envelopes, permissions, the active-company header, error behavior, the grace
  reason values, the violation lifecycle, and payroll manual review.

### Migrations

Additive only: `payroll.0006_attendancepayrolldeduction_claim_state` adds
`claimed_amount` and the new status choices. `git status` shows no tracked
migration modified. `attendance.0015` and `payroll.0005` were not edited, and
neither is applied in the local development database.

### Regression coverage

- `attendance/test_policy_enforcement.py`:
  - grace and tolerance boundaries, Late-marker excusal, and exemption
  - penalty schedule
  - void and reactivation, and void rows excluded from sequencing
  - cross-month re-sequencing
  - raw-punch recalculation idempotency
  - During Shift union over real normalized punch intervals
- `attendance/test_policy_api.py`:
  - router resolution
  - HR recalculation success, cross-company 404, inaccessible-company 403,
    head-office 403, and role 403
  - HR and employee violation list/detail company isolation, including an
    employee granted two companies
  - today-summary serialization, other-company 404, and head-office 403
- `payroll/test_attendance_deductions.py`:
  - no double claim across repeated sync and repeated API finalize
  - a penalty added after draft creation is included at finalization
  - locked-period carry-forward, with no earlier-period claim
  - the review scenario: day one payroll-applied, then excused, stays
    `manual_review` at occurrence 1; a later late day is occurrence 2 at 5%
  - invalidating an applied deduction keeps locked totals
  - voided draft claim released once
  - re-sequenced claims adjusted by difference

### Verification

- Ruff: all changed Python files pass.
- `py_compile`: all changed modules pass.
- `manage.py check`: no issues.
- `manage.py makemigrations --check --dry-run`: no changes.
- `graphify update .`: graph rebuilt.
- Focused PostgreSQL run (isolated `test_ffi_hr_db_agent3`, command below): 60
  passed. The first run failed 27 tests because of the defects above.
  - Command: `DB_PASSWORD=postgres SECURE_SSL_REDIRECT=False DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver DB_NAME=ffi_hr_db_agent3 pytest attendance/test_policy_enforcement.py attendance/test_policy_api.py payroll/test_attendance_deductions.py attendance/test_calculation_foundation.py payroll/test_employee_payslip_security.py admin_portal/test_attendance_policy_settings.py permission_requests/tests/test_attendance_permissions.py`
  - Suites: new policy/API/payroll tests, attendance foundation, payslip
    security, policy settings, and permission-request attendance integration.
- Wider regression, PostgreSQL:
  - `permission_requests` (full suite): 103 passed.
  - `attendance payroll admin_portal loans core/test_route_contract.py`: 205
    passed, 5 failed. Two failures were the terminal-serial projection
    regression, fixed above.
  - After that fix, `attendance` (full suite) plus
    `payroll/test_attendance_deductions.py`: 113 passed, 3 failed.
- The 3 remaining failures predate this feature. The same tests fail on
  committed `HEAD 1a196c50` in a clean worktree:
  - `AbsenceDetectionEligibilityTests::test_absence_detection_only_creates_records_for_mapped_employees`
    creates an absence for an extra profile.
  - `BioTimeSyncTests::test_sync_creates_attendance_record_for_mapped_employee`
    and `test_sync_preserves_manual_record_and_updates_system_bounds` expect
    `PENDING_HR`. The second test also expects a legacy SYSTEM row to be
    rewritten, which contradicts Agent 1's documented never-rewrite rule.
  - These need an owner decision on the legacy expectations and were not
    changed here.

Backend Agent 3 is ready for frontend consumption against the final contract.
The three pre-existing legacy attendance test failures are tracked separately
and do not involve the policy, payroll, or scope code in this correction.

## Backend Agent 3 addendum - frontend-readiness gaps

Two gaps found while preparing the frontend handoff are closed. The API contract
is updated to match.

- **BioTime mapping gate.** `GET /api/attendance/me/today-summary/` now returns
  the standard 403 "Attendance is unavailable until your BioTime mapping is
  completed" response for a profile without an active BioTime mapping, the
  same as `GET /api/attendance/me/`.
  - No daily result is calculated for an ineligible employee.
  - The company check still runs first, so a wrong company remains a 404.
- **Violation names and filters.** Violation rows add `employee_code`,
  `employee_name`, `employee_name_en`, and `employee_name_ar`.
  - The list accepts validated `lifecycle` and `payroll_status`
    (comma-separated), `employee_profile_id`, `date_from`/`date_to`, and
    `search` (employee names or code).
  - Invalid values return 422 field errors.
  - Filters only narrow the existing role and active-company scope.

Verification:

- Ruff, `py_compile`, and `manage.py check` pass; `graphify update .` rebuilt.
- PostgreSQL run of `attendance/test_policy_api.py`,
  `attendance/test_policy_enforcement.py`,
  `payroll/test_attendance_deductions.py`, and
  `attendance/test_biotime_only_policy.py`: 52 passed, 1 failed.
  - The failure is the pre-existing `AbsenceDetectionEligibilityTests` failure,
    which also fails on committed `HEAD`.
  - New coverage: the unmapped summary 403 with no calculation; the
    wrong-company 404 precedence; every filter, including cross-company and
    employee-scope non-widening; and six invalid-filter 422 cases.
- **HR recalculation mapping gate (follow-up).**
  `POST /api/attendance/hr/recalculate/` now returns 422 with an
  `employee_profile_id` field error ("This employee has no active BioTime
  mapping.") for an in-company profile without an active mapping.
  - Nothing is calculated.
  - The company scope check runs first, so an other-company profile is still a
    404.
  - Ruff and `py_compile` pass; `attendance/test_policy_api.py` on PostgreSQL:
    12 passed.
- **Nested 422 error formatting (follow-up).** `core.responses.error` no longer
  turns nested serializer errors into a stringified Python dict under the
  parent field.
  - Nested errors flatten to dotted field paths such as
    `attendance.grace_window_minutes` and `items.1.quantity`. A nested
    `non_field_errors` uses its parent path.
  - The top-level `message` is the first real message.
  - Flat field errors, top-level `non_field_errors`, and contract-shaped lists
    keep their exact previous output.
  - The rule is documented in `plans/Global API Rules (v1).txt` and the API
    contract.
  - Ruff passes. PostgreSQL run: 133 passed. It covered the new
    `core/test_responses.py`, attendance-settings 422 regressions (out-of-range
    and alias mismatch), `admin_portal`, `core/tests.py`, `invites/tests.py`,
    `rents/tests.py`, `employees/tests_signature_api.py`, permission-request
    attendance tests, and `attendance/test_policy_api.py`.
  - Frontend note: `utils/formErrors.ts` maps `field` to a single-segment
    Ant Design name. A form that needs a nested error on its nested
    `Form.Item` must split the dotted path.

## Backend Agent 3 correction - warning-only first late occurrence

Agreed escalation rule: the first late violation is a warning only, with no
payroll deduction. Only monetary penalties (occurrence 2 onward) create or claim
`AttendancePayrollDeduction` rows.

This replaces the earlier behavior. The first occurrence used to create a
0.00 deduction that draft sync claimed and finalization applied. A later
excusal then became a payroll manual-review exception that still counted
toward escalation. It also replaces the earlier regression that expected a
payroll-applied warning to reach manual review.

### Corrections

- **Policy.** `attendance/policy.py` (`_sync_deduction` and
  `_remove_warning_deduction`):
  - A zero-amount violation never creates a deduction.
  - A violation renumbered from a penalty down to a warning loses its unlocked
    deduction. One renumbered up to occurrence 2 or higher gains one.
  - Payroll-frozen history now means a charged monetary penalty
    (`_is_payroll_locked`). A warning is never frozen: an excused warning
    voids normally, never becomes `manual_review`, and stops counting.
  - Warning violations remain `active` or `void` for lifetime sequencing and
    audit history.
- **Payroll.** `payroll/services.py`:
  - Draft sync only claims pending deductions with `amount > 0` and treats
    zero-amount rows as non-chargeable.
  - Finalization only applies claims with `amount > 0`.
- **Leftover zero-value rows from this worktree.**
  - A pending, unclaimed row is never claimed; the next reconciliation deletes
    it.
  - A zero row a draft still holds is released at the next sync. Its included
    amount was 0, so totals are unchanged. The row is removed at the next
    reconciliation.
  - A zero row inside a locked run is voided in place, changing no totals, or
    reused as pending if that violation later becomes monetary.
- **Unchanged:** monetary deductions, draft synchronization and exact-delta
  totals, locked-period carry-forward, and manual review for invalidated
  applied monetary penalties.
- **Contract:** the API contract states that warnings have no deduction and
  `payroll_status: null`, and that `active` warnings are never claimed.

### Regression coverage

- First occurrence: a violation exists with no `AttendancePayrollDeduction`,
  and serialized `payroll_status` is `null`. The API detail and today summary
  also assert `null`.
- A payroll run neither claims nor applies a warning. It stays `active` after
  finalization, and totals are unchanged.
- Second occurrence creates the pending 5% (5.00) deduction.
- Excusing an uncharged warning voids it with no manual-review audit, including
  after its period was finalized. The next late day is again only a warning.
- An applied monetary penalty that is later invalidated still becomes
  `manual_review`, keeps locked totals, and still counts. The next late day is
  occurrence 3 at 10%, and the next draft claims only that penalty.
- Leftover zero-value rows: a held claim is released with totals unchanged and
  then removed; a pending one is never claimed and then removed.
- Existing coverage updated for the new rule: renumbering removes and recreates
  deductions, raw-punch idempotency uses a monetary second occurrence,
  re-sequenced draft claims (one claim plus one adjustment), and API filters
  use a monetary excused violation for `payroll_status=void`.

### Verification

- Ruff and `py_compile` pass for every changed file.
- `manage.py check`: no issues. `manage.py makemigrations --check --dry-run`:
  no changes, and no migration was added or modified.
- Focused collection (`attendance/test_policy_enforcement.py`,
  `attendance/test_policy_api.py`, `payroll/test_attendance_deductions.py`):
  37 tests collected.
- `graphify update .`: graph rebuilt.
- PostgreSQL run: 66 passed, 6 subtests passed. Command:
  `DB_PASSWORD=postgres SECURE_SSL_REDIRECT=False DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver DB_NAME=ffi_hr_db_agent3 pytest attendance/test_policy_enforcement.py attendance/test_policy_api.py payroll/test_attendance_deductions.py attendance/test_calculation_foundation.py permission_requests/tests/test_attendance_permissions.py`
- Frontend follow-up: a warning's `payroll_status` is now `null`, so the
  `active` lifecycle label must not say "awaiting payroll" for an occurrence-1
  warning.

## Frontend completion note - warning-only attendance display

This closes the frontend follow-up above. A first-occurrence warning
(`penalty_amount` `"0.00"`, `payroll_status: null`, `lifecycle` `active`) no
longer reads as awaiting payroll.

- `violationLifecycleHint` in `FrontEnd/src/utils/attendancePolicy.ts` gives an
  `active` warning-only violation with a null `payroll_status` the meaning
  "Warning only — no payroll deduction" (Arabic: "إنذار فقط — دون خصم من
  الرواتب").
  - A monetary `active` violation keeps "Recorded, awaiting payroll".
  - Claimed, applied, void, and manual-review wording is unchanged.
- The hint is applied in:
  - `TodayAttendanceSummaryCard`: the violation notice's meaning line and its
    lifecycle-tag tooltip.
  - `AttendanceViolationsTable`: the lifecycle-tag tooltip in both views and
    the employee history "meaning" column. `MyAttendanceViolations` and
    `HrAttendanceViolationsPanel` both render this table.
- `PayrollStatusTag` with a null status now reads "No payroll deduction"
  (Arabic: "بدون خصم من الرواتب"), replacing "Not in payroll". A null status is
  never shown as pending.
- Tests:
  - The summary warning fixture uses `payroll_status: null`. The test asserts
    the warning and no-deduction wording, and the absence of "Recorded,
    awaiting payroll" and "Pending", in English and Arabic.
  - New `AttendanceViolationsTable.test.tsx` covers employee phone cards,
    desktop table rows, the HR lifecycle tooltip, and Arabic.
  - Utility tests cover the warning and every other lifecycle meaning.
- No backend, API, or company-context change. Permission, recalculation, and
  payroll screens are unchanged.

### Validation (run from `FrontEnd/`, 2026-09-14)

- `npx tsc -p tsconfig.app.json --noEmit`: exit 0.
- `npx vitest run src/components/attendance/TodayAttendanceSummaryCard.test.tsx src/components/attendance/AttendanceViolationsTable.test.tsx src/components/attendance/HrAttendanceViolationsPanel.test.tsx src/components/attendance/RecalculateAttendanceModal.test.tsx src/utils/attendancePolicy.test.ts src/i18n/translationParity.test.ts`:
  6 files passed, 53 tests passed.
- `npx prettier --check` on the 7 touched files (`attendancePolicy.ts`, its
  test, `AttendanceViolationsTable.tsx`, its test,
  `TodayAttendanceSummaryCard.tsx`, its test, `translations.ts`): all use
  Prettier code style. A prior `--write` reformatted the two component files.
- `npx eslint` on the same 7 files: exit 0, no findings.
- The full `npm run test`, `npm run lint`, and `npm run format:check` were not
  rerun for this change.

## Late-attendance notice PDF completion report (2026-09-14)

Implemented private, bilingual late-attendance notices for newly-created active policy violations. The four distinct rendered styles are informational, formal-caution, serious-warning, and critical-final. They map respectively to occurrence 1, 2, 3, and 4+, with the policy snapshots 0%, 5%, 10%, and 50% of the daily rate. The Level 1 PDF says `Warning only — no payroll deduction.` and does not describe payroll as pending.

Files added: `attendance/late_notices.py`, `attendance/test_late_notice_delivery.py`, `attendance/migrations/0016_attendancelatenotice.py`, and `organization/migrations/0003_organizationnode_logo.py`. The active company now has an optional private `logo` asset. A configured valid company logo is drawn; otherwise the PDF explicitly shows `Company logo`. Configure `OrganizationNode.logo` before production use to replace that placeholder.

Delivery uses the existing in-app notification dispatcher with an authenticated private download route and one violation-specific deduplication key. The existing Evolution WhatsApp attachment path now supports the notice PDF; the existing Bird email fallback receives the authenticated secure-link action. Generated, delivery-scheduled, and download events are audited. No legacy rows are backfilled and no finalized payroll totals or raw BioTime evidence are changed.

Validation results: `python manage.py check` exited 0; migration drift check reported `No changes detected` (with a local PostgreSQL authentication warning); Ruff passed for the new source, migration, and focused test files; and the in-memory PDF smoke test passed (91,748 bytes, including the signature and logo-placeholder text). The focused database suite could not start because local PostgreSQL at `localhost:5432` rejected the configured test connection due to no password being supplied. It therefore has no pass result in this workspace and must be rerun with the normal test database credentials. Ready for deployment-agent review.

## Frontend completion report - late-attendance notice viewing and download (2026-09-14)

Employees can list and download their own late-attendance notices on My
Attendance. HR can browse the active company's notice history in the HR
Attendance area. No backend files, PDF templates, field maps, notification
delivery, or deploy configuration were changed. There is no "send notice"
action; the backend issues and delivers notices automatically.

### What changed

- **Employee (My Attendance):** a new "Late attendance notices" card sits below
  the violation history.
  - Each notice shows its violation date, level tag and occurrence, reference,
    delivery status (with the server's delivery message), and a Download PDF
    button.
  - States: skeleton while loading, empty, 403 (no access in the selected
    company), 404 (no notices available), and a generic error that never shows
    server details on a 5xx. Stale responses are ignored.
- **HR (Attendance, new `?tab=notices` tab):** a company notice history with an
  employee column (name and code).
  - Filters live in the URL and are applied by the server: search, notice
    level, employee, and violation date range. 422 errors appear on the
    matching filter control.
  - It uses the same ResponsiveTable and filter layout as the violations tab.
    There is no client-side company filtering, and the CEO view gets no
    notice tab.
- **Level labels:**
  - 1 "Informational warning" / "تنبيه معلوماتي"
  - 2 "Formal caution" / "تنبيه رسمي"
  - 3 "Serious warning" / "إنذار جدي"
  - 4 "Critical final warning" / "إنذار نهائي حاسم"
  - Level 1 also reads "Warning only — no payroll deduction" (Arabic "إنذار
    فقط — دون خصم من الرواتب"). It never shows a percentage, pending, or
    awaiting-payroll wording.
- **Delivery labels:** `scheduled` "Delivery scheduled", `sent` "Sent",
  `failed` "Delivery failed", `skipped` "Not sent", and null "Not recorded",
  each with an Arabic label. Any other value is shown as the server sent it.
- **Download:** the PDF is fetched through `apiClient` as a blob and saved with
  the existing `downloadBlob`.
  - The filename is the server `filename` with any path removed, or
    `late_attendance_notice_<reference>.pdf`.
  - No `<a href>`, storage URL, or company header or parameter is ever built.
  - A 404 shows "This notice PDF is not available." and a 403 shows a
    no-access message; neither saves a file.
- **RTL:** references, employee names and codes, and server delivery messages
  are wrapped in `<bdi>`. Phone layouts use the existing card view.
- Existing violation, recalculation, payroll, and warning-only behavior is
  unchanged. The violations and today-summary suites still pass.

### Files changed (all under `FrontEnd/src/`)

- Added:
  - `components/attendance/AttendanceNoticesTable.tsx`
  - `components/attendance/MyAttendanceNotices.tsx` and its test
  - `components/attendance/HrAttendanceNoticesPanel.tsx` and its test
- Modified:
  - `types/attendancePolicy.ts`: `AttendanceLateNotice`,
    `AttendanceNoticeFilters`, `NOTICE_LEVELS`, `NOTICE_DELIVERY_STATUSES`
  - `utils/attendancePolicy.ts` and its test: level and delivery labels,
    Level 1 meaning, filename, list and download error classification, URL
    filters
  - `services/api/attendanceApi.ts` and its test: `getAttendanceNotices`,
    `getAttendanceNotice`, `downloadAttendanceNotice`, `toNoticeQueryParams`
  - `i18n/translations.ts`: `attendancePolicy.notices.*` and
    `attendancePolicy.hr.tabNotices`, in English and Arabic
  - `pages/employee/AttendancePage.tsx` and its test
  - `pages/shared/AttendancePreviewPage.tsx` and its test

### API contract used

This matches "Late-attendance notices (fixed frontend contract)" in
`Attendance Permissions API Contract.md`. It was also checked against the
current `AttendanceNoticeViewSet` and `AttendanceLateNoticeSerializer` source.

- `GET /api/attendance/notices/`
  - Envelope: `data.items`, `data.count`, `data.page`, `data.page_size`.
  - Employee: called with `page` and `page_size` only.
  - HR: optional `notice_level` (comma-separated 1-4), `employee_profile_id`,
    `date_from`, `date_to`, `search`, `page`, `page_size`.
- `GET /api/attendance/notices/{id}/`
- `GET /api/attendance/notices/{id}/download/`, requested with
  `responseType: "blob"`.
- Notice fields: `id`, `violation_id`, `employee_profile_id`,
  `employee_name`, `employee_code`, `violation_date`, `occurrence_number`,
  `notice_level`, `reference_number`, `issued_at`, `delivery_status`,
  `delivery_message`, `filename`.
- The active company comes only from `apiClient` (`X-Active-Company-Id`).

### Tests and checks (run from `FrontEnd/`)

- New coverage:
  - The employee sees only the mock notices the API returned, with no employee
    column and no company or employee parameters.
  - The employee downloads through `/api/attendance/notices/{id}/download/`
    with `responseType: "blob"`, `downloadBlob` receives that blob, and no
    `a[href]` is rendered.
  - HR sees every employee in the company-scoped response, with URL filters
    passed to the server.
  - All four levels are labelled in English and Arabic.
  - Level 1 shows the warning-only text and no pending, awaiting, or
    percentage wording.
  - States: empty, 403, 404, generic error, loading, a download 404, and 422
    on the HR filters.
  - Phone cards and desktop tables, and Arabic rendering.
- `npx tsc -p tsconfig.app.json --noEmit`: exit 0.
- `npx vitest run src/components/attendance/MyAttendanceNotices.test.tsx src/components/attendance/HrAttendanceNoticesPanel.test.tsx src/services/api/attendanceApi.test.ts src/utils/attendancePolicy.test.ts src/pages/employee/AttendancePage.test.tsx src/pages/shared/AttendancePreviewPage.test.tsx src/pages/shared/AttendancePreviewPage.ceo.test.tsx src/components/attendance/AttendanceViolationsTable.test.tsx src/components/attendance/HrAttendanceViolationsPanel.test.tsx src/components/attendance/TodayAttendanceSummaryCard.test.tsx src/components/attendance/RecalculateAttendanceModal.test.tsx src/i18n/translationParity.test.ts`:
  12 files passed, 121 tests passed.
  - The first run had one failure. A phone-card assertion ran before
    ResponsiveTable's breakpoint observer switched to cards. The test now waits
    for the card layout; the component was unchanged.
- `npx prettier --check` on the 15 touched files: all use Prettier code style.
  An earlier `--write` reformatted `utils/attendancePolicy.ts`,
  `HrAttendanceNoticesPanel.test.tsx`, and `AttendancePage.test.tsx`.
- `npx eslint` on the same 15 files: exit 0, no findings.
- The full `npm run test`, `npm run lint`, and `npm run format:check` were not
  rerun. Repo-wide debt reported earlier is outside these files: one lint error
  in `routes/routes.tsx`, and 15 unformatted files.

### Known blockers and risks

- **Not run against a live backend.** When this work started (07:41) the
  backend served only `GET /api/attendance/violations/{id}/notice/`.
  - The notice routes landed around 07:55, and the contract section was
    rewritten at 08:00, while this work was in progress.
  - The frontend was checked against that source and contract by reading
    them, not with a running server or a real PDF.
  - No backend test exercising `/api/attendance/notices/` was found when
    checked. The backend notice database suite has no pass result in this
    workspace (see the report above).
- **Delivery states narrowed.** The frontend delivery labels were reduced to the
  model's `scheduled`, `sent`, `failed`, `skipped`. If the backend adds a
  state, it shows as the raw value until a label is added.
- **English-only server text.** `delivery_message` is English, and it is shown
  as is in the Arabic UI, direction-isolated. `employee_name` has no Arabic
  variant. Localized text needs a backend change.
- **Missing PDF.** `filename` is `null` when no PDF is stored. The Download
  button still shows, and the resulting 404 shows "This notice PDF is not
  available."
- No screenshots were captured for this change.

Ready for manager verification

## Backend completion report - late-attendance notice workflow on approved templates (2026-09-14)

This report supersedes the backend "Late-attendance notice PDF completion report"
above. The earlier implementation drew the PDF directly with ReportLab and
printed unmapped values. It also served only
`GET /api/attendance/violations/{id}/notice/`, and its database tests never ran.
It was reworked in place. The frontend-facing contract is "Late-attendance
notices (fixed frontend contract)" in `Attendance Permissions API Contract.md`.
Do not rename those routes or fields without a coordination-note update.

### Delivered

- **Approved assets.** All four version-1 PDF/map pairs from
  `artifacts/late-attendance-notice/level-*` are copied byte-identically into
  `Backend/static/pdf_templates/`.
  - `.gitignore` now allows them to be committed; before this they were
    silently ignored.
  - Their SHA-256 digests are pinned in the tests.
  - The renderer refuses a pair whose `template`, `version`, or `style.level`
    does not match, or whose HR signature is not `auto_sign: false`.
- **Record.** `AttendanceLateNotice` is company-scoped with one row per
  violation (one-to-one). It stores:
  - `reference_number`, `level`, and `occurrence_number`
  - `template_name` and `template_version`
  - penalty snapshots and `company_logo_configured`
  - a private document, the notification, `delivery_status` and
    `delivery_message`, and `issued_at`
  - A check constraint keeps `level` within 1-4.
- **Issuance.** Issuance happens only when the policy creates a new active
  violation.
  - Levels: occurrence 1 is level 1 (0.00, no payroll deduction), 2 is level 2
    (5%), 3 is level 3 (10%), and every occurrence 4 or later is level 4 (50%,
    a separate notice each time).
  - Recalculation reuses the notice: no second PDF, notification, or audit
    event.
  - Nothing is issued for:
    - legacy `AttendanceRecord` rows
    - pre-existing violations (no backfill)
    - voided violations
    - exempt employees
    - Late Permission-excused days
- **Rendering.** Rendering uses only `core.pdf_forms.render_mapped_form` on the
  selected approved pair, with the backend's Arabic-capable TrueType font and
  private storage.
  - Only the mapped fields are filled: reference, issue timestamp, employee
    name, code, department and position, violation date, first check-in,
    scheduled start, and minutes late.
  - HR representative name and title stay blank, and the HR signature box stays
    blank.
  - Values outside the map raise an error.
- **Delivery.** Each notice creates one in-app notification (event
  `attendance.late_notice`, `action_url` `/employee/attendance`).
  - It carries bilingual catalog text identical to the map's preprinted level
    copy, and the existing configured WhatsApp/email delivery. The PDF is
    attached only through the private WhatsApp document path.
  - The notice notification replaces the plain late-violation notification. The
    plain one is sent only if no notice could be issued.
  - Rendering and delivery each run in a savepoint, so a failure never blocks
    attendance calculation.
- **Audit.** Every audit event carries IDs, level, and status only, never paths,
  URLs, tokens, or punch payloads:
  - `attendance_late_notice_generated` (includes `company_logo_configured`)
  - `attendance_late_notice_delivery_scheduled`, `_failed`, or `_skipped`
  - `attendance_late_notice_generation_failed`
  - `attendance_late_notice_downloaded`
- **API.** The notice endpoints are registered before the generic
  `attendance/{pk}/` route; the old violation-level route is removed:
  - `GET /api/attendance/notices/`: employee sees own notices, HR Manager and
    System Admin see the active company's; paginated `data.items`, `count`,
    `page`, `page_size`; validated filters `notice_level`,
    `employee_profile_id`, `date_from`, `date_to`, `search`
  - `GET /api/attendance/notices/{id}/`
  - `GET /api/attendance/notices/{id}/download/`: authorization-checked
    `FileResponse` attachment with `private, no-store` and `nosniff`
  - Items expose exactly `id`, `violation_id`, `employee_profile_id`,
    `employee_name`, `employee_code`, `violation_date`, `occurrence_number`,
    `notice_level`, `reference_number`, `issued_at`, `delivery_status`,
    `delivery_message`, and `filename`.

### Changed files

- New or rewritten:
  - `Backend/attendance/late_notices.py`
  - `Backend/attendance/test_late_notice_delivery.py` (17 tests)
  - `Backend/attendance/migrations/0016_attendancelatenotice.py`
  - `Backend/static/pdf_templates/late_attendance_level_{1,2,3,4}_blank.pdf`
  - `Backend/static/pdf_templates/late_attendance_level_{1,2,3,4}_blank_field_map.json`
- Modified:
  - `Backend/attendance/models.py`, `policy.py`, `serializers.py`, `views.py`,
    `urls.py`
  - `Backend/in_app_notifications/dispatcher.py` and `i18n.py`
  - `Backend/static/pdf_templates/README.md`
  - `.gitignore`
  - `plans/Attendance Permissions API Contract.md` and this document
- Kept from the earlier notice work:
  - `Backend/organization/models.py` (`OrganizationNode.logo`)
  - `Backend/organization/migrations/0003_organizationnode_logo.py`
- No frontend files were changed.

### Migrations

- `attendance.0016_attendancelatenotice` was regenerated for the reworked model.
  It replaces the earlier unapplied, untracked version of the same name.
- `organization.0003_organizationnode_logo` is unchanged.
- Neither migration is applied in the local development database. No applied
  migration changed.
- Any database that applied the earlier 0016 must be recreated. Test databases
  were created fresh.

### Verification

- **Ruff:** all changed backend files pass.
- **`manage.py check`:** no issues.
- **`manage.py makemigrations --check --dry-run`:** no changes detected.
- **Template integrity:** all eight backend copies match the artifact SHA-256
  digests.
- **PostgreSQL** (fresh `test_ffi_hr_db_notice`): 125 passed, 99 subtests
  passed.
  - Command: `DB_PASSWORD=postgres SECURE_SSL_REDIRECT=False DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver DB_NAME=ffi_hr_db_notice pytest attendance/test_late_notice_delivery.py attendance/test_policy_enforcement.py attendance/test_policy_api.py payroll/test_attendance_deductions.py in_app_notifications permission_requests/tests/test_attendance_permissions.py`
  - Two earlier runs failed two tests each; all four were test defects, now
    fixed:
    - an Arabic extraction-order assertion
    - a legacy-row reconcile date without a daily result
    - a font-name comparison
    - an exempt day re-reconciled after the exemption was removed
- **Notice tests cover:**
  - all four levels and their approved pairs
  - separate notices for occurrences 4 and 5
  - mapped-fields-only rendering and a blank HR signature
  - idempotency
  - exclusions (exempt, excused, voided, legacy record, pre-existing violation)
  - Arabic/English rendering with an embedded Arabic-capable font subset
  - company-logo configuration recording, with the artwork never covered
  - unchanged finalized payroll totals
  - notification, delivery-failure, render-failure, and inactive-user
    behaviour, and audit events without paths
  - route ordering
  - exact contract fields and company scope
  - validated filters
  - private download authorization for owner, coworker, same- and cross-company
    HR, System Admin, head office, and unauthenticated users
- **Visual QA:** one sample notice per level was rendered through the production
  renderer, rasterized at 1.5x with pypdfium2, and inspected. Level 2 used an
  Arabic name and department.
  - Approved artwork, level copy, and footer are preserved.
  - Reference and issue timestamp align with their lines.
  - The HR signature box is blank.
  - Arabic is shaped correctly.
  - The grid misalignment below was found.
- **`graphify update .`:** graph rebuilt.

### Blockers and known limitations

1. **Approved map alignment defect (release blocker).** In all four maps, the
   eight data-grid text boxes sit 12.4-16.1 pt (mean about 14 pt) above the
   grey value bars in the approved artwork. Values print on the row dividers
   instead of inside the bars.
   - This was measured by scanning the grey bars of each blank PDF against its
     map boxes.
   - The renderer draws exactly the approved coordinates and does not
     compensate.
   - Fixing it requires an approved version-2 map, for example `y` lowered by
     about 14 pt, reviewed against the artwork.
2. **Level 1 copy mismatch (asset issue).** The approved Level 1 artwork shows
   "This is an informational notice." / "هذا إشعار توعوي فقط.". It does not
   visibly print the required "Warning only - no payroll deduction." copy,
   although the map's `preprinted_content` declares it. The notification text
   does carry the required copy. An approved artwork amendment is needed.
3. **Unmapped values (not resolved).** The maps have no zones for occurrence
   number, reason, penalty percent/amount, or payroll status. These are not
   printed and require an approved layout amendment. Occurrence and level are
   available through the API.
4. **Company branding.** The approved artwork preprints the FFI logo, company
   name, and contact footer, and the maps have no company name or logo zone.
   - Notices for any other company therefore carry FFI branding, and no
     "Company logo" placeholder can be drawn without covering approved artwork.
   - `company_logo_configured` is recorded on the notice and in the generated
     audit event. `OrganizationNode.logo` is not rendered until a mapped logo
     zone is approved.
5. **HR representative name and title are blank.** No configured HR
   representative source exists. HR completes them with the manual signature.
6. **Immutable snapshots.** A notice keeps the level it was issued with. If
   delayed punch ingestion later renumbers occurrences, existing notices are not
   reissued.
7. **Raster preprinted copy.** The approved PDFs' preprinted copy is an image,
   so policy wording is verified through the map metadata, the catalog-equality
   test, and visual QA, not PDF text extraction.
8. **Frontend follow-up:**
   - Some frontend level labels differ from the approved template wording, for
     example Level 3 Arabic "إنذار جدي" versus the template's "تحذير جاد".
   - `delivery_message` is English only.
   - The frontend report's "no backend notice test found" risk is now resolved.

Ready for frontend integration review

## Late Attendance PDF Asset Package v2 Handoff 2026-09-14

### Scope

- Asset-only correction. No Django, frontend, migration, storage, notification,
  authorization, or deployed-template files were changed.
- Existing v1 assets under `artifacts/late-attendance-notice/` and the deployed
  copies under `Backend/static/pdf_templates/` were retained unchanged.

### New v2 assets

Each approved level has a version-2 blank PDF, a matching version-2 field map,
a real map-driven QA PDF, and a 1.5x QA raster under
`artifacts/late-attendance-notice/v2/level-1` through `level-4`.

- Level 1: blue informational warning; visible English/Arabic no-deduction copy.
- Level 2: amber formal caution; visible 5% daily-rate deduction copy.
- Level 3: burgundy serious warning; visible 10% daily-rate deduction copy.
- Level 4: dark-crimson/charcoal critical final warning; visible 50% daily-rate
  deduction copy for fourth and later occurrences.

All four maps use `version: 2`, a bottom-left point origin, and the same
25-field catalog. The catalog includes dynamic mapped zones for occurrence,
policy result, penalty percentage, penalty amount, and reason. The prior
12-16-point vertical mismatch is removed: each v2 grey placeholder is drawn
from the exact rectangle declared in its map and then filled by the repository
map-driven renderer during QA.

`company_logo` is supported as a map `kind: image` zone (`organization.logo`,
contain mode), so the templates no longer preprint FFI branding as a universal
identity. QA rendered a non-FFI example logo into that field. HR representative
name, title, and signature remain blank/manual-only; `hr_signature_image` has
`auto_sign: false`.

### Verification and authoritative report

- Four blank templates: one-page A4 PDFs.
- Four maps: valid JSON, `version: 2`, 25 declared fields, all coordinates
  within page bounds.
- Four QA samples: rendered through `core.pdf_forms.render_mapped_form`; each
  was rasterized at 1.5x and visually inspected.
- All absolute output paths, SHA-256 checksums, declared fields, required keys,
  logo support, and visual-QA results are in
  `artifacts/late-attendance-notice/v2/VALIDATION_REPORT.md`.
- Machine-readable digest manifest:
  `artifacts/late-attendance-notice/v2/CHECKSUMS.sha256`.

Ready for backend-agent asset integration review. No deployment was performed.

## Late Attendance PDF Asset Package v2 Visual Treatment Revision 2 - 2026-09-14

### Approved visual update

- Rebuilt only `artifacts/late-attendance-notice/v2/level-1` through `level-4`.
  No application code, deployed template, or v1 asset was changed.
- All four templates now use the approved open, professional treatment: no
  large colored severity/status panel, no `Level X` / `المستوى X` block, and
  larger, more spacious grey value fields.
- The Arabic notice heading is now `إنذار التأخر في الحضور`. The four concise
  localized subtitles are `إنذار توعوي`, `تنبيه رسمي`, `تحذير جاد`, and
  `إنذار نهائي حرج`.
- Level accents remain distinct: blue (1), amber (2), burgundy (3), and dark
  crimson (4). The policy line remains visible in English and Arabic, including
  Level 1's no-deduction wording and Levels 2-4's 5%, 10%, and 50% daily-rate
  deductions.

### HR signature mapping

- Removed the printed HR panel, HR representative name/title fields, and the
  visible signature box.
- Each map now declares one blank, manual-only `hr_signature_image` zone,
  centered at `x=205, y=218, width=185, height=42` points. It uses image
  `contain` mode and `auto_sign: false`; the PDF shows only an open centered
  signature line and bilingual signature label.
- Maps remain `version: 2` and now include `asset_revision: 2` with
  `layout_treatment: minimal_open_signature`. `company_logo` remains a
  supported map-driven image field.

### QA and handoff state

- Regenerated the four blank PDFs, four field-map JSON files, four real
  map-driven QA PDFs, QA rasters, checksums, and the validation report.
- Visual QA verified the policy wording, accent treatment, logo placement,
  centered open signature area, and centered rendered values in all declared
  grey fields.
- Authoritative paths and SHA-256 values are in
  `artifacts/late-attendance-notice/v2/VALIDATION_REPORT.md` and
  `artifacts/late-attendance-notice/v2/CHECKSUMS.sha256`.

Ready for backend-agent asset integration review. No deployment was performed.

## Backend handoff report - v2 late-attendance PDF package and WhatsApp template (2026-09-14)

Focused backend change. No frontend files changed, nothing was deployed, and no
v1 asset, artifact v2 asset, or PDF design was modified.

### Delivered

- **v2 assets.** The four approved pairs were copied byte-identically from
  `artifacts/late-attendance-notice/v2/level-*/` into
  `Backend/static/pdf_templates/`, keeping their names:
  `late_attendance_level_{1..4}_blank_v2.pdf` and
  `late_attendance_level_{1..4}_field_map_v2.json`. The v1 pairs stay deployed
  unchanged (SHA-256 re-verified). `.gitignore` allows the v2 pairs, and the
  template README documents both versions.
- **Template selection.** `attendance/late_notices.py` loads only the v2 pair
  for a level. It refuses a map unless `template`, `version: 2`, and
  `style.level` match, `hr_signature_image` is a manual-only image with
  `auto_sign: false`, and `company_logo` is an image field. New
  `AttendanceLateNotice` rows store the actual `_v2` filename and
  `template_version = 2`.
- **v1 snapshots.** Existing notices of any version are returned as-is; nothing
  re-renders, replaces, or backfills them.
- **Value contract.** The PDF is filled with exactly the 21 v2 text fields from
  real system data:
  - `penalty_percentage` is `0%`, `5%`, `10%`, or `50%` from the penalty snapshot.
  - `penalty_amount` is `SAR 0.00` for level 1, otherwise the actual snapshot
    amount. The currency is SAR because payroll has no currency field.
  - `policy_result` is the level copy (`Warning only - no payroll deduction.`,
    `Formal caution - 5% daily-rate deduction.`,
    `Serious warning - 10% daily-rate deduction.`,
    `Critical final warning - 50% daily-rate deduction.`), identical to each
    map's preprinted `policy_en` and the notification catalog.
  - `reason` is human-readable text for the policy's classification codes
    (`outside_grace`, `post_grace_late`), with a generic sentence for any other
    code. The internal code is never printed.
  - Any key outside the map raises `ValueError`.
- **Company data fallback.** `OrganizationNode` has no Arabic name or contact
  fields.
  - `company_name_ar` uses the canonical `OrganizationNode.name`.
  - `company_phone`, `company_address`, `company_website`, and `company_email`
    are empty.
  - No QA company, phone, address, website, or email data is used.
- **Company logo.** The configured `OrganizationNode.logo` is read from private
  storage in memory, capped at 2 MB. It reaches the renderer's `signatures`
  mapping under `company_logo` only as an image transport.
  - A missing, unreadable, invalid, oversized, or undrawable logo leaves the
    approved placeholder and never blocks the notice or attendance calculation.
  - The outcome is audited as `company_logo_state`: `placed`, `not_configured`,
    `unreadable`, `oversized`, `invalid`, or `unplaceable`.
  - Logo and generation failures log only the error type and IDs, never a
    storage path or file contents.
  - `hr_signature_image` is never passed, so there is no auto-signing.
- **WhatsApp template `late_attendance_notice_v1`.** It is registered in both
  `core/services/whatsapp_service.py` (`WHATSAPP_TEMPLATE_REGISTRY`) and
  `core/services/whatsapp_template_library.py` (default body, samples, and
  admin listing).
  - Variables, in order: `employee_name`, `notice_level`, `notice_level_ar`,
    `violation_date`, `occurrence_number`, `reference_number`,
    `policy_result`, `policy_result_ar`, `action_url`.
  - The body is Arabic first and English second, states the level, date,
    occurrence, reference, and policy result, says the private PDF is attached,
    and ends with the existing `_FFI HR · الموارد البشرية_` footer. It carries
    no PDF URL; `action_url` is `/employee/attendance`.
- **Delivery.** Notice delivery passes
  `whatsapp_template="late_attendance_notice_v1"`, those exact variables, and
  `whatsapp_document={"attendance_late_notice_id": notice.id}`. The dispatcher
  uploads the stored private PDF as base64, captioned by the template.
- **Unchanged.** API routes and fields, company scope, private download, and
  audit event names are unchanged. `attendance_late_notice_generated` metadata
  gains `company_logo_state`.

### Changed files

- `Backend/attendance/late_notices.py`
- `Backend/attendance/test_late_notice_delivery.py`
- `Backend/core/services/whatsapp_service.py`
- `Backend/core/services/whatsapp_template_library.py`
- `Backend/core/tests_pdf_forms.py`: v1 and v2 notice pairs added to the
  deployment-consistency checks; the unmapped-template scan now also matches
  `*_blank_v2.pdf`.
- `Backend/static/pdf_templates/late_attendance_level_{1..4}_blank_v2.pdf` (new)
- `Backend/static/pdf_templates/late_attendance_level_{1..4}_field_map_v2.json` (new)
- `Backend/static/pdf_templates/README.md`
- `.gitignore`
- `plans/Attendance Permissions API Contract.md`: notice section updated for v2
  values, logo, HR signature, WhatsApp template, and logo audit state.

### Migrations

None. `makemigrations --check --dry-run` reports no changes. No applied
migration changed.

### Verification

- **Ruff:** `ruff check --fix` on all changed Python files fixed one import
  ordering; the final state is clean.
- **Django check:** `manage.py check` gives
  `System check identified no issues (0 silenced).`
- **Drift check:** `makemigrations --check --dry-run` gives `No changes detected`.
- **PostgreSQL tests** (fresh isolated DB `test_ffi_hr_db_noticev2`):
  - Command: `pytest attendance/test_late_notice_delivery.py attendance/test_policy_enforcement.py attendance/test_policy_api.py payroll/test_attendance_deductions.py in_app_notifications permission_requests/tests/test_attendance_permissions.py core/tests_pdf_forms.py core/tests_messaging_providers.py core/test_whatsapp_security.py --create-db`
  - Result: `216 passed, 148 subtests passed in 336.95s`.
- **Collection:** `attendance/test_late_notice_delivery.py` has 23 tests, and
  `core/tests_pdf_forms.py` brings the total to 71 collected.
- **New or updated regression coverage:**
  - v2 SHA-256 pins, and v1 pins still unchanged.
  - Map version and asset revision metadata, the declared text and image field
    sets, the HR signature being manual-only, and refusal of a downgraded or
    auto-signing map.
  - Levels 1-5 using the v2 templates with formatted percentage, amount, and
    policy result.
  - Every rendered word lying inside a declared field, each field's text
    equalling its value, and empty contact fields.
  - The logo drawn once, fully inside `company_logo` and outside the HR
    signature zone, with the renderer never receiving `hr_signature_image`.
  - Not-configured, invalid, unreadable, and oversized logos keeping the
    placeholder and still delivering, with no path in audit or log records.
  - No re-render, replacement, or backfill of a v1 snapshot.
  - Registry/library parity, exact variable order, an Arabic-first body with
    the footer, no PDF URL, and caption length within 1024 characters.
  - Dispatch kwargs, and an end-to-end WhatsApp media upload of the private PDF.
  - Existing company-scope, contract-field, filter, and private-download tests
    unchanged and passing.
- **Artifact integrity:** `sha256sum -c` against
  `artifacts/late-attendance-notice/v2/CHECKSUMS.sha256` reports all 16 files OK.
- **Graph:** `graphify update .` rebuilt.

### Visual QA

Rendered one PDF per level through `render_notice_pdf` and rasterized each with
PyMuPDF.
- **Levels 1, 2, and 4:** rendered with a test logo. Level 2 uses an Arabic
  employee name and department.
- **Level 3:** rendered with no logo.
- **Result:**
  - Every page is one A4 page.
  - All values are centered inside their grey fields, including the two-line
    reason box and the header company and reference fields.
  - Arabic is correctly shaped.
  - The logo is contained in its slot, and the no-logo page keeps the printed
    `Company logo / شعار الشركة` placeholder.
  - The HR signature area is blank, with no image intersecting the signature
    zone on any level.
  - Contact fields are empty.

### Blockers and follow-ups

1. **Transparent logos show the preprinted placeholder.** The v2 artwork prints
   `Company logo / شعار الشركة` inside the logo slot. A transparent logo, or one
   whose aspect ratio does not fill the slot, lets that text show through beside
   or behind the logo, which QA confirmed with a transparent PNG. Opaque logos
   that fill the slot cover it. Removing the preprinted label needs a design
   amendment; the backend does not paint over approved artwork.
2. **No Arabic company name or company contact data.** `company_name_ar`
   repeats the English canonical name, and phone, address, website, and email
   print empty until authoritative fields exist.
3. **Snapshot immutability.** Issued notices keep their original level, values,
   and template version even if delayed punches later re-sequence occurrences.
4. **Pre-existing frontend follow-ups.** Level label wording differences and the
   English-only `delivery_message` are unchanged by this work.

Ready for frontend integration review.

## Late Attendance PDF Asset Package v3 Logo Slot Correction - 2026-09-14

### Scope

- Created a separate v3 package under `artifacts/late-attendance-notice/v3`.
  V1 and v2 packages were retained unchanged.
- No backend code, frontend code, migration, notification flow, or files under
  `Backend/static/pdf_templates` were modified.

### Logo correction and retained behavior

- Removed the printed `Company logo` and `شعار الشركة` placeholder labels from
  the content of all four blank PDF templates.
- The logo area is now an opaque, neutral `#F8FAFC` rounded slot, preserving
  the exact v2 image-field coordinates and making transparent PNG logos fully
  legible without text showing through.
- All v2 field coordinates, titles, bilingual policy wording, four accent
  colors, and open centered HR signature line remain unchanged.
- Every map is now `version: 3` and `asset_revision: 3`. `company_logo`
  remains `kind: image` with `image_mode: contain`. `hr_signature_image`
  remains the only manual-only field with `auto_sign: false`.

### QA and backend handoff

- Four blank A4 v3 templates and field maps were created, plus transparent-logo
  and opaque-logo rendered QA PDFs and PNG previews for every level.
- Validation confirmed the text-free logo slot, both logo modes, one-page PDFs,
  preserved 23-field maps and centering, blank HR signature area, and visible
  dynamic QA values.
- Exact paths, declared fields, visual-QA results, and SHA-256 digests are in
  `artifacts/late-attendance-notice/v3/VALIDATION_REPORT.md` and
  `artifacts/late-attendance-notice/v3/CHECKSUMS.sha256`.

Ready for manager verification and backend-agent v3 integration. No deployment
was performed.

## Backend handoff report - late-attendance notices switched to approved PDF v3 (2026-09-14)

Focused backend change. Unchanged: v1 and v2 assets, the v3 PDF design assets,
frontend code, and WhatsApp templates (`core/services/whatsapp_service.py` and
`core/services/whatsapp_template_library.py` were not edited). Nothing was
deployed.

### Delivered

- **v3 assets.** The eight production assets were copied byte-identically from
  `artifacts/late-attendance-notice/v3/level-*/` into
  `Backend/static/pdf_templates/`, each PDF with its map:
  `late_attendance_level_{1..4}_blank_v3.pdf` and
  `late_attendance_level_{1..4}_field_map_v3.json`. `.gitignore` allows all
  eight (confirmed with `git check-ignore`).
- **Active version.** `attendance/late_notices.py` sets `TEMPLATE_VERSION = 3`
  and `ASSET_REVISION = 3`, and selects only the `_v3` filenames for newly
  issued notices.
- **Loader checks.** The loader refuses a map unless all of these hold:
  - `template` equals the `_v3` PDF name.
  - `version` is `3` and `asset_revision` is `3`.
  - `style.level` matches the level.
  - `hr_signature_image` is a manual-only image with `auto_sign: false`.
  - `company_logo` is an image field.
- **New notices.** New notices store the actual `_v3` filename and
  `template_version = 3`.
- **Unchanged behaviour.** Company-logo image rendering, the blank manual-only
  HR signature, private storage, company scope, the WhatsApp private
  attachment, and audit safety are unchanged.
- **Immutable snapshots.** Version 1 and version 2 notices are returned
  untouched. Nothing backfills, regenerates, replaces, or redelivers an existing
  notice; only genuinely new active late violations receive v3 PDFs.
- **Neutral logo slot.** The v3 logo area is an opaque `#F8FAFC` surface (map
  `logo.background: "opaque #F8FAFC"`). No `Company logo` or `شعار الشركة` text
  is visible or extractable, even after NFKC normalization of the Arabic
  presentation forms. Transparent and opaque logos both render cleanly.

### Changed files

- `Backend/attendance/late_notices.py`
- `Backend/attendance/test_late_notice_delivery.py`
- `Backend/core/tests_pdf_forms.py`: v3 pairs added to the
  deployment-consistency and page-bounds checks, alongside the retained v2 and
  v1 pairs.
- `Backend/static/pdf_templates/late_attendance_level_{1..4}_blank_v3.pdf` (new)
- `Backend/static/pdf_templates/late_attendance_level_{1..4}_field_map_v3.json` (new)
- `Backend/static/pdf_templates/README.md`: v3 active; v1 and v2 retained
  historical versions; neutral text-free `#F8FAFC` logo slot.
- `.gitignore`
- `plans/Attendance Permissions API Contract.md`: the notice issuance table now
  lists the v3 pairs. The template-versions paragraph marks v3 active and v1/v2
  historical and immutable, describes the neutral logo slot, and covers
  transparent and opaque logo rendering.

### Migrations

None added; Django does not require one. `makemigrations --check --dry-run`
reports `No changes detected`. No applied migration changed.

### Verification (exact results)

- **Ruff:** `ruff check attendance/late_notices.py attendance/test_late_notice_delivery.py core/tests_pdf_forms.py` gives `All checks passed!`.
- **Django check:** `manage.py check` gives
  `System check identified no issues (0 silenced).`
- **Drift check:** `makemigrations --check --dry-run` gives `No changes detected`.
- **Focused PostgreSQL and PDF-form tests** (fresh isolated DB
  `test_ffi_hr_db_noticev3`, `--create-db`):
  - Command: `pytest attendance/test_late_notice_delivery.py attendance/test_policy_enforcement.py attendance/test_policy_api.py payroll/test_attendance_deductions.py in_app_notifications permission_requests/tests/test_attendance_permissions.py core/tests_pdf_forms.py core/tests_pdf_signers.py core/tests_pdf_signature_integration.py core/tests_messaging_providers.py core/test_whatsapp_security.py`
  - Result: `253 passed, 164 subtests passed in 555.36s (0:09:15)`.
- **Collection:** `attendance/test_late_notice_delivery.py` gives
  `24 tests collected`. The PDF-form suites (`core/tests_pdf_forms.py`,
  `core/tests_pdf_signers.py`, `core/tests_pdf_signature_integration.py`) give
  `84 tests collected`.
- **Regression coverage:**
  - All eight v3 SHA-256 values pinned, alongside the unchanged v2 and v1 pins.
  - v3 metadata per level: template name, `version: 3`, `asset_revision: 3`,
    `style.level`, `logo.background`, declared text and image field sets, and
    the manual-only HR signature.
  - Refusal of maps with `version: 2`, `asset_revision: 2`, a v2 template name,
    or `auto_sign: true`.
  - Blank v3 PDFs contain no `Company logo` or `شعار الشركة` in NFKC-normalized
    extracted text and no text inside the logo slot. The slot pixels are
    `#F8FAFC` within 3 per channel. Control: the same extraction does find both
    labels on the retained v2 blank.
  - Opaque and transparent logos are each drawn once, fully inside
    `company_logo` and outside the HR signature zone.
    - The logo slot carries no text.
    - A transparent logo corner shows the neutral slot colour, while an opaque
      logo covers it.
    - The renderer only ever receives `{company_logo}`.
  - Stored v1 and v2 snapshots keep their bytes, template name and version,
    document name, notification, delivery status, and issue time through
    recalculation, re-issue calls, and a later violation. Dispatch runs exactly
    once, for the new v3 notice only.
  - Existing privacy, company-scope, contract-field, filter,
    private-download, WhatsApp template and private-attachment, logo failure,
    and rendering and delivery failure tests are unchanged and passing.
- **Asset integrity:**
  - `sha256sum -c` against `artifacts/late-attendance-notice/v3/CHECKSUMS.sha256`
    gives 24/24 OK.
  - `sha256sum -c` against the v2 `CHECKSUMS.sha256` gives 16/16 OK.
  - Deployed v1 and v2 pairs match their pinned hashes.
- **Graph:** `graphify update .` rebuilt.

### Visual QA (all four levels)

Rendered through `render_notice_pdf` with the design's QA transparent and
opaque logos, then rasterized with PyMuPDF.

| Level | Logo | Pages | Logo state | Placeholder text | Logo-slot text | Images in HR signature |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | transparent | 1 | `placed` | none | empty | 0 |
| 1 | opaque | 1 | `placed` | none | empty | 0 |
| 1 | none | 1 | `not_configured` | none | empty | 0 |
| 2 (Arabic values) | opaque | 1 | `placed` | none | empty | 0 |
| 3 | none | 1 | `not_configured` | none | empty | 0 |
| 4 | transparent | 1 | `placed` | none | empty | 0 |

On inspection:
- Values sit centered in their grey fields.
- Arabic is shaped correctly.
- The transparent logo sits cleanly on the neutral slot, the opaque logo is
  contained in the slot, and with no logo the slot stays plain.
- The HR signature area is open and blank.

### Remaining follow-ups (unchanged by this switch)

1. `OrganizationNode` still has no Arabic company name or contact fields, so
   `company_name_ar` repeats the canonical name and contact fields print empty.
2. Issued notices keep their original level, values, and template version even
   if delayed punches later re-sequence occurrences.
3. Pre-existing frontend follow-ups remain: level label wording differences and
   the English-only `delivery_message`.

Ready for frontend integration review.

## Frontend synchronization report - canonical v2 notice styles and localized delivery (2026-09-14)

This closes the frontend follow-ups listed above: the level label wording and
the English-only `delivery_message`. No backend code, API, PDF asset, template,
WhatsApp template, or deploy file was changed. No send, resend, or retry control
was added.

### What changed

- **Level labels.** Employee and HR notice lists now use the canonical v2
  taxonomy exactly.

  | Level | English | Arabic | English policy | Arabic policy |
  | --- | --- | --- | --- | --- |
  | 1 | Informational warning | إنذار توعوي | Warning only - no payroll deduction. | تحذير فقط - لا يوجد خصم من الراتب. |
  | 2 | Formal caution | تنبيه رسمي | Formal caution - 5% daily-rate deduction. | تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي. |
  | 3 | Serious warning | تحذير جاد | Serious warning - 10% daily-rate deduction. | تحذير جاد - خصم بنسبة ١٠٪ من الأجر اليومي. |
  | 4 | Critical final warning | إنذار نهائي حرج | Critical final warning - 50% daily-rate deduction. | إنذار نهائي حرج - خصم بنسبة ٥٠٪ من الأجر اليومي. |

  - The Arabic labels for Levels 1, 3 and 4 replaced "تنبيه معلوماتي", "إنذار
    جدي" and "إنذار نهائي حاسم".
  - Every notice row now shows its level's policy result under the level tag.
    Previously only Level 1 had an explanation.
  - Level 1 shows the warning-only, no-deduction policy. It never shows Pending,
    awaiting-payroll wording, or a percentage.
- **Delivery status.** The UI wording is derived only from `delivery_status`,
  in the UI language.

  | Status | Label (English / Arabic) | Meaning (English / Arabic) |
  | --- | --- | --- |
  | `scheduled` | Delivery scheduled / الإرسال مجدول | In-app notice created; WhatsApp or email delivery is scheduled. / تم إنشاء الإشعار داخل النظام، والإرسال عبر واتساب أو البريد الإلكتروني مجدول. |
  | `sent` | Sent / أُرسل | Delivered through WhatsApp or email. / تم التسليم عبر واتساب أو البريد الإلكتروني. |
  | `failed` | Delivery failed / تعذر الإرسال | Delivery could not be completed. / تعذر إكمال إرسال الإشعار. |
  | `skipped` | Not sent / لم يُرسل | Not sent: no active account or no configured delivery channel. / لم يُرسل: لا يوجد حساب نشط أو قناة إرسال مهيأة. |

  - A null status reads "Not recorded" / "غير مسجلة".
  - Any other value reads "Unknown delivery status" / "حالة إرسال غير معروفة";
    the raw value is no longer shown.
  - The backend's English-only `delivery_message` is no longer rendered in
    either language. That also removes its extra detail, such as "no active
    user account" versus "no configured external channel".
- **PDF download.** The Download PDF button renders only when `filename` is
  present.
  - Rows without a stored document show "PDF not available" / "ملف PDF غير
    متاح", and no download request can be made from them.
  - Downloads still go through `apiClient` as a blob
    (`GET /api/attendance/notices/{id}/download/`,
    `responseType: "blob"`) and are saved with `downloadBlob`.
  - No storage URL, `<a href>`, or company header or parameter is built.
- **Unchanged.** The API routes, fields, filters, company scope, and
  violation, recalculation, payroll and warning-only violation UI were not
  changed. The violation lifecycle hint keeps its existing wording.

### Files changed (all under `FrontEnd/src/`)

- `i18n/translations.ts`, English and Arabic:
  - Canonical Arabic level labels.
  - New `attendancePolicy.notices.policy.{1-4}`,
    `attendancePolicy.notices.deliveryHint.{scheduled,sent,failed,skipped}`,
    `attendancePolicy.notices.delivery.unknown`, and
    `attendancePolicy.notices.pdfUnavailable`.
- `utils/attendancePolicy.ts`:
  - `noticeLevelMeaning` returns the v2 policy result for every level.
  - `noticeDeliveryLabel` maps unknown values to "unknown".
  - New `noticeDeliveryHint` and `hasNoticeDocument`.
- `types/attendancePolicy.ts`: field comments for `delivery_message` and
  `filename`.
- `components/attendance/AttendanceNoticesTable.tsx`: the policy line for
  every level, localized delivery meaning, and a download button only when a
  document exists.
- `test/attendanceNoticeText.ts` (new): the canonical style and delivery
  wording shared by the employee and HR tests.
- Tests:
  - `utils/attendancePolicy.test.ts`
  - `components/attendance/MyAttendanceNotices.test.tsx`
  - `components/attendance/HrAttendanceNoticesPanel.test.tsx`
  - `components/attendance/HrAttendanceViolationsPanel.test.tsx` and
    `components/attendance/RecalculateAttendanceModal.test.tsx`: timeout-only
    hardening, described under "Tests and checks".

### Coverage

- **Employee and HR lists.** Both have one notice per level and one per delivery
  state, including a row with `filename: null`.
  - English and Arabic assert the exact label, policy result, delivery label
    and delivery meaning on every row.
  - Every backend `delivery_message` string is asserted absent in both
    languages.
- **Level 1.** The row shows the no-deduction policy and contains no
  pending/awaiting/percentage wording: `%` in English, `٪`, `بانتظار` and
  `معلّقة` in Arabic.
- **Absent document.** The row has no download button and shows "PDF not
  available" in English and Arabic, on phone cards and on the desktop table.
  Exactly three download buttons exist for four rows.
- **Downloads.**
  - Employee: the real API layer calls
    `/api/attendance/notices/{id}/download/` with `responseType: "blob"`, and
    `downloadBlob` receives that blob. No `a[href]` is rendered.
  - HR: the download goes through `downloadAttendanceNotice`.
  - A download 404 shows a message and saves nothing.
- **States and filters.** Empty, 403, 404, generic error, and loading states;
  HR URL filters and 422 mapping; and no send or retry button in either list.
- **Utilities.** Exact English and Arabic arrays for all four labels, policy
  results, delivery labels and meanings. Also the null and unknown delivery
  values and `hasNoticeDocument`.

### Tests and checks (run from `FrontEnd/`)

- `npx tsc -p tsconfig.app.json --noEmit`: exit 0.
- `npx vitest run src/components/attendance/MyAttendanceNotices.test.tsx src/components/attendance/HrAttendanceNoticesPanel.test.tsx src/utils/attendancePolicy.test.ts src/services/api/attendanceApi.test.ts src/i18n/translationParity.test.ts src/pages/employee/AttendancePage.test.tsx src/pages/shared/AttendancePreviewPage.test.tsx src/pages/shared/AttendancePreviewPage.ceo.test.tsx src/components/attendance/AttendanceViolationsTable.test.tsx src/components/attendance/TodayAttendanceSummaryCard.test.tsx src/components/attendance/HrAttendanceViolationsPanel.test.tsx src/components/attendance/RecalculateAttendanceModal.test.tsx`:
  `Test Files 12 passed (12)`, `Tests 126 passed (126)`, duration 347.83s.
- `npx prettier --check` on the 17 notice-related files: all use Prettier code
  style. An earlier `--write` reformatted `utils/attendancePolicy.ts` and its
  test.
- `npx eslint` on the same 17 files: exit 0, no findings.
- **Earlier failed runs.** This machine was heavily loaded, with this
  morning's 66s test run taking about 350s. Earlier runs of the same set failed
  only where Testing Library's default 1s wait timed out before antd rendered
  asynchronous form help or confirm results:
  - the 422 tests in both HR panels
  - the 404 and 422 tests in the recalculation modal
  - Each failed test passed when rerun alone, and none of those suites use code
    changed in this round.
  - Those five assertions now wait up to 5s; the assertions themselves are
    unchanged. The final run above passed with no retries.
- The full `npm run test`, `npm run lint`, and `npm run format:check` were not
  rerun.

### Known blockers and follow-ups

- **Backend Level 1 Arabic name differs from the canonical taxonomy.**
  `Backend/in_app_notifications/i18n.py` (`attendance.late_notice_level_1`)
  titles Level 1 "إشعار توعوي", not "إنذار توعوي".
  - `late_notices.level_labels()` derives the WhatsApp `notice_level_ar`
    variable from that title.
  - So the in-app notification title and the WhatsApp Arabic level name still
    say "إشعار توعوي", while the frontend says "إنذار توعوي".
  - The Level 2-4 Arabic names and all four policy strings match. This needs a
    backend catalog change, which was out of scope.
- The frontend has not been run against a live backend or a real notice PDF.
- Server-side delivery nuance (for example "Employee has no active user
  account") is no longer visible in the UI. If HR needs it, the backend should
  expose a reason code that the frontend can localize.

Ready for manager verification

## Backend terminology sync - late-attendance notice titles use the canonical v3 taxonomy (2026-09-14)

Terminology-only correction. Unchanged: PDF assets (v1/v2/v3), notice versions
(`TEMPLATE_VERSION = 3`), APIs, database models, frontend files, WhatsApp
template body and variable order, and delivery behavior.

### Problem

The `attendance.late_notice_level_*` catalog titles used old "Level X" wording,
for example Level 1 read `إشعار التأخر في الحضور - المستوى الأول - إشعار توعوي`.
`attendance/late_notices.py::level_labels()` derives the WhatsApp
`notice_level` and `notice_level_ar` variables from those titles, so in-app and
WhatsApp wording disagreed with the approved v3 PDF and the frontend taxonomy.

### Change

- `Backend/in_app_notifications/i18n.py`: the four titles now use the canonical
  v3 taxonomy with no Level wording:

  | Level | English title | Arabic title |
  | --- | --- | --- |
  | 1 | `Late Attendance Notice - Informational Warning` | `إنذار التأخر في الحضور - إنذار توعوي` |
  | 2 | `Late Attendance Notice - Formal Caution` | `إنذار التأخر في الحضور - تنبيه رسمي` |
  | 3 | `Late Attendance Notice - Serious Warning` | `إنذار التأخر في الحضور - تحذير جاد` |
  | 4 | `Late Attendance Notice - Critical Final Warning` | `إنذار التأخر في الحضور - إنذار نهائي حرج` |

  The four policy-result messages are byte-for-byte unchanged.
- **`level_labels()` output** (no code change; it splits the catalog title at
  the first ` - `): `("Informational Warning", "إنذار توعوي")`,
  `("Formal Caution", "تنبيه رسمي")`, `("Serious Warning", "تحذير جاد")`, and
  `("Critical Final Warning", "إنذار نهائي حرج")`. WhatsApp `notice_level` and
  `notice_level_ar` carry exactly these values. Only the example in its
  docstring was updated.
- `Backend/core/services/whatsapp_template_library.py`: only the admin preview
  `sample_variables` for `late_attendance_notice_v1` were updated, to
  `notice_level: "Formal Caution"` and `notice_level_ar: "تنبيه رسمي"`. The
  template body, variables, and registry are unchanged.
- `Backend/attendance/test_late_notice_delivery.py`: regression tests (below).

### Regression coverage

- **Catalog and PDF sync:**
  - `level_labels(level)` equals the canonical English and Arabic pair for all
    four levels.
  - Each catalog title equals `Late Attendance Notice - <en>` and
    `إنذار التأخر في الحضور - <ar>`, with no `Level 1-4`, `المستوى`,
    `إشعار توعوي`, or `إشعار التأخر` wording.
  - The catalog message and `policy_result(level)` equal the unchanged
    English and Arabic policy copy.
  - The NFKC-normalized text of the v3 blank PDF contains
    `LATE ATTENDANCE NOTICE`, `إنذار التأخر في الحضور`, the uppercase English
    label, and the Arabic label, and no `المستوى`.
- **In-app:** issued notices for occurrences 1-5 have the notification title
  `Late Attendance Notice - <canonical English label>`.
- **WhatsApp delivery:**
  - The level 1 dispatch passes `("Informational Warning", "إنذار توعوي")`, and
    the level 2 dispatch passes exactly `"Formal Caution"` and `"تنبيه رسمي"`
    with the unchanged variable order.
  - The private PDF attachment and the end-to-end media upload are unchanged.
- **WhatsApp body, all four levels:**
  - Still Arabic first, with `*المستوى:* <ar label>` before the English
    `*Level:* <en label>`.
  - No `Level 1-4` or `المستوى الأول/الثاني/الثالث/الرابع` wording.
  - Still no `/api/`, `download`, `.pdf`, or storage path, ends with the FFI HR
    footer, and stays within 1024 characters.
- **Unchanged and passing:** PDF rendering, v3 asset hashes and metadata,
  logo, HR signature, API contract, company scope, private download, and privacy
  tests.

### Verification (exact results)

- **Ruff:** `ruff check attendance/late_notices.py attendance/test_late_notice_delivery.py in_app_notifications/i18n.py core/services/whatsapp_template_library.py` gives `All checks passed!`.
- **Django check:** `manage.py check` gives
  `System check identified no issues (0 silenced).`
- **Drift check:** `makemigrations --check --dry-run` gives `No changes detected`
  (no migration).
- **Focused PostgreSQL notice, WhatsApp, and PDF-form tests** (fresh isolated DB
  `test_ffi_hr_db_noticeterms`, `--create-db`):
  - Command: `pytest attendance/test_late_notice_delivery.py in_app_notifications core/tests_messaging_providers.py core/test_whatsapp_security.py core/tests_pdf_forms.py`
  - Result: `169 passed, 162 subtests passed in 274.97s (0:04:34)`.
- **Collection:** `attendance/test_late_notice_delivery.py` gives
  `25 tests collected`.
- **v3 asset hashes:** unchanged (`e8def839…`, `0b6f09e2…`, `0f476f81…`,
  `9f9b442b…`, `2e5f756f…`, `8944b339…`, `33821ff0…`, `d464fdfe…`).
- **Graph:** `graphify update .` rebuilt.

### Remaining follow-ups (not changed; outside this correction's scope)

1. **WhatsApp heading wording.** The fixed Arabic heading and intro in the
   `late_attendance_notice_v1` body read `إشعار تأخر في الحضور` ("notice"),
   while the canonical title now reads `إنذار التأخر في الحضور`. Aligning them
   is a WhatsApp template body edit and needs separate approval.
2. **English casing.** Backend labels use title case (`Informational Warning`),
   as specified for the catalog titles, while the frontend displays sentence
   case (`Informational warning`). The wording is identical and the Arabic
   matches exactly.
3. **Retained v1 maps.** The historical v1 field maps still carry the old
   `Level X` titles in `preprinted_content`. They are immutable historical
   assets and are not used for new notices.
4. **Already-issued notifications.** The notifications API renders `title` and
   `message` from the stored i18n catalog key at read time
   (`in_app_notifications/serializers.py` calls `localized_notification_field`,
   which calls `render`). Existing in-app notice notifications therefore display
   the new wording without a data migration. The stored English `title` column
   is only a fallback and keeps the old text. WhatsApp and email messages already
   sent keep the wording they were sent with; nothing is redelivered.

Ready for frontend integration review.

## Backend wording correction - `late_attendance_notice_v1` WhatsApp body uses approved v3 terminology (2026-09-14)

Wording-only change. Unchanged: PDF assets, APIs, database models, delivery
behavior, notice versions, template key, the nine template variables and their
order, and the registry spec.

### Change

In `Backend/core/services/whatsapp_template_library.py`, only the
`late_attendance_notice_v1` `default_body` changed:

| Part | Before | After |
| --- | --- | --- |
| Arabic heading | `⚠️ *إشعار تأخر في الحضور*` | `⚠️ *إنذار التأخر في الحضور*` |
| Arabic intro | `صدر لك إشعار تأخر في الحضور. نسختك الخاصة من الإشعار بصيغة PDF مرفقة بهذه الرسالة.` | `صدر لك إنذار تأخر في الحضور. نسختك الخاصة من الإنذار بصيغة PDF مرفقة بهذه الرسالة.` |
| Arabic level caption | `• *المستوى:* {{ notice_level_ar }}` | `• *نوع الإنذار:* {{ notice_level_ar }}` |
| English level caption | `• *Level:* {{ notice_level }}` | `• *Notice type:* {{ notice_level }}` |

Kept as before:
- Arabic section first.
- All nine variables: `employee_name`, `notice_level`, `notice_level_ar`,
  `violation_date`, `occurrence_number`, `reference_number`, `policy_result`,
  `policy_result_ar`, `action_url`.
- Policy-result captions and wording.
- The private PDF attachment statement in both languages.
- The authenticated `action_url` (`/employee/attendance`), with no public PDF
  or download URL.
- The `_FFI HR · الموارد البشرية_` footer.

Rendered level 1 example (Arabic part):

```text
⚠️ *إنذار التأخر في الحضور*

مرحباً Sara Ali،
صدر لك إنذار تأخر في الحضور. نسختك الخاصة من الإنذار بصيغة PDF مرفقة بهذه الرسالة.

• *نوع الإنذار:* إنذار توعوي
```

The English part renders `• *Notice type:* Informational Warning`.

No `WhatsAppMessageTemplate` custom override row exists for this key in the
local dev database, so the new default body is what renders locally. An
environment with a saved custom body keeps that body until it is reset.

### Regression tests (`Backend/attendance/test_late_notice_delivery.py`)

- **Raw default body:**
  - Starts with the exact heading `⚠️ *إنذار التأخر في الحضور*`.
  - Contains `• *نوع الإنذار:* {{ notice_level_ar }}` and
    `• *Notice type:* {{ notice_level }}`.
  - Contains no `إشعار تأخر في الحضور`, `إشعار`, `مستوى`, or `*Level:*`.
  - The Arabic heading comes before the English heading.
  - All nine variable placeholders are still present.
- **Rendered body for all four levels:**
  - Starts with the exact Arabic heading, followed by the exact Arabic intro
    sentence.
  - No `إشعار` anywhere in the Arabic section.
  - `• *نوع الإنذار:* <canonical Arabic label>` and
    `• *Notice type:* <canonical English label>` are present.
  - No `إشعار تأخر في الحضور`, `إشعار التأخر`, `إشعار توعوي`, `مستوى`, or
    `Level` wording.
  - Arabic policy result and attachment statement come before the English
    section.
  - Still no `/api/`, `download`, `.pdf`, or storage path, ends with the FFI HR
    footer, and stays within the 1024-character caption limit.
  - A missing variable is still rejected.
- **End-to-end WhatsApp dispatch with the private PDF:**
  - The caption starts with the exact Arabic heading, which comes before the
    English heading.
  - Contains `• *نوع الإنذار:* تنبيه رسمي` and `• *Notice type:* Formal Caution`.
  - No `إشعار تأخر في الحضور`, `مستوى`, or `*Level:*`.
  - Still no `/api/attendance/notices` or storage path.
  - The media payload is still the private notice PDF.
- **Unchanged and passing:** registry and library parity with the exact
  variable order, the canonical `level_labels()` taxonomy, PDF, API,
  company-scope, privacy, and download tests.

### Verification (exact results)

- **Ruff:** `ruff check core/services/whatsapp_template_library.py attendance/test_late_notice_delivery.py` gives `All checks passed!`.
- **Focused PostgreSQL WhatsApp and notice tests** (fresh isolated DB
  `test_ffi_hr_db_noticewa`, `--create-db`):
  - Command: `pytest attendance/test_late_notice_delivery.py core/tests_messaging_providers.py core/test_whatsapp_security.py in_app_notifications`
  - Result: `113 passed, 162 subtests passed in 210.67s (0:03:30)`.
- **Graph:** `graphify update .` rebuilt.

Ready for frontend integration review.
