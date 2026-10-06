# Multi-Company (Workspace) Context

FFI HR System supports multiple companies under a single deployment using `OrganizationNode` tree scoping.

## Data Model

**`OrganizationNode`** (`Backend/organization/models.py`):
- `code` (unique), `name`, `node_type` (HEAD_OFFICE | COMPANY)
- `parent` self-FK — HEAD_OFFICE is the root; COMPANY nodes are children
- `employee_id_prefix` — prefix for auto-generated employee IDs per company
- `is_active`

**`UserOrganizationAccess`**:
- `unique(user, organization)` — each row grants a user access to one company
- SystemAdmin users typically have access to all companies

## Request Scoping

Every HTTP request carries `x-active-company-id: <org_id>` header (set by frontend after login).

Backend reads it via:
```python
from organization.services import get_active_organization_for_request
company = get_active_organization_for_request(request)
```

**Key service functions** (`Backend/organization/services.py`):
- `get_active_organization_for_request(request)` — returns active OrganizationNode from header
- `get_user_accessible_organizations(user)` — list of orgs user can access
- `get_default_organization_for_user(user)` — fallback org for initial load
- `filter_queryset_by_company_scope(qs, user, company_field='company')` — filters queryset to user's accessible companies
- `user_has_all_company_access(user)` — True for SystemAdmin-level access

## Login Response

```json
{
  "access": "...",
  "refresh": "...",
  "user": { ... },
  "accessible_organizations": [{ "id": 1, "name": "...", "code": "..." }],
  "default_organization_id": 1
}
```

Frontend stores `x-active-company-id` and sends it on every request. Company switcher in the UI updates the active company without re-login.

## Rules for Multi-Company Work

- **Every querySet for company-scoped data must be filtered** by company scope. Use `filter_queryset_by_company_scope` rather than raw `.filter(company=...)` to respect multi-company access.
- **Never expose data across company boundaries** — a Manager at Company A must not see Company B's employees, leaves, or payroll.
- **SystemAdmin can access all companies** — `user_has_all_company_access(user)` returns True; do not apply company filter for them unless the task requires it.
- New domain models that hold company-specific data **must include a `company` FK** to `OrganizationNode`.
- Migrations adding a `company` FK to an existing table with data require a nullable migration first, then a data migration, then enforce NOT NULL — document this sequence.
- HR reference data (`Department`, `Position`, `TaskGroup`, `Sponsor`) is also company-scoped.
- `employee_id_prefix` on OrganizationNode is used when generating `EmployeeProfile.employee_id` — respect it on employee creation.

- **Never calculate employee-facing balances from all active `LeaveType` rows** - this leaks policy rows from other companies and duplicates seeded company-specific leave types such as `BUSINESS_TRIP`. Use the employee profile's company, prefer company-specific leave types, and fall back to global (`company = null`) types only when that company has no matching code.

## Managers Across Companies

- An employee has exactly one manager or none. A same-company manager is `EmployeeProfile.manager_profile`; a manager from another company is the one active `core.CrossCompanyManagerAssignment` (partial unique index on `employee`). Assignments never expire (no `end_at`) and carry every manager capability.
- Write managers only through `employees.services.manager_relationships.set_employee_manager`. Read the displayed manager with `get_effective_manager_profile` (cross-company wins over a leftover direct link). Filter "in force" assignments with `current_cross_company_assignments()`.
- Never expose the manager's company or any expiry to employees. The HR picker is `GET /api/employees/manager-options/`.
- `manage.py consolidate_manager_relationships` (dry run; `--apply` writes) fixes legacy duplicates and direct+cross pairs, widens every assignment to the full capability set, and moves open contract ratings to the current manager.
- Capabilities: `employees.view`, `leaves.approve`, `attendance.approve`, `loans.approve`, `assets.approve`, `announcements.manage`, `permission_requests.approve`, `contract_ratings.rate`. Adding one needs a core migration that widens the `ffi_validate_cross_company_manager_capabilities` trigger and grants it to active rows (see `core.0014`). Every cross-company read/decision names its capability; `manager_scope_q`/`has_manager_access`/`get_valid_manager_user`/`manager_approval_actor_source` without one never cross a company.
- A manager reaches their own reports without `X-Organization-Scope-Id`: query the request/employee model unscoped and filter with `manager_scope_q(user, ..., cross_company_capability=...)` (it already limits same-company reports to the manager's own company), as the leave, loan, attendance, permission-request, contract-rating and manager-team views do. Show a manager's report through `ManagerTeamMemberSerializer` (no company fields) when the report is in another company.
- Notifications to a manager from another company: use `notification_company_for_recipient` / `notification_company_id_for_recipient` (`in_app_notifications.services`) so the row and `?company=` link use the manager's own company; `notify_users_for_pending_status` does this and admits the requester's own cross-company manager.
- Open contract ratings (manager response not submitted, not decided/cancelled) follow the employee's current manager: `set_employee_manager` and the importer re-point `manager_at_creation`.

## Frontend Company Switcher

- Located in the main navigation layout
- Updates the `x-active-company-id` stored in frontend state and refetches current page data
- All API service functions in `FrontEnd/src/services/api/` automatically attach the active company header via `apiClient.ts` interceptor

## Main Head Office Context

`Main Head Office` (`node_type = head_office`) is not a company. Strict company-scoped endpoints (`filter_queryset_by_active_company`) answer 403 "Select an active company for this request." in head-office context by design (Tenant Isolation Security Review 2026-08-24); there is no aggregate head-office view.

The frontend handles this once, in `BaseLayout`: when head office is active and `pageNeedsCompany(pathname)` (`FrontEnd/src/utils/organizationContext.ts`) is true, it renders `HeadOfficeCompanyPicker` instead of the page, so users see "Choose a company" rather than a misleading 403. Notification polling is paused in head office for the same reason. When a page is made to work in head-office context, add its path to `HEAD_OFFICE_PATHS`.

### Head-office defaults and announcements

- `get_default_organization_for_user` returns Main Head Office for `HRManager` and `CEO` users who have access to it (`HEAD_OFFICE_DEFAULT_ROLES`), so they land on the company picker after login. Other roles still start in their first company.
- Announcements are the one write allowed in head-office context. A SystemAdmin/HRManager/CEO posting from Main Head Office creates one ordinary `whole_company` announcement per accessible company, all sharing `Announcement.broadcast_id`. Employees only ever see their own company's copy.
- Notifications for a broadcast use the dedup key `announcement.broadcast:<broadcast_id>`, so people who are recipients in several companies (HR, CEO via `UserOrganizationAccess`) get one in-app notification, email and WhatsApp in total.
- In head office, the announcement list shows one row per broadcast (`broadcast_company_names`). Edit and delete apply to every copy and are only allowed from head office; a company-context edit or delete of a broadcast copy returns 422. Selected employees, role targets and WhatsApp groups are refused for broadcasts because they are per company.
