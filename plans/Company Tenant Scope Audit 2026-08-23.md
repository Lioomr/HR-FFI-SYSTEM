# Company/Tenant Scope Audit — 2026-08-23

> Superseded by `Tenant Isolation Security Review 2026-08-24.md`, which includes the database-trigger phase, current migration preflight findings, and final release gates.

## Outcome

Company-sensitive list queries now default to one authorized active company and never include `company_id IS NULL` rows. A `company_id` query parameter or `X-Active-Company-Id` header selects context only after the requested organization has been validated against the authenticated user's accessible organizations.

The production database was not modified. The only new migration is a nullable, data-preserving `EmployeeImport.company` foreign key. No employee, leave balance, leave request, attendance, or historical record is updated by that migration.

## Root cause

The immediate leak was `EmployeeProfileViewSet.get_queryset()` unioning the active-company queryset with `company__isnull=True`. The shared organization helpers also treated null-company rows as a default compatibility scope, silently fell back after invalid company selectors, granted unassigned HR users implicit FFI/head-office access, and let head-office context expand ordinary list endpoints.

Additional audit findings included null-company notification visibility, unscoped HR deletion/import history paths, cross-company leave/delegation candidates, leave balance lookups that did not always start from the scoped employee profile, and BioTime mappings without model-level company validation.

## Scope policy

- `filter_queryset_by_active_company()`: strict one-company list and object scope; never includes null rows.
- `filter_queryset_by_accessible_companies()`: explicit SystemAdmin/HR multi-company workflow only; never includes null rows. A company context still narrows to one company; expansion requires an authorized head-office context.
- `filter_queryset_by_employee_own_company()`: employee/manager/CEO scope tied to the authenticated employee profile's company.
- Invalid, blank, inactive, or unauthorized selectors return 403. Selectors are not authorization grants.
- HR users receive only explicitly assigned organization access. System administrators retain explicit all-company capability.

## Endpoint scope matrix

| Area | List/read scope | Object/write enforcement |
|---|---|---|
| Employees, detail, export, expiry | Active company only | Detail/actions use a scoped queryset; null-company employees are hidden |
| Employee documents | Parent employee in active company | Document company must equal parent employee company |
| Attendance and corrections | Employee profile's active company | Existing manager/HR/CEO permissions run after company scope |
| Leave requests and delegated views | Active company or employee-own company | New requests derive company from `employee_profile`; employee/request/type/delegate must match |
| Leave balances, types, adjustments, snapshots | Employee resolved inside active company; types exact employee company | Cross-company type, employee, snapshot, and adjustment combinations are rejected |
| Assets, assignments, return workflows, label jobs | Active company | Employee assignment and locked object queries are active-company scoped |
| Departments, positions, task groups, sponsors | Active company | Writes force the authorized active company |
| Announcements | Active company | Targets and manager teams are scoped before role/target filtering |
| Notifications | Recipient plus active company | Null-company and foreign-company notifications are excluded from read/update actions |
| HR dashboard, recent activity, pending requests | Active company | Totals and workflow objects are checked against the active company |
| Employee deletion requests | Active company list | Explicit authorized detail workflows use accessible-company scope |
| Employee import/history | Active company | Import requires an active company and stores it on both import audit and employees |
| BioTime mappings/sync | Employee's active company | Mapping save rejects null, archived, inactive-company, and cross-company employees |
| Manager teams and delegation candidates/rules | Active/employee-own company | Employee `scope=all` is rejected; from/to users and reports must share a company |

## Integrity and leave-balance protections

- Normal creation of a non-archived `EmployeeProfile` runs model validation and requires an active company organization node.
- Archived legacy profiles may remain without a company.
- Manager/direct-report relationships are validated as same-company relationships.
- BioTime mappings run model validation on save; sync ignores mappings whose employee company is missing, inactive, or not a company node.
- New leave requests copy `employee_profile` and company deterministically from the linked user profile when omitted, then validate company consistency.
- Balance calculations return no company data without a company-backed employee profile, select leave types only from that profile's company, and restrict requests/adjustments to the same company.
- No balance, snapshot, adjustment, or historical leave row is rewritten by this change.

## Migration and data audit

Migration `employees.0014_employeeimport_company` adds a nullable `EmployeeImport.company` foreign key. It is nullable so existing import history is preserved and deployment does not infer a company from names or filenames. New imports always populate the field.

The read-only command is:

```powershell
python manage.py audit_employee_company_integrity --format json
```

Local database result, rechecked on 2026-08-24:

- Null-company profiles: 0
- Non-archived null-company profiles: 0
- Duplicate employee numbers, national IDs, passport numbers, or exact names: 0
- Protected deleted IDs present (`FFI-04FACD`, `FFI-183F0F`, `FFI-3E0622`): 0
- Aryam Ahmed Alghamdi rows in this local dataset: 0

The local result is not a production audit. Before any cleanup or future NOT NULL/check constraint, run the command against a production snapshot or staging copy, manually review identity matches, and verify Aryam Ahmed Alghamdi's attendance count. Never infer company from name alone. Do not recreate the three protected deleted IDs.

## Verification

- Dedicated tenant regression suite: 13 passed on a freshly recreated test database.
- Across all impacted modules, 220 tests have passing evidence across module runs and focused reruns, plus 11 parameterized subtests. This total includes the 13 dedicated tenant regressions and covers employee, manager, document, work-license, attendance, leave, asset, reference, announcement, notification, dashboard, delegation, and pending workflows.
- `ruff check`: passed for every changed Python implementation and test file.
- `python manage.py check`: passed with no issues.
- `python manage.py makemigrations --check --dry-run`: no model drift.
- `python manage.py migrate employees 0014 --plan`: only `employees.0014_employeeimport_company` is planned; it was not applied locally or to production.
- `git diff --check`: passed; Windows line-ending notices are informational.

The full repository test suite was not run. Staging must still run the complete backend suite before deployment, including unrelated payroll, loan, messaging, and annual-leave-payment modules.

## Deployment

1. Take a database snapshot and run the read-only audit command in staging against a recent production copy.
2. Confirm the three protected IDs remain absent and identify Aryam Ahmed Alghamdi by stable identifiers; verify her attendance history before approving any cleanup plan.
3. Deploy the backend to staging and apply `employees.0014_employeeimport_company`. Do not run a data cleanup migration.
4. Run Django checks, migration drift checks, the tenant regression suite, and relevant employee/attendance/asset/leave/dashboard/notification suites.
5. Smoke-test Athroya and Aseco Pro with separate HR accounts: employee list/detail/export/count, attendance, assets/documents, leave balances, notifications, and dashboard totals. Try the other company's ID in both query parameter and header and require 403.
6. Deploy the backend first. No frontend change is required for the scoping fix; deploy frontend only for separately reviewed frontend work.
7. Repeat Athroya/Aseco Pro smoke tests and monitor 403/404 rates, employee export counts, and leave-balance responses.

## Rollback

1. Roll back the backend application to the previous release while leaving the nullable `EmployeeImport.company_id` column in place; this is the safest rollback and is backward-compatible.
2. If the schema must be reversed, first export any `EmployeeImport` rows created after deployment, then reverse only `employees.0014`. Reversal drops the new import-company values.
3. Do not restore, recreate, reassign, or delete employee/leave data as part of rollback. No balance repair is required because this release performs no balance data migration.
4. Re-run Athroya/Aseco Pro list, export, attendance, notification, dashboard, and leave-balance checks after rollback.
