# Backend Tenant Scope Handoff

**Prepared:** 2026-08-24 (Asia/Riyadh)
**Release state:** **NO-GO — frontend implementation must not begin.** Local/staging work only. The local database correctly refuses `employees.0015` until the four known manager-field discrepancies are approved and resolved through a separate data-fix plan; the requested complete PostgreSQL suite also remains blocked until the unrelated annual-payment work is split out.

## Final data model

- `EmployeeProfile.company_id` remains the sole owner for every active employee. It always references one active `COMPANY`; organization scopes never change it.
- `OrganizationScope` is an explicit approved organization grouping. `OrganizationScopeMembership` contains active `COMPANY` nodes only and prevents duplicate membership.
- `DelegationRule` is an auditable, revocable, time-bounded delegation grant. `capabilities` is explicit (`workflow.approve`, `employees.read`); `scope`, `revoked_at`, and `revoked_by` make a cross-company grant finite and attributable.
- `CrossCompanyManagerAssignment` is the only exceptional cross-company manager relationship. It stores employee, manager profile, approved scope, time window, creator, revocation metadata, and an explicit capability list. It never writes `EmployeeProfile.manager_profile` or `manager`.
- Leave requests, balances, snapshots, adjustments, payroll, documents, and history retain their existing employee-company ownership. `LeaveRequest.delegated_to` is still same-company only.

PostgreSQL triggers protect scope membership, scope activation state, cross-company grants, cross-company manager assignments, revocation state, time windows, company membership, active profiles/users, reporting cycles, and automatic revocation after an assigned employee/manager or delegation participant is archived, made inactive, moved to another company, relinked to another user, or has their login disabled. Active scope membership cannot be inserted, updated, or deleted while an active grant/assignment references the scope; a membership `scope_id` move validates both its old and new scopes, so it cannot remove a company from a protected source scope. A scope also cannot be deactivated or reactivated while it has an active reference; revoke and explicitly re-approve first. Every active `employees.read` grant, including same-company grants, requires a non-null active scope. Existing employee/reference/leave/BioTime triggers remain authoritative for bulk updates and raw SQL.

## Authorization and effective scope resolution

1. The server parses `company_id` and `X-Active-Company-Id` once. Duplicate, blank, malformed, zero, negative, inactive, unauthorized, or conflicting values return **403**.
2. The server independently parses `organization_scope_id` and `X-Organization-Scope-Id`. Duplicate or conflicting values return **403**. A supplied company must be a member of the requested scope or it returns **403**.
3. Query/header selectors are context only; they never grant authority.
4. Normal HR/SystemAdmin routes use the existing active-company scope. Normal employees/managers remain limited to their own company and valid direct reports.
5. A user selecting an organization scope must have an active, unexpired, non-revoked `employees.read` delegation grant for that exact scope, or a current exceptional manager assignment containing `employees.view`. Inactive users/profiles and inactive scopes fail closed with **403**.
6. `employees.read` returns employees only in the scope’s currently active companies. A selected member company narrows the result to that company.
7. Exceptional manager team access returns only the specifically assigned reports, inside the selected approved scope. It does not create a general cross-company employee list permission or any approval authority.
8. Delegated employee list/detail and manager-team responses use the restricted scoped serializer. Its allow-list excludes contact data, passport/national ID, health card, compensation, documents, leave balances/history, payroll, archival/audit metadata, and timestamps. Scoped document routes are explicitly forbidden.
9. Cross-company manager approval is separately capability-gated: `leaves.approve`, `attendance.approve`, `loans.approve`, `assets.approve`, and `announcements.manage`. `employees.view` is visibility only.
10. A cross-company path is never enabled by an unspecified capability. Calls to `manager_scope_q` and `has_manager_access` without one preserve direct/delegated same-company behavior only.

## API contract

All responses use the existing `{status, data}` envelope.

| Method and route | Authorization | Contract |
|---|---|---|
| `GET /api/core/organization-scopes/` | SystemAdmin: audit scope; HRManager: scopes entirely within their authorized companies; delegate/exception manager: only their current active scopes | `data.items[]` includes `id`, `code`, `name`, `is_active`, `companies[]`, timestamps. Expired/revoked/inactive users see no historical scope discovery. |
| `POST /api/core/organization-scopes/` | HRManager/SystemAdmin | `{code, name, is_active?, company_ids:[...]}`. Every company must be active and a `COMPANY` node. |
| `GET/PATCH /api/core/organization-scopes/{id}/` | As above / HRManager/SystemAdmin for patch | PATCH can alter a name. It cannot alter membership or `is_active` while active grants/assignments reference the scope; revoke them and submit an explicit re-approval first. |
| `GET/POST /api/core/workflow/delegations/` | Participants see only their grants; cross-company POST is HRManager/SystemAdmin only | Cross-company request requires `scope_id`, finite `end_at`, and explicit `capabilities`, including `employees.read` for employee visibility. |
| `PATCH/DELETE /api/core/workflow/delegations/{id}/` | Creator/authorized admin | DELETE is a revocation: it sets `is_active=false`, `revoked_at`, and `revoked_by`; it does not erase audit evidence. |
| `GET/POST /api/core/cross-company-manager-assignments/` | HRManager/SystemAdmin to create; HR is limited to authorized scopes; manager sees only current usable assignments, never historical rows | POST requires `employee_id` (employee-profile ID), `manager_profile_id`, `scope_id`, `start_at`, `end_at`, explicit `capabilities`, and optional reason. |
| `PATCH/DELETE /api/core/cross-company-manager-assignments/{id}/` | HRManager/SystemAdmin | DELETE revokes; neither route changes employee company or direct-manager fields. |
| `GET /api/employees/` and `GET /api/employees/{id}/` | Existing roles plus a current scoped grant | With `X-Organization-Scope-Id`, only approved grant/assignment data is visible. Export and unrelated module endpoints remain active-company-only. |
| `GET /api/employees/manager/team/` | Existing manager checks | A cross-company manager must supply the approved scope selector and receives assigned reports only. |

Capability flags on delegation responses use a map such as:

```json
{"workflow.approve": true, "employees.read": true}
```

Cross-company manager assignment capabilities are one or more of `employees.view`, `leaves.approve`, `attendance.approve`, `loans.approve`, `assets.approve`, and `announcements.manage`. No capability implies another.

## Frontend integration

Use one selector source at a time. Prefer headers, never infer a scope from an employee ID.

```ts
api.get('/api/employees/', {
  headers: { 'X-Organization-Scope-Id': String(scopeId) }
})

api.post('/api/core/workflow/delegations/', {
  from_user_id: sourceUserId,
  to_user_id: delegateUserId,
  scope_id: scopeId,
  capabilities: ['employees.read'],
  start_at: startAt,
  end_at: endAt,
  reason: 'Approved temporary coverage'
})
```

Do not send both query and header values unless they are identical. Treat 403 as an access-context failure; do not retry using another company ID. Treat 404 as object non-disclosure. Frontend role guards are UX only and must not imply authority.

## 403/404 rules and sensitive data

- Invalid/forged/conflicting selectors and non-current grants return **403**.
- Out-of-scope direct objects return the endpoint’s existing non-disclosure outcome (**404** where object lookup is scoped; otherwise **403**). Do not use either distinction for enumeration.
- No scope/delegation response exposes leave balances/history, payroll, salary, documents/files, national IDs, passport/Iqama data, phone numbers, audit metadata, provider data, or any cross-company record merely because a scope exists.
- `employees.read` is employee-directory visibility only. It grants no leave, payroll, document, export, reference-data mutation, workflow approval, or company-ownership mutation right.

## Migration and rollback safety

1. Apply the existing tenant-only sequence through `employees.0015`, `attendance.0009`, `invites.0005`, and `leaves.0017` only after the read-only audit is clean/approved.
2. Apply `organization.0002_organizationscope`, then `core.0005_tenant_scope_delegation`, `core.0006_cross_company_manager_assignment_capabilities`, and `core.0007_scope_membership_and_delegation_lifecycle`.
   `core.0007` enforces both sides of a membership move, prevents `OrganizationScope.is_active` toggles while active references exist, makes active `employees.read` scope-mandatory, and retains query-time fail-closed validation for legacy rows.
3. Keep `leaves.0018` (HR manual) and `leaves.0019` (annual payment) in separate release units. Do not bundle them with tenant scope work.
4. The new migrations are additive. Rollback removes new triggers/tables/columns in reverse dependency order; it does not change employee companies, leave balances, leave history, attendance history, or company assignments.

The four unresolved manager inconsistencies are already reported by `audit_employee_company_integrity` and intentionally block `employees.0015`. Resolve them only using stable IDs and approved source documents; do not infer values from names.

## Audit command

```powershell
docker compose -f docker-compose.dev.yml run --rm --no-deps --entrypoint python backend manage.py audit_employee_company_integrity --format json
```

The command is read-only. It now covers all models carrying a `company` relation (including nullable/inactive/non-company ownership), scope membership, delegation grants, cross-company manager assignments, leave records, annual-payment records when present, BioTime mappings, and existing manager/reference discrepancies.

Local audit result on 2026-08-24: the four known `manager_fields_disagree` rows remain (profile IDs 3, 4, 29, and 33, company 2); `EmployeeImport` has one legacy nullable-company row; `Invite.company_id` is reported as schema-unavailable because its migration has not yet passed the tenant preflight. No employee, leave, attendance, or company-assignment data was changed.

## Changed files

- `Backend/organization/{models.py,services.py,migrations/0002_organizationscope.py}`
- `Backend/core/{models.py,delegation.py,serializers.py,views.py,urls.py,migrations/0005_tenant_scope_delegation.py,migrations/0006_cross_company_manager_assignment_capabilities.py,migrations/0007_scope_membership_and_delegation_lifecycle.py,test_tenant_scope_contract.py}`
- `Backend/employees/{views.py,services/manager_relationships.py,management/commands/audit_employee_company_integrity.py}` and `Backend/loans/permissions.py`
- `Backend/leaves/{tasks.py,tests/test_tenant_notification_safety.py}`

### Final integrity pass (2026-08-24)

- `Backend/core/migrations/0007_scope_membership_and_delegation_lifecycle.py` — membership UPDATE validates `OLD.scope_id` and `NEW.scope_id`; `OrganizationScope.is_active` has an active-reference guard; active `employees.read` requires a non-null active scope.
- `Backend/core/delegation.py` — `get_active_employee_read_scope_ids()` repeats active user, linked non-archived active employee profile, active `COMPANY` node, active scope, and time/revocation checks so legacy invalid rows fail closed at read time.
- `Backend/core/test_tenant_scope_contract.py` — added source-scope membership-move, deactivate/reactivate non-restoration, same-company no-scope rejection, and legacy-invalid resolver regressions.
- `plans/Backend Tenant Scope Handoff.md` — this final behavior and command evidence.

`Backend/Dockerfile` now installs Ruff in the backend/worker development image. `docker-compose.dev.yml` contains pre-existing, unrelated Evolution API version/configuration changes (`evoapicloud/evolution-api:v2.3.7` plus its dedicated database/Redis services). They are messaging infrastructure, not tenant-scope behavior; they were configuration-validated and rebuilt locally but must be excluded from a tenant-only release unless separately reviewed and tested as a messaging change.

## Test evidence

- `docker compose -f docker-compose.dev.yml run --rm --no-deps -v "${PWD}\\Backend:/app" --entrypoint python backend -m pytest core/test_tenant_scope_contract.py::<first four cases> -q` — **4 passed in 17.97s** (delegated list/detail/search/pagination, restricted field absence, per-workflow capabilities, and scope-history filtering).
- `docker compose -f docker-compose.dev.yml run --rm --no-deps -v "${PWD}\\Backend:/app" --entrypoint python backend -m pytest core/test_tenant_scope_contract.py::<remaining four cases> -q` — **4 passed in 17.55s** (PostgreSQL lifecycle revocation, selector failures, assignment non-mutation, and cycle prevention).
- `docker compose -f docker-compose.dev.yml run --rm --no-deps --entrypoint python backend -m pytest employees/test_tenant_scoping.py -q` — **15 passed in 32.26s**.
- `docker compose -f docker-compose.dev.yml run --rm --no-deps --entrypoint python backend manage.py check` — **System check identified no issues**.
- `docker compose -f docker-compose.dev.yml run --rm --no-deps --entrypoint python backend manage.py makemigrations --check --dry-run` — **No changes detected**.
- `docker compose -f docker-compose.dev.yml run --rm --no-deps --entrypoint python backend manage.py audit_employee_company_integrity --format json` — **completed read-only**; findings are recorded above.
- Frontend image build — **passed**; existing Vite large-chunk warning remains.
- `docker run --rm -v "${PWD}\\Backend:/app" -w /app --entrypoint ruff hr-ffi-system-backend check <touched backend paths>` — **All checks passed**. Ruff is now included in the backend/worker image.
- Final PostgreSQL contract regression run: `docker compose -f docker-compose.dev.yml run --name tenant-contract-final-2 --no-deps -v "${PWD}\\Backend:/app" --entrypoint python backend -m pytest core/test_tenant_scope_contract.py -q` — **16 passed in 47.29s**. The preceding clean test-database run used `--create-db` so the changed `core.0007` SQL was applied. Coverage now includes membership INSERT/DELETE blocking, source-scope membership-move blocking, scope deactivate/reactivate non-restoration, non-expansion of `employees.read`, same-company no-scope database rejection, query-time legacy-invalid delegation denial, archived/disabled/moved/unlinked delegation revocation, expired/revoked list/detail denial, forged selectors, and a view-only/expired cross-company manager being denied at the leave approval endpoint.
- Final integrity checks: `docker run --rm -v "${PWD}\\Backend:/app" -w /app --entrypoint ruff hr-ffi-system-backend check core/delegation.py core/migrations/0007_scope_membership_and_delegation_lifecycle.py core/test_tenant_scope_contract.py` — **All checks passed**; `docker compose -f docker-compose.dev.yml run --rm --no-deps -v "${PWD}\\Backend:/app" --entrypoint python backend manage.py check` — **System check identified no issues (0 silenced)**; `docker compose -f docker-compose.dev.yml run --rm --no-deps -v "${PWD}\\Backend:/app" --entrypoint python backend manage.py makemigrations --check --dry-run` — **No changes detected**.

## Known limitations / frontend recommendations

- The full PostgreSQL backend suite has not been run: it is intentionally deferred until the mixed annual-payment feature is split from the tenant release. This is a hard handoff blocker.
- Local service startup and application of the new migrations are blocked by the existing four `manager_fields_disagree` records at `employees.0015`. No data was modified to bypass that safety gate.
- Do not surface scope controls to ordinary users until an approved delegation/assignment exists. Show only server-returned scope IDs and capability flags.
- Never use the scope feature for leave delegation. `LeaveRequest.delegated_to` stays same-company.
- Graphify refresh completed with `graphify update .` at **2026-08-24 18:51 Asia/Riyadh**. The generator refreshed the scoped graph; it reported five pre-existing MobileApp barrel-file syntax warnings. No generated Graphify output was hand-edited.
