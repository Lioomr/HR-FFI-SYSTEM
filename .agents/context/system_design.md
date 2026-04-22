# System Design Context

> **TL;DR:** Django 5.2 + DRF + PostgreSQL 16 backend, React 18 + TS + Vite + AntD frontend, JWT auth (15 min access / 14 day refresh), bilingual en/ar, multi-company via `x-active-company-id` header + `filter_queryset_by_company_scope`. 14 backend apps (accounts, admin_portal, organization, core, employees, hr_reference, attendance, leaves, payroll, loans, assets, rents, announcements, audit, invites). Cross-cutting: multi-company scoping, workflow engine (`core`), audit trail (`audit.utils.audit`), private uploads, BioTime sync, i18n hook. Source-of-truth files live in `plans/`.

FFI HR System is a **Django 5.2 REST + React TypeScript** multi-company HR platform.

## Stack

| Layer | Tech |
|---|---|
| Backend | Django 5.2, Django REST Framework, PostgreSQL 16 |
| Auth | JWT via `rest_framework_simplejwt` (15 min access / 14 day refresh) |
| Frontend | React 18, TypeScript, Vite, Ant Design, React Router, Zustand, Axios |
| i18n | Full bilingual en/ar via `FrontEnd/src/i18n/translations.ts` |
| Tests | Backend: pytest + django; Frontend: Vitest + Testing Library |
| Infra | Docker Compose (db/backend/frontend services), optional production variant |

## Backend Domain Apps (14)

| App | Core responsibility |
|---|---|
| `accounts` | Custom email-based User, JWT login, login throttling, lockout |
| `admin_portal` | SystemSettings, admin-only user/invite management |
| `organization` | OrganizationNode tree (HEAD_OFFICE/COMPANY), UserOrganizationAccess |
| `core` | Shared workflow engine (WorkflowDefinition/Stage/Instance/Action), DelegationRule, UserPreference |
| `employees` | EmployeeProfile lifecycle (ACTIVE/SUSPENDED/TERMINATED), bilingual fields, document expiry |
| `hr_reference` | Department, Position, TaskGroup, Sponsor — multi-company reference data |
| `attendance` | AttendanceRecord, BioTimeConfig singleton, BioTimeEmployeeMap, sync service |
| `leaves` | LeaveType, LeaveRequest with multi-tier approval and quota tracking |
| `payroll` | PayrollRun (DRAFT→COMPLETED→PAID→CANCELLED), PayrollRunItem, Payslip |
| `loans` | LoanRequest, multi-tier (Manager→HR→CFO→CEO), installment tracking |
| `assets` | Asset (type codes VEH/LAP/AST), damage reports, return requests |
| `rents` | Rent, RentType — monthly/one-time, company-scoped |
| `announcements` | Announcement — company-scoped, optional attachments |
| `audit` | AuditLog — actor/action/entity/ip/metadata for compliance |
| `invites` | Token-based user invitations with expiry and resend tracking |

## Key Cross-Cutting Concerns

- **Multi-company scoping**: every data model carries a `company` FK; requests pass `x-active-company-id` header; `organization/services.py` provides `filter_queryset_by_company_scope`.
- **Approval workflows**: `core` app drives Leave, Loan, Asset flows through configurable stages (Employee→Manager→HR→CEO). Delegation rules allow temporary reassignment.
- **Audit trail**: `audit.utils.audit(request, action, entity, metadata)` must be called at all sensitive actions (approvals, payroll finalization, employee changes).
- **BioTime sync**: attendance records are pulled from ZKTeco BioTime 8.5 via `attendance/biotime_client.py` and `sync_biotime` management command.
- **Private uploads**: sensitive files (passports, leave docs, invoices) go to `Backend/private_uploads/` — never served directly.
- **i18n**: all user-facing frontend strings must use `useI18n` hook; `translations.ts` is the single source.

## Source of Truth Files

- API contract: `plans/Global API Rules (v1).txt`
- Screen specs: `plans/HR Manager — Screen Specs (v1).txt`, `plans/Employee (Self-Service) — Screen Specs (v1).txt`, `plans/System Admin — Screen Specs (v1).txt`
- Architecture: `system_architecture_overview.md`, `Diagrams/`
- Delivery plan: `plans/Ninova ERP Gap Implementation Plan.md`
- Threat model: `plans/Threat Model Rules .txt`
- API collections: `postman/`

When implementation and plans disagree, identify the mismatch instead of silently reshaping behavior.
