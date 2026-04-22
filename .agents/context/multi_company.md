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

## Frontend Company Switcher

- Located in the main navigation layout
- Updates the `x-active-company-id` stored in frontend state and refetches current page data
- All API service functions in `FrontEnd/src/services/api/` automatically attach the active company header via `apiClient.ts` interceptor
