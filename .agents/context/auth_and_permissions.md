# Auth and Permissions Context

## Authentication

- **Type**: JWT via `rest_framework_simplejwt`
- **Access token lifetime**: 15 minutes
- **Refresh token lifetime**: 14 days (rotated + blacklisted on use)
- **Login endpoint**: `POST /auth/login` — returns `access` + `refresh` tokens
- **Refresh endpoint**: `POST /auth/refresh`
- **Logout**: blacklists refresh token

Frontend `FrontEnd/src/services/api/apiClient.ts` auto-refreshes tokens before expiry using an Axios interceptor.

## Rate Limiting / Security

- `LoginRateThrottle`: 10 attempts/min per IP
- Failed login lockout: 5 consecutive failures → 900 s lockout (tracked in `LoginAttempt`)
- `EmployeeImportThrottle`: 5 imports/min
- `PayrollThrottle` variants for payroll run operations

## User Roles (Django Groups)

| Role | Capabilities |
|---|---|
| `SystemAdmin` | Full system: users, invites, settings, audit logs, BioTime config |
| `HRManager` | Employee management, payroll, leave/loan approvals, HR reference data |
| `CFO` | Loan financial approval (CFO stage), payroll oversight |
| `CEO` | Final approval authority for leaves, loans, assets; CEO dashboard |
| `Manager` | Team leave/loan pre-approval, team view, team announcements |
| `Employee` | Self-service: profile, payslips, leave/loan/asset requests, announcements |

Role resolution: `accounts.utils.get_role(user)` reads `user.groups` — one user can belong to multiple groups; priority order enforced in `get_role`.

## Permission Classes (Backend)

Key DRF permission classes in `accounts/permissions.py`:
- `IsSystemAdmin` — role == SystemAdmin
- `IsHRManagerOrAdmin` — role in (HRManager, SystemAdmin)
- `IsManager` — role == Manager (or higher)
- `IsCEO` — role == CEO
- `IsCFO` — role == CFO
- `IsDepartmentCEOApprover` — user has CEO-approver flag for their dept
- `IsHRWorkflowApprover` — user is designated HR workflow approver

**Rule**: Never trust frontend role checks. All permission enforcement must be server-side. Frontend role guards exist only for UX — they are not security boundaries.

## Frontend Route Guards

`FrontEnd/src/routes/routes.tsx` wraps routes with:
- `RequireAuth` — redirects to login if no valid JWT
- `RequireRole(role)` — shows 403 if user role doesn't match
- `RequireCEOApprover`, `RequireCFOApprover`, `RequireFinanceApprover` — specialized approver role checks
- `RouteErrorBoundary` — catches render errors per route

## ViewSet Action Permissions

When a ViewSet overrides `get_permissions()`, every custom `@action` must be listed there even if the action decorator has `permission_classes`. **Never rely on the decorator alone in a ViewSet with custom `get_permissions()`** - otherwise lightweight access probes such as `employees/manager/access` can accidentally fall through to stricter default permissions and hide valid role-based UI.

## Multi-Company Auth Flow

Login response includes:
```json
{
  "access": "...",
  "refresh": "...",
  "user": { ... },
  "accessible_organizations": [...],
  "default_organization_id": "..."
}
```

All subsequent requests carry `x-active-company-id: <org_id>` header. Backend reads this via `organization.services.get_active_organization_for_request(request)`.

## Token Storage

`FrontEnd/src/services/api/tokenStorage.ts` — manages access/refresh tokens in localStorage. Always clear on logout.
