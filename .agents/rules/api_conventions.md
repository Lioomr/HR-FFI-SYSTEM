# API Conventions

Source contract: `plans/Global API Rules (v1).txt` — authoritative for endpoint names and shapes.

## Naming

- Path segments: kebab-case, plural nouns (`leave-requests`, `payroll-runs`, `biotime/employee-map`)
- One consistent prefix per module — never mix prefixed and unprefixed variants for the same resource
- Custom ViewSet actions: descriptive `@action` names (`test_connection`, `sync`, `export`)

## Response Envelope

Success:
```json
{ "data": ..., "message": "...", "status": "success" }
```
Error:
```json
{ "error": "...", "detail": "...", "field_errors": { "field": ["msg"] } }
```
List (paginated):
```json
{ "count": 100, "next": "...", "previous": "...", "results": [...] }
```

## Multi-Company Header

Authenticated requests carry `x-active-company-id: <org_id>`. Backend must read and validate it on every company-scoped endpoint. This header is listed in `CORS_ALLOW_HEADERS`.

## Throttling

Do not remove these without checking blast radius:
- `LoginRateThrottle` on `/auth/login` (10/min)
- `EmployeeImportThrottle` on import endpoints (5/min)
- `PayrollThrottle` variants on payroll operations

## Change Rules

1. Check `plans/Global API Rules (v1).txt` before changing any endpoint shape.
2. If renaming a public route, add a compatibility route and note deprecation in the PR.
3. Add/update backend tests for all behavior changes.
4. Document deviations in the PR description and update the plan file.

## PR Notes for API Changes

Include:
- Endpoint paths changed or added
- Request/response shape delta
- Permission class used
- Plan deviation note (if any)
- Migration required (if any)
