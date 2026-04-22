# Database Schema Context

Backend: Django 5.2 + PostgreSQL 16. All domain models carry a `company` FK for multi-company scoping.

## Key Models by App

### accounts
- `User` — email-based (no username), `AbstractUser`, role via Django groups (`SystemAdmin`, `HRManager`, `Manager`, `CEO`, `CFO`, `Employee`)
- `LoginAttempt` — tracks failed logins for IP-based lockout (5 failures → 900 s)

### organization
- `OrganizationNode` — tree structure, `node_type` (HEAD_OFFICE|COMPANY), `employee_id_prefix`, `parent` self-FK
- `UserOrganizationAccess` — unique(user, organization); drives per-user data scope

### core
- `WorkflowDefinition` / `WorkflowStageDefinition` — configurable multi-stage approval templates
- `WorkflowInstance` / `WorkflowAction` — runtime instances; each action records actor, decision, timestamp
- `DelegationRule` — temporary role delegation with `valid_from`/`valid_until` date range
- `UserPreference` — per-user UI/notification preferences

### employees
- `EmployeeProfile` — status (ACTIVE/SUSPENDED/TERMINATED), bilingual name (en/ar), `company` FK, document expiry fields (`passport_expiry`, `iqama_expiry`, etc.), `employee_id` with prefix
- `EmployeeImport` — batch import tracking

### hr_reference
- `Department`, `Position`, `TaskGroup`, `Sponsor` — all have `company` FK and `is_active` for soft-delete

### attendance
- `AttendanceRecord` — `employee` FK, `date`, status (PENDING_MGR|PENDING_HR|PENDING_CEO|PRESENT|ABSENT|LATE), `source` (MANUAL|SYSTEM), `check_in`/`check_out`
- `BioTimeConfig` — singleton (only one row); `server_ip`, `port`, `username`, `password`, `last_sync_time`
- `BioTimeEmployeeMap` — `user` FK → `biotime_employee_id`

### leaves
- `LeaveType` — name, max days, carry-over policy, approval tier required
- `LeaveRequest` — `employee` FK, `company` FK, `status` (PENDING→APPROVED/REJECTED), `leave_type` FK, date range, optional attachment

### payroll
- `PayrollRun` — `company` FK, `period_start`/`period_end`, `status` (DRAFT|COMPLETED|PAID|CANCELLED)
- `PayrollRunItem` — per-employee line within a run; salary components
- `Payslip` — generated document linked to PayrollRunItem

### loans
- `LoanRequest` — `employee` FK, `company` FK, `status`, multi-tier approval (Manager→HR→CFO→CEO), installment schedule

### assets
- `Asset` — `asset_type` (VEH/LAP/AST), `code` (auto-generated via `AssetCodeSequence`), `company` FK, `assigned_to` FK
- `AssetDamageReport`, `AssetReturnRequest` — linked to Asset with approval

- `PrintedLabelJob` - label print history with `company`, `created_by`, `asset_count`, `paper_size`, private `pdf_file`, and `asset_codes`.

### rents
- `RentType`, `Rent` — frequency (MONTHLY|ONE_TIME), `company` FK, reminder tracking

### announcements
- `Announcement` — `company` FK, `created_by` FK, optional attachment, `target_users` M2M

### audit
- `AuditLog` — `actor` FK (nullable), `action` (str), `entity` (str), `entity_id` (str), `ip_address`, `metadata` (JSON), `created_at`; indexed on action, entity+entity_id, created_at

### invites
- `Invite` — `email`, `role`, `token` (UUID), `status` (PENDING|ACCEPTED|EXPIRED), `expiry`, `resend_count`

## Schema Rules

- Use explicit model relationships and `db_index` / `unique_together` constraints rather than implicit conventions.
- Any model involving approvals, payroll, attendance, or sensitive employee data must generate `AuditLog` entries.
- Use migrations for all schema changes. Review generated operations before committing — never commit auto-squashed migrations without review.
- Avoid destructive migrations (dropping columns/tables) unless task explicitly calls for it and a migration plan is documented.
- Run focused app tests after schema changes: `cd Backend && pytest <app>/` then `pytest` if blast radius is broad.
