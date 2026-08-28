# Auth and Permissions Context

## Authentication

- **Type**: JWT via `rest_framework_simplejwt`
- **Access token lifetime**: fixed at 15 minutes; login no longer expands it to the configurable UI session timeout
- **Refresh token lifetime**: 14 days (rotated + blacklisted on use)
- **Login endpoint**: `POST /auth/login` — preserves `data.token`, adds identical `data.access`, and returns rotating `data.refresh`
- **Refresh endpoint**: `POST /auth/refresh` accepts `{refresh}` and returns `token`, `access`, and rotated `refresh`; used/revoked/reused tokens return a generic 401
- **Revocation boundary**: JWTs carry `token_version`; `accounts.authentication.VersionedJWTAuthentication` compares it to `User.auth_token_version`. Tokens missing the claim are rejected.
- **Logout/password change**: increment the account token version, blacklist every outstanding refresh token, emit audit events, and immediately invalidate all prior access/refresh tokens

Frontend `FrontEnd/src/services/api/apiClient.ts` still clears authentication state after a non-login `401`; adding web automatic refresh is a separate client task. Mobile can use the approved refresh contract during Gate 2.

## Rate Limiting / Security

- `LoginRateThrottle`: 10 attempts/min per IP
- Failed login lockout: 5 consecutive failures → 900 s lockout (tracked in `LoginAttempt`). `accounts/security.py::record_login_failure` locks the row with `select_for_update()` inside `transaction.atomic()` — this closes a real race where concurrent failed attempts could under-count and delay the lockout; keep the lock, see `reliability_and_perf_fixes.md`.
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
  "token": "...",
  "access": "...",
  "refresh": "...",
  "user": { ... },
  "accessible_organizations": [...],
  "default_organization_id": "..."
}
```

All subsequent requests carry `x-active-company-id: <org_id>` header. Backend reads this via `organization.services.get_active_organization_for_request(request)`.

## Token Storage

`FrontEnd/src/services/api/tokenStorage.ts` — manages web authentication state in `sessionStorage` and clears legacy localStorage keys on logout. This is not a mobile storage pattern.

Mobile clients must use platform-protected secure storage (Android Keystore/iOS Keychain, for example Expo SecureStore). Server-side permissions, ownership, and organization scoping remain authoritative.

## Realtime

`/ws/notifications/` is intentionally deferred and closes every handshake before acceptance with code `4403`. Notification clients use authenticated REST polling. Do not reintroduce JWT query/header or session WebSocket authentication; a future design requires a reviewed opaque company-bound ticket and connection-lifetime controls.
