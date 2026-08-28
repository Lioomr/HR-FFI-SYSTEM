# Tenant Isolation Security Review — 2026-08-24

## Release decision

**NO-GO for production.** No production data or production service was changed. The tenant controls and focused PostgreSQL regression suite are passing, but production approval remains blocked until:

1. the eight annual-leave balance/overflow failures in the complete backend suite are resolved in the separate annual feature release, while the complete frontend suite remains green;
2. the four manager-field inconsistencies reported by the read-only audit are manually resolved on a staging copy;
3. the annual-leave payment feature is split into its own review/release unit rather than shipped from this mixed working tree; and
4. staging migrations and Athroya/Aseco Pro smoke tests pass.

## Root-cause analysis

The confirmed employee leak came from `EmployeeProfileViewSet.get_queryset()` unioning the authorized company queryset with `company__isnull=True`. Shared scope helpers also had compatibility behavior that could include null-company rows, accept an invalid selector by falling back to another context, or expand an ordinary list when a privileged user selected head office.

The broader audit found the same class of risk at several boundaries:

- URL/header company selectors were treated inconsistently and were not always checked against authenticated organization access.
- Some direct object actions started from an unscoped manager or HR queryset and only applied role checks afterward.
- Imports, invites, notifications, and background jobs had paths where company ownership could be absent or inferred too late.
- Python `clean()` validation did not protect `bulk_create()`, `QuerySet.update()`, or raw database writes.
- Leave requests, types, delegates, balances, snapshots, adjustments, and annual-payment requests needed a common employee-company invariant.
- BioTime mappings could outlive a valid employee/company relationship.
- Announcement and generic pending-approver recipient selection could begin from a global role queryset; these paths now re-resolve recipients against the owned request/announcement company and fail closed when ownership is unknown.
- The rent notification API attempted to return and audit a Django model object inside JSON once a correctly company-authorized recipient was present.

## Scope policy implemented

- `filter_queryset_by_active_company()`: strict single-company list/object scope. It never includes null-company rows.
- `filter_queryset_by_accessible_companies()`: explicit multi-company scope for authorized SystemAdmin/HR workflows only. An ordinary company selector still narrows the result to one company; expansion requires an authorized head-office context.
- `filter_queryset_by_employee_own_company()`: employee/manager/CEO scope derived from the authenticated employee profile.
- `get_active_company_for_request()`: parses query and header selectors strictly and validates access before returning context.
- Blank, malformed, zero, negative, inactive, duplicate, conflicting, and unauthorized selectors fail with 403.
- A query parameter or `X-Active-Company-Id` header selects context only; neither grants access.
- `include_null=True` is prohibited by the shared helper. No ordinary HR caller uses it.
- Frontend persisted context is accepted only when it matches an active organization in the authenticated user payload. Every authenticated request sends that authorized context, and URL/header conflicts are rejected client-side as well as server-side.

## Database integrity controls

PostgreSQL triggers are used because Django constraints cannot express the required cross-table active-company/type/relationship rules, and model validation alone is bypassed by bulk operations.

| Migration | Controls | Data behavior |
|---|---|---|
| `employees.0014_employeeimport_company` | Adds nullable `EmployeeImport.company` ownership for deterministic new imports | Schema-only; no inference or historical rewrite |
| `employees.0015_database_tenant_integrity` | Requires every non-archived profile to reference an active `COMPANY`; validates department/position/task-group/sponsor and manager fields; prevents company deactivation/type changes and cross-company direct reports | Runs a read-only preflight and aborts on invalid existing rows |
| `attendance.0009_biotime_tenant_integrity` | Requires every BioTime mapping to reference a non-archived employee in an active company; blocks later archive/company invalidation | Runs a read-only preflight; no mapping rewrite |
| `invites.0005_invite_company` | Stores the authorized company selected when an invite is created; acceptance derives the new profile company from the invite | Nullable for legacy audit safety; no name-based backfill |
| `leaves.0017_tenant_integrity` | Guards LeaveRequest, LeaveBalanceSnapshot, and LeaveBalanceAdjustment employee/profile/type/delegate/company relationships; blocks reverse profile/type updates that would invalidate history | Runs preflights and aborts; no leave/balance rewrite |
| `leaves.0018_hr_manual_policy_warnings` | Separate HR-manual feature field | Schema-only, unrelated release unit |
| `leaves.0019_annual_leave_payment` | Separate annual-payment model and its employee/profile/company triggers | Annual feature migration; must be reviewed and released separately |

All triggers have explicit reverse SQL. Reversing a trigger migration removes enforcement; it does not rewrite tenant or leave data.

## Leave-balance protection

- Balance calculation starts from `EmployeeProfile.company_id`; a missing company returns no company balance data.
- Leave types are selected only from the employee's exact company. Global/null leave types are not merged into HR data.
- Leave requests and adjustments are filtered by that same profile company.
- Request create/update derives and validates employee profile, employee user, company, leave type, and delegate together.
- Snapshot and adjustment `save()` paths enforce validation, and database triggers cover bulk/update/raw paths.
- Cross-company leave types and delegates are rejected.
- The tenant regression captures all returned balance values, performs scoped reads, recalculates, and asserts byte-for-value equality; it also asserts stored snapshot values are unchanged after rejected database operations.
- No migration updates LeaveRequest, LeaveBalanceSnapshot, LeaveBalanceAdjustment, or historical balance values.

The current working tree also contains an unrelated annual-payment feature that changes annual accrual from old calendar-year expectations to completed 30-day contract periods. That feature is not tenant-isolation behavior and must not be bundled as evidence that tenant scoping changed balances.

## Endpoint scope matrix

| Area | List/queryset scope | Object/write enforcement |
|---|---|---|
| Employees, detail, expiry, pagination, export | Active company only; no null union | Detail/actions/export start from the same scoped queryset |
| Employee documents | Parent employee in active/own company | Foreign parent/document returns 403/404; document ownership must match parent company |
| Attendance, summaries, corrections | Active company or employee-own company | Employee/profile and manager/HR workflow checks run after company scope |
| Leave requests and delegated inbox | Active company or employee-own company | Request/profile/type/delegate/company validated on create and update |
| Leave balances, types, snapshots, adjustments | Employee resolved inside active company; exact-company types only | Serializer, model, and database enforcement; cross-company types rejected |
| Assets and assignments | Active company | Asset and employee assignment queries share company before mutations |
| Departments, positions, task groups, sponsors | Active company | Writes force the authorized active company |
| Announcements | Active company | Email/WhatsApp recipients must have an exact-company profile/access (or explicit SystemAdmin authority); foreign same-role users are excluded |
| Notifications | Authenticated recipient plus active company | Read/update/delete exclude null/foreign-company notifications; pending approvers are re-scoped to the owned request company and unknown ownership fails closed |
| Dashboard, recent activity, pending/deletion requests | Active company | Counts and detail actions use company-owned workflow objects |
| Employee imports/history | Active company | Import requires context; import row and every created employee receive that company |
| Invites | Active company | Invite creation stores context; acceptance refuses null/inactive/non-company ownership |
| BioTime mappings | Active company | Mapping employee must be in context; database prevents invalid mappings |
| BioTime unmapped device roster | No ordinary company-safe mapping exists | Fail closed except explicit authorized all-company head-office context; cloud UI sync remains disabled and the office agent owns sync |
| Manager/direct reports/delegation | Employee-own/active company | Manager and report/delegate must share a company; foreign detail is denied |
| Payroll, loans, rents | Active company for ordinary lists | Existing role/workflow checks follow company ownership; rent audit/API delivery is JSON-safe |

## Data and bulk-write audit

Reviewed `bulk_create()`, `QuerySet.update()`, `update_or_create()`, raw SQL, import/sync, and scheduled notification paths. The database tests prove that invalid employee, manager, leave request, balance snapshot, balance adjustment, annual payment, and BioTime records cannot be inserted or mutated through bulk/queryset operations.

The read-only command is:

```powershell
python manage.py audit_employee_company_integrity --format json
```

Local development database result on 2026-08-24 (not a production audit):

- null-company profiles: 0
- non-archived null-company profiles: 0
- invalid company profiles: 0
- duplicate employee numbers, national IDs, passport numbers, and exact names: 0
- invalid leave requests/snapshots/adjustments/annual payments/BioTime mappings: 0
- protected deleted IDs present (`FFI-04FACD`, `FFI-183F0F`, `FFI-3E0622`): 0
- Aryam Ahmed Alghamdi rows in this local dataset: 0
- manager-field disagreements: 4 — profile IDs 3 (`FFI-730220`), 4 (`FFI-327686`), 29 (`FFI-910454`), and 33 (`FFI-624590`), all company 2

Migration `employees.0015` intentionally aborts while those four inconsistencies exist. Do not infer the correct manager or company from names. Run the same command on a recent staging copy, identify records using stable IDs and source documents, and produce an approved data-fix plan before migration. Preserve Aryam Ahmed Alghamdi and her attendance history. Do not recreate the three deleted empty records.

## Files in the tenant-isolation change set

Core scope and endpoint enforcement:

- `Backend/organization/services.py`
- `Backend/employees/{models.py,serializers.py,views.py,notifications.py,services/importer.py}`
- `Backend/attendance/{models.py,services.py,views.py,biotime_views.py}`
- `Backend/leaves/{models.py,permissions.py,serializers.py,utils.py,views.py,tasks.py}` (tenant hunks only)
- `Backend/assets/{serializers.py,views.py}`
- `Backend/core/{serializers.py,views.py}`
- `Backend/hr_reference/views.py`
- `Backend/announcements/{utils.py,tests.py}`
- `Backend/in_app_notifications/{integrations.py,views.py,tests.py}`
- `Backend/invites/{models.py,views.py}`
- `Backend/rents/services.py`

Migrations/audit/test configuration:

- `Backend/employees/migrations/{0014_employeeimport_company.py,0015_database_tenant_integrity.py}`
- `Backend/attendance/migrations/0009_biotime_tenant_integrity.py`
- `Backend/invites/migrations/0005_invite_company.py`
- `Backend/leaves/migrations/0017_tenant_integrity.py`
- `Backend/employees/management/commands/audit_employee_company_integrity.py`
- `Backend/pyproject.toml`

Frontend tenant context:

- `FrontEnd/src/auth/{authStore.ts,authStore.test.ts}`
- `FrontEnd/src/services/api/{apiClient.ts,apiClient.test.ts}`
- `FrontEnd/src/layouts/BaseLayout.tsx`
- `FrontEnd/src/stores/attendanceStore.ts`
- `FrontEnd/src/pages/admin/BioTimeSettingsPage.test.tsx`

Tenant-specific regression files:

- `Backend/employees/test_tenant_scoping.py`
- `Backend/employees/test_database_tenant_integrity.py`
- `Backend/leaves/tests/test_tenant_notification_safety.py`

Existing app tests/fixtures were updated to create valid company-owned profiles and reference data in accounts, assets, attendance, core, employee, invite, leave, loan, notification, and rent test modules.

## Separate annual-leave release unit

The following belong to the annual-payment feature and are not part of the tenant-only release:

- `Backend/leaves/migrations/0019_annual_leave_payment.py`
- annual-payment model/serializer/view/URL/task hunks in `Backend/leaves/`
- `Backend/leaves/tests/test_annual_leave_accrual_payment.py`
- `Backend/leaves/tests/test_annual_leave_payment_followup.py`
- annual-payment frontend API, pages, cards, routes, translations, and tests

Migration `0017` contains tenant integrity only; `0018` and `0019` are distinct. Source changes remain interleaved in this uncommitted working tree, so a maintainer must split them into separate commits/PRs (using hunk-level staging for shared leave files) and run both resulting trees independently. Do not deploy this mixed tree.

## Tests and quality gates

Completed evidence:

- Fresh PostgreSQL tenant/DB-integrity/background/annual-focused gate: **33 passed in 237.25s**.
- Account module: **24 passed**.
- Attendance correction + document extraction + invite modules: **33 passed**.
- Rent module after JSON-boundary fix: **6 passed**.
- Final announcement + in-app notification + rent gate: **62 passed, 4 subtests passed in 243.26s**.
- HR-manual/loan/rent focused run reached **39 passed** before exposing the rent JSON issue; the rent module then passed after the fix.
- Frontend BioTime + CEO attendance serial rerun: **19 passed**.
- Frontend type-check: passed.
- Frontend lint: passed with **0 errors, 26 existing warnings**.
- Frontend production build: passed; Vite reports an existing large-chunk warning.
- Complete frontend suite, serial and without backend CPU contention: **50 files passed, 472 tests passed in 770.37s**.
- Complete backend PostgreSQL suite with a freshly rebuilt migrated test database: **423 passed, 8 failed, 19 subtests passed, 4 warnings in 1438.73s**.
- All eight backend failures are confined to `leaves/tests/test_existing.py::LeaveBalanceTests` and reflect the mixed annual contract-cycle feature versus the existing calendar-year accrual/overflow contract:
  - `test_annual_accrual_for_started_months`
  - `test_annual_accrual_starts_from_hire_month`
  - `test_annual_leave_request_can_fall_back_to_unpaid_balance`
  - `test_annual_overflow_consumes_unpaid_balance`
  - `test_annual_remaining_uses_accrued_days_minus_usage`
  - `test_balance_calculation_simple`
  - `test_balance_usage`
  - `test_emergency_availability_uses_accrued_annual_balance`
- Ruff: passed.
- Python `compileall`: passed.
- Django system check: passed.
- `makemigrations --check --dry-run`: no model drift.
- `git diff --check`: passed (line-ending notices only).

The complete frontend gate is green. The complete backend gate is not green, so this mixed working tree remains **NO-GO**. The tenant-specific focused gates and all non-annual tests in the complete backend run passed; that evidence does not authorize production deployment while the eight annual contract failures remain.

## Staging deployment checklist

1. Split tenant isolation, HR-manual, and annual-payment work into independently reviewable commits/PRs. Build the tenant-only artifact first.
2. Snapshot production and restore it to isolated staging. Do not run cleanup against production.
3. Run the read-only audit and archive its JSON report. Confirm the three protected IDs remain absent and locate Aryam by stable identifier; verify her attendance count/history.
4. Manually resolve and review manager-field disagreements in a separately approved data operation. Do not infer company/identity from names.
5. Run `migrate --plan`, apply migrations in staging, and confirm every preflight/trigger installs successfully.
6. Run the complete backend suite against PostgreSQL and the complete frontend type-check/lint/test/build gates.
7. Deploy the backend artifact to staging first. Deploy tenant-context frontend changes only after the backend is healthy.
8. Smoke-test Athroya and Aseco Pro with separate authorized accounts: employees/list/detail/export/count, attendance, leave balances/types, assets/documents, announcements, notifications, dashboard totals, pending/deletion requests, imports/invites, BioTime mappings, and manager/delegation.
9. Attempt each other company's ID via query, header, duplicates, conflicts, malformed/zero/negative/inactive IDs, and direct foreign object URLs. Require 403/404 and unchanged pagination/export totals.
10. Compare sampled leave-balance responses and stored snapshots with the predeployment staging capture.
11. Monitor tenant-denial logs, 403/404 rates, export counts, task failures, and notification recipients before requesting explicit production approval.

## Rollback plan

1. Stop background workers and route traffic back to the previous backend artifact.
2. Prefer leaving additive nullable columns in place; the previous code ignores `EmployeeImport.company_id` and `Invite.company_id`.
3. If schema reversal is required, reverse in dependency order: annual `0019` only if that separate feature was deployed, then `0018`, `leaves.0017`, `attendance.0009`, `invites.0005`, and `employees.0015/0014`. Reversal removes triggers/columns but must not alter employee or leave history.
4. Never restore/recreate the three protected records and never delete/reassign Aryam or attendance data during rollback.
5. Re-run Athroya/Aseco Pro employee, export, attendance, leave-balance, notification, dashboard, and foreign-object smoke tests.
6. Retain audit reports and rejected-write logs for incident review. No leave-balance repair should be run because the tenant migrations contain no balance data migration.
