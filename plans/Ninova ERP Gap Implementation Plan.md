# Ninova ERP Gap Implementation Plan

## Status Legend

- `done`: already implemented in the current HR system
- `processing`: should start now or is the current execution focus
- `none`: not started yet

## Goal

Close the highest-value gaps between the current HR system and the audited Ninova ERP behavior, starting with the foundations that unlock multiple future modules.

## Priority Principles

1. Build shared workflow and reporting foundations before adding many standalone forms.
2. Deliver HR-adjacent operational value before non-HR enterprise domains.
3. Prefer modules that improve approvals, compliance, payroll readiness, and employee lifecycle control first.
4. Leave procurement, warehouse, fleet, and subcontract domains for later phases unless business asks for them immediately.

## Current Baseline

| Area | Status | Notes |
|---|---|---|
| Accounts | `done` | Exists in current system |
| Employees | `done` | Exists in current system |
| Leaves | `done` | Exists in current system |
| Payroll | `done` | Exists in current system |
| Attendance | `done` | Exists in current system |
| Assets | `done` | Exists in current system |
| Loans | `done` | Exists in current system |
| Announcements | `done` | Exists in current system |
| Rents | `done` | Exists in current system |
| Invites | `done` | Exists in current system |
| Admin Portal | `done` | Exists in current system |
| HR Reference | `done` | Exists in current system |

## Recommended Delivery Timeline

## Phase 1: Foundation And Control Layer
**Timeline:** Weeks 1-4  
**Priority:** Critical  
**Status:** `processing`

### Objectives

- Introduce a reusable approval workflow engine
- Add delegation and approval reassignment support
- Add audit trail and state history
- Add reusable reporting/export foundation
- Add saved filters and saved table preferences

### Scope

| Item | Status | Why First |
|---|---|---|
| Approval workflow engine | `done` | Implemented as shared workflow foundation for leave, loan, and attendance |
| Workflow states (`draft`, `submitted`, `under review`, `approved`, `rejected`, `cancelled`) | `done` | Standardized in the shared workflow layer |
| `waiting_for` actor / role tracking | `done` | Implemented through current stage / approver role / actor snapshot fields |
| Approval comments and action log | `done` | Implemented through workflow history and action records |
| Delegation module | `done` | CRUD, role-aware reassignment, email notifications, and Docker-verified approval delegation are implemented |
| Audit trail across requests | `done` | Workflow actions now emit audit events and structured history |
| Reusable export layer (Excel first) | `none` | Still pending |
| Saved table filters / columns | `none` | Still pending |
| Dashboard pending-task widgets by role | `done` | HR summary now reads workflow-backed pending approvals |

### Deliverables

- shared approval tables/models and APIs
- role-based approval routing
- delegation rules
- unified activity timeline component
- export utilities
- per-user table preferences

## Phase 2: HR Operations Expansion
**Timeline:** Weeks 5-8  
**Priority:** Critical  
**Status:** `none`

### Objectives

- Expand HR beyond basic leave/payroll/attendance
- Cover operational HR workflows that frequently trigger approvals

### Scope

| Item | Status | Why Important |
|---|---|---|
| Attendance correction requests | `none` | Common HR/manager workflow |
| Employee transfer requests | `none` | Important for multi-project organizations |
| Document renewal requests | `none` | Strong compliance value |
| Joining forms / onboarding workflow | `none` | Improves employee onboarding control |
| Clearance forms / offboarding workflow | `none` | Important for exit control |
| Resignation requests | `none` | Formalizes employee exits |
| Termination requests | `none` | Required for controlled HR actions |
| Notice / warning letters | `none` | Improves disciplinary workflow |
| Task groups | `none` | Links employees to operational assignments |
| Accommodations | `none` | Important for construction/field workforce |
| Sponsors | `none` | Important for visa/work-permit management |

### Deliverables

- new HR request models and screens
- approval routing per request type
- employee lifecycle transitions
- HR dashboard for pending operational requests

## Phase 3: Compensation And Payroll Enhancements
**Timeline:** Weeks 9-12  
**Priority:** High  
**Status:** `none`

### Objectives

- Bring payroll-adjacent workflows closer to enterprise level
- Separate payroll operations from payroll reference data

### Scope

| Item | Status | Why Important |
|---|---|---|
| Payslip module | `none` | Direct employee/payroll output |
| Salary increment requests | `none` | High-value approval workflow |
| Salary reconciliation requests | `none` | Important for correction/control |
| Salary reorganization requests | `none` | Needed for structure changes |
| Cash advance requests | `none` | Common HR-finance workflow |
| Bonus vouchers | `none` | Compensation operations |
| Encashment requests | `none` | HR/payroll workflow gap |
| Salary certificate report | `none` | Explicitly seen in Ninova reports |
| Salary summary report | `none` | Important for management review |
| Employee total cost report | `none` | Important for finance and leadership |

### Deliverables

- compensation request workflows
- payroll document outputs
- finance-visible compensation approval logs
- payroll and salary reports

## Phase 4: Recruitment Pipeline
**Timeline:** Weeks 13-16  
**Priority:** High  
**Status:** `none`

### Objectives

- Replace basic hiring support with a true recruitment pipeline

### Scope

| Item | Status | Why Important |
|---|---|---|
| Vacancies / job log | `none` | Pipeline entry point |
| Job applications | `none` | Candidate tracking |
| Candidate shortlist | `none` | Screening stage |
| Hiring requests | `none` | Internal approval step |
| Job offers | `none` | Pre-onboarding stage |
| Recruitment analytics | `none` | Hiring visibility |

### Deliverables

- vacancy lifecycle
- applicant records and statuses
- shortlist workflow
- job offer approval and acceptance tracking

## Phase 5: Compliance, Expiry, And Smart Validation
**Timeline:** Weeks 17-18  
**Priority:** High  
**Status:** `none`

### Objectives

- Add proactive checks that block invalid workflows

### Scope

| Item | Status | Why Important |
|---|---|---|
| ID expiry validation against leave dates | `none` | Seen in Ninova leave workflow |
| Passport / health card expiry warnings | `none` | Compliance-critical |
| Payroll configuration validation | `none` | Prevents incomplete payroll runs |
| Employee readiness checks for onboarding/payroll | `none` | Improves data quality |
| Request-level warning banners | `none` | Better user guidance |

## Phase 6: Reporting Layer Completion
**Timeline:** Weeks 19-20  
**Priority:** Medium  
**Status:** `none`

### Objectives

- Standardize analytics and reporting across modules

### Scope

| Item | Status | Why Important |
|---|---|---|
| Report modal pattern per module | `none` | Reusable UX pattern |
| Excel export on all major logs | `none` | Expected enterprise behavior |
| Aggregate totals on employee/payroll/loan/asset logs | `none` | Management visibility |
| Role-based dashboard summaries | `none` | Better executive monitoring |
| Saved report presets | `none` | Speeds repeated use |

## Phase 7: Enterprise Expansion Beyond HR
**Timeline:** Weeks 21-30  
**Priority:** Medium  
**Status:** `none`

### Scope

| Item | Status | Notes |
|---|---|---|
| Procurement | `none` | ISR, LPO, tender, materials library, petty cash |
| Warehouse | `none` | Stock, transfers, SIV, stores, fixed asset materials |
| Project Mgmt | `none` | Project log, scopes, collections |
| Finance extensions | `none` | Wallets, supplier credit/debt, banking, payments |
| Fleet Mgmt | `none` | Driver, maintenance, vehicle |
| Subcontract Mgmt | `none` | Requests, variations, payment certificates |

## Deferred Items

| Item | Status | Notes |
|---|---|---|
| Digital signature | `none` | Deferred for now, not critical to the first implementation wave |

## Important First Build Order

If you want the shortest path to high enterprise value, build in this exact order:

1. Approval workflow engine
2. Delegation
3. Audit trail and action history
4. Saved filters / columns / exports
5. Attendance correction
6. Document renewal
7. Clearance / resignation / termination
8. Salary increment / reconciliation / reorganization
9. Payslip + salary reports
10. Recruitment pipeline

## Suggested Ownership

| Track | Owner |
|---|---|
| Workflow engine + audit trail | Backend + Frontend shared team |
| HR operations forms | HR product team |
| Payroll enhancements | Backend payroll team + finance stakeholders |
| Reporting/export layer | Shared platform team |
| Recruitment pipeline | HR product team |
| Enterprise non-HR domains | Separate phase after HR stabilization |

## Completion Definition

A phase should move from `none` to `processing` only when:

- requirements are written
- database changes are identified
- API routes are agreed
- screens are listed
- approval rules are defined

A phase should move from `processing` to `done` only when:

- backend APIs are complete
- frontend screens are complete
- permissions are enforced
- exports work
- tests are added
- user acceptance is completed

## Next Execution Recommendation

Start immediately with:

- Phase 1 `Audit trail`
- Phase 1 `Export and saved table preferences`

Then move directly into:

- Phase 2 `Attendance correction`
- Phase 2 `Document renewal`
- Phase 2 `Clearance / resignation / termination`
