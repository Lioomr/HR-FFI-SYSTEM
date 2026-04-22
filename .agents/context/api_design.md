# API Design Context

Source contract: `plans/Global API Rules (v1).txt` — this file is authoritative for endpoint names and request/response shapes.

## URL Routing Overview

All endpoints live under the root Django router. Key prefixes:

| Prefix | Domain |
|---|---|
| `/auth/` | login, logout, refresh, change-password |
| `/users/`, `/invites/` | user management (SystemAdmin) |
| `/audit-logs/` | audit log read + export (SystemAdmin) |
| `/employees/`, `/departments/`, `/positions/`, `/task-groups/`, `/sponsors/` | HR data |
| `/leave-types/`, `/leave-requests/`, `/leave-balances/` | leave management |
| `/payroll-runs/`, `/payslips/` | payroll |
| `/loan-requests/` | loans |
| `/assets/` | assets |
| `/attendance/`, `/biotime/` | attendance + BioTime sync |
| `/announcements/` | announcements |
| `/rents/`, `/rent-types/` | rents |
| `/api/core/` | workflow delegation, preferences |
| `/api/hr/` | HR summary, recent activity |

## Response Envelope

All responses follow the envelope defined in `plans/Global API Rules (v1).txt`:
```json
{ "data": ..., "message": "...", "status": "success" | "error" }
```
Errors:
```json
{ "error": "...", "detail": "...", "field_errors": { "field": ["msg"] } }
```

## Pagination

Standard DRF pagination for list endpoints:
```json
{ "count": 100, "next": "...", "previous": "...", "results": [...] }
```

## Multi-Company Header

Every request from an authenticated user includes:
```
x-active-company-id: <organization_id>
```
Backend reads this to scope querysets. This header is listed in `CORS_ALLOW_HEADERS`.

## Throttling

Applied per view — do not remove without checking impact:
- `LoginRateThrottle` on `/auth/login` (10/min)
- `EmployeeImportThrottle` on import endpoints (5/min)
- `PayrollThrottle` variants on payroll run operations

## API Change Rules

Before changing any API behavior:
1. Check `plans/Global API Rules (v1).txt` for the spec.
2. Inspect serializers, views/viewsets, URL routing, permissions, and tests for the target app.
3. If renaming a public route, add a compatibility route and note deprecation in the PR.
4. Add/update backend tests for any behavior change.
5. Document deviations from the plan in the PR description and update the plan file.

## Naming Conventions

- Path segments: kebab-case, plural nouns (`leave-requests`, `payroll-runs`)
- Consistent prefix per module — never mix prefixed and unprefixed variants for the same resource
- Custom actions on ViewSets: `@action(detail=True/False, methods=[...])` with descriptive names
