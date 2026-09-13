# Exit Permission Requests — Backend Handoff

**Date:** 2026-09-10
**Scope:** backend only — new Django app `Backend/permission_requests`. No frontend code was changed.
**Approval chain:** Direct Manager → HR → `approved`. **There is no CEO stage, CEO route, CEO notification, or CEO field.**

---

## 1. Final API routes

Base path: `/api/permission-requests/` (trailing slash optional on every route). Every call must carry the usual
`x-active-company-id` header. Record ids are numeric.

| Method | URL | Who may call | Body / query | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/permission-requests/` | Any user with an **active, non-archived employee profile** whose company is the active company (Employee, Manager, HRManager, CFO, CEO, SystemAdmin-with-profile) | Create payload (§2.1) | `201` detail object | `401`; `403` no active profile, active company ≠ profile company, or company not accessible; `422` validation |
| `GET` | `/api/permission-requests/` | Any authenticated user — returns **only the caller's own** requests in the active company | `status` (a status value or `all`, default all), `date_from`, `date_to` (`YYYY-MM-DD`), `page`, `page_size` | `200` paginated list | `403` company; `422` bad filter |
| `GET` | `/api/permission-requests/{id}/` | Owner; the requester's direct or delegated manager, or the manager who decided it; HR approvers | — | `200` detail object | `404` (also for anything outside the caller's visibility or company) |
| `POST` | `/api/permission-requests/{id}/cancel/` | Owner only, while `pending_manager` or `pending_hr` | none | `200` detail object | `403` visible but not the owner; `404`; `422` not pending |
| `GET` | `/api/permission-requests/{id}/pdf/` | Same visibility as detail (owner, direct/delegated/deciding manager, HR approvers incl. SystemAdmin). An unrelated CEO gets `404`. | — | `200` `application/pdf` attachment (§5) | `404` |
| `GET` | `/api/permission-requests/manager/` | Users with manager access (active direct reports, or an active manager delegation) | `status` (default `pending_manager`; `all` for history), `date_from`, `date_to`, `page`, `page_size` | `200` paginated list | `403` no manager access; `422` bad filter |
| `POST` | `/api/permission-requests/{id}/manager-approve/` | The requester's valid direct manager or their active delegate. Never the requester. | Decision payload (§2.4) | `200` detail object | `403` no manager access / not this requester's manager / self; `404`; `422` stale state or comment too long |
| `POST` | `/api/permission-requests/{id}/manager-reject/` | Same as manager-approve | Decision payload | `200` detail object | Same |
| `GET` | `/api/permission-requests/hr/` | HR approvers. The caller's own requests are excluded. | `status` (default `pending_hr`; `all`), `date_from`, `date_to`, `page`, `page_size` | `200` paginated list | `403` not an HR approver; `422` bad filter |
| `POST` | `/api/permission-requests/{id}/hr-approve/` | HR approvers except the requester | Decision payload | `200` detail object | `403` not HR approver / self; `404`; `422` stale state |
| `POST` | `/api/permission-requests/{id}/hr-reject/` | Same as hr-approve | Decision payload | `200` detail object | Same |

There is no `/ceo/`, `/ceo-approve/`, or `/ceo-reject/` route; they return `404`.

For the queue and decision routes, the role gate runs before the record lookup. A user with no manager access gets
`403` on `manager-approve` even for an id they cannot see.

## 2. Field contract

### 2.1 Create payload

```json
{
  "request_date": "2026-09-10",
  "from_time": "09:00",
  "to_time": "10:30",
  "exit_type": "personal",
  "reason": "Personal appointment"
}
```

| Field | Type | Rules |
|---|---|---|
| `request_date` | `YYYY-MM-DD` | Required. Must equal **today in the server time zone** (`APP_TIME_ZONE`, default `Asia/Riyadh`). Past and future dates are refused. |
| `from_time` | `HH:MM` (`HH:MM:00` accepted) | Required. Seconds other than `00` are refused. |
| `to_time` | `HH:MM` | Required. Must be later than `from_time` on the same day (cross-midnight is refused). Duration 1–120 minutes; any minute value is allowed. |
| `exit_type` | string | `business` \| `personal` \| `emergency` |
| `reason` | string | Required. Trimmed, then 1–1000 characters. Arabic and English preserved. |
| `duration_minutes` | integer, optional | Ignored when absent. If sent it must equal the server calculation, otherwise `422`. The stored value is always server-calculated. |

The server rejects these keys with a per-field `422` instead of silently ignoring them: `id`, `employee`,
`employee_id`, `employee_profile`, `employee_profile_id`, `company`, `company_id`, `status`, `reference_no`,
`manager_decision`, `manager_decision_by`, `manager_decision_at`, `manager_decision_note`, `hr_decision`,
`hr_decision_by`, `hr_decision_at`, `hr_decision_note`, `cancelled_at`, `created_at`, `updated_at`.

### 2.2 List item (queues and "my requests")

| Field | Type | Notes |
|---|---|---|
| `id` | integer | |
| `reference_no` | string | `PERM-YYYYMMDD-NNNN`, server-generated and unique |
| `request_date` | `YYYY-MM-DD` | |
| `from_time`, `to_time` | `HH:MM:SS` | |
| `duration_minutes` | integer | 1–120 |
| `exit_type` | string | enum |
| `exit_type_label`, `exit_type_label_ar` | string | e.g. `Personal` / `شخصي` |
| `reason` | string | |
| `status` | string | domain status (§3) — **use this for UI state** |
| `status_label`, `status_label_ar` | string | e.g. `Pending HR` / `بانتظار الموارد البشرية` |
| `employee` | object | `{id, email, full_name, full_name_ar, employee_profile_id, employee_number, department, job_title}` |
| `company_id`, `company_name` | integer, string | |
| `manager_decision` | `"approved"` \| `"rejected"` \| `null` | |
| `manager_decision_by` | `{id, email, full_name}` \| `null` | |
| `manager_decision_at` | ISO datetime \| `null` | |
| `manager_decision_note` | string | empty when none |
| `hr_decision`, `hr_decision_by`, `hr_decision_at`, `hr_decision_note` | same shapes as manager | `null` / empty until HR decides; stays `null` when the HR stage was skipped |
| `cancelled_at` | ISO datetime \| `null` | |
| `created_at`, `updated_at` | ISO datetime | |
| `workflow` | object | §2.3 |

Paginated envelope:

```json
{ "status": "success", "data": { "items": [ ... ], "page": 1, "page_size": 25, "count": 3, "total_pages": 1 } }
```

### 2.3 Detail object

This is a list item plus `direct_manager`: `{id, employee_profile_id, full_name}` \| `null`. That is the requester's
**currently valid** direct manager. Every create, retrieve, cancel, and decision response returns the detail object in
`{"status": "success", "message": "...", "data": { ... }}`.

`workflow` object:

```json
{
  "status": "in_review",
  "current_stage": "manager",
  "current_approver_role": "manager",
  "current_actor": { "id": 7, "email": "manager@example.com", "full_name": "Maha Manager" },
  "can_approve": false,
  "can_reject": false,
  "can_cancel": true,
  "history": [
    {
      "id": 101, "action": "submit", "stage": "", "approver_role": "",
      "actor": { "id": 9, "email": "...", "full_name": "..." },
      "at": "2026-09-10T06:05:00Z", "note": "",
      "from_status": "draft", "to_status": "submitted", "from_stage": "", "to_stage": "manager",
      "metadata": { "legacy_signature": "submitted", "workflow_key": "permission_request" }
    }
  ]
}
```

- `workflow.status` is the **engine** status: `in_review`, `approved`, `rejected`, or `cancelled`. It is not the domain
  status, so drive badges from top-level `status`.
- `current_stage` / `current_approver_role`: `manager`, `hr`, or `""` once final.
- `current_actor` is the resolved manager (or their active delegate) at the manager stage. At the HR stage it is the
  caller when the caller can act, otherwise `null`.
- `can_approve` / `can_reject` mirror exactly what the decision endpoints accept for **this caller**. They are always
  false for the requester. `can_cancel` is true only for the owner of a pending request.
- `history[].action`: `submit`, `advance` (manager approved, moved to HR), `approve`, `reject`, `cancel`.
  `history[].metadata.decision` carries `approved`/`rejected` on manager/HR entries.

### 2.4 Decision payload (all four decision routes)

```json
{ "comment": "Optional decision note" }
```

`comment` is optional for approval and rejection, blank is allowed, maximum 1000 characters. It is stored as
`manager_decision_note` / `hr_decision_note`.

### 2.5 Error responses

Validation (`422`) — one entry per message; non-field errors use `non_field_errors`:

```json
{
  "status": "error",
  "message": "You already have an active permission request for this date.",
  "errors": [ { "field": "request_date", "message": "You already have an active permission request for this date." } ]
}
```

Refusals raised by the view (`403` / `404`):

```json
{ "status": "error", "message": "You cannot approve or reject your own permission request.", "errors": ["You cannot approve or reject your own permission request."] }
```

Role-gate and authentication refusals (`401` / `403` from DRF permissions) use the global handler shape:
`{"status": "error", "message": "...", "detail": "..."}`.

Messages the UI will meet:

| Field | Message |
|---|---|
| `request_date` | `Permission requests can only be submitted for the current workday (YYYY-MM-DD).` |
| `request_date` | `You already have an active permission request for this date.` |
| `to_time` | `End time must be later than start time on the same day.` |
| `to_time` | `A permission request cannot exceed 120 minutes.` |
| `from_time` / `to_time` | `Times must be given in hours and minutes only.` |
| `duration_minutes` | `duration_minutes is calculated by the server and does not match the times.` |
| `non_field_errors` | `No eligible approver is available for this permission request. Ask HR to assign your direct manager.` |
| `non_field_errors` | `This permission request is no longer pending manager approval.` / `... pending HR approval.` |
| `non_field_errors` | `Only pending permission requests can be cancelled.` |
| (403) | `Select your employee company to submit a permission request.` |

## 3. Status contract

| Status | English | Arabic |
|---|---|---|
| `pending_manager` | Pending Manager | بانتظار المدير المباشر |
| `pending_hr` | Pending HR | بانتظار الموارد البشرية |
| `approved` | Approved | معتمد |
| `rejected` | Rejected | مرفوض |
| `cancelled` | Cancelled | ملغي |

Exit types: `business` Business / عمل, `personal` Personal / شخصي, `emergency` Emergency / طارئ.

```
pending_manager → pending_hr → approved
pending_manager → approved            (requester is an HRManager/SystemAdmin: HR stage skipped)
pending_manager → rejected
pending_hr      → rejected
pending_manager → cancelled
pending_hr      → cancelled
(created directly at pending_hr when the requester has no valid direct manager)
```

There is no `pending_ceo` status. `pending_manager`, `pending_hr`, and `approved` occupy the employee's day. A second
request for the same date is refused, and a partial unique index backs this rule. `rejected` and `cancelled` free the
day.

## 4. Approval behavior

- **Direct manager:** resolved by `employees.services.manager_relationships.get_valid_manager_user(profile)`.
  `EmployeeProfile.manager_profile` must be active, non-archived, linked to an active user, in the same company, not
  the employee themself, and not part of a cycle. Cross-company manager assignments **do not** grant approval for this
  workflow, because no capability exists for it.
- **Delegation:** at the manager stage, a same-company user holding an active `DelegationRule` from the manager with
  the `workflow.approve` capability may decide (`actor_source: "delegate"` in the audit log). At the HR stage, a user
  with an active `workflow.approve` delegation from an HR approver is an HR approver.
- **HR approvers:** members of the `HRManager` or `SystemAdmin` groups, plus active HR delegates. They are checked by
  group membership, so a user in both `CFO` and `HRManager` still qualifies. The HR queue shows every request in the
  active company except the caller's own.
- **Manager queue:** requests from the caller's direct reports and delegated reports in the caller's company.
- **Requester = approver:** the requester can never decide their own request (`403`) and `can_approve` is false.
  - HRManager/SystemAdmin requester with a manager: the manager's approval is final (`approved`) because the HR stage
    would be self-approval.
  - HRManager/SystemAdmin requester without a manager: routed to `pending_hr` for another HR approver.
  - A temporary HR delegate is not treated as an HR approver for skipping. Their HR stage remains, and someone else
    decides it.
- **No valid manager:** the request starts at `pending_hr` if at least one HR approver other than the requester exists
  and is authorized for the company. Otherwise submission is refused with `422` (`non_field_errors`) instead of creating
  an un-actionable request.
- **Manager leaves mid-flight:** the existing `reroute_pending_manager_requests` / `sync_workflow` fallback now also
  covers permission requests. It moves `pending_manager` to `pending_hr` and audits `manager_stage_fallback_to_hr`.
- **Concurrency:** decisions and cancellation lock the row (`SELECT ... FOR UPDATE`), re-check authority and state
  under the lock, and project the workflow in the same transaction. The losing request of a race gets `422`.
- **CEO:** CEO users can submit their own requests. They have **no** approval action, no queue, and no visibility of
  other people's requests.
- **Separation of duties (not enforced, flagged):** one person who is both the requester's direct manager and an HR
  approver can decide both stages. No rule against this was requested.

## 5. PDF contract

- **Template:** `exit_permission_request_blank.pdf`. **Field map:** `exit_permission_request_blank_field_map.json`.
  Both resolve through `core.views_templates.resolve_template_path` (`HR_TEMPLATES_DIR` first, then
  `Backend/static/pdf_templates`), and the map is read from the resolved template's own directory. When the pair
  cannot be resolved, the generic `core.pdf.render_request_pdf` document is returned instead.
- **Renderer:** `permission_requests/pdf_permission_request.py` through the shared `core/pdf_forms.py`. No coordinates
  live in Python. The JSON map was not modified.
- **Route:** `GET /api/permission-requests/{id}/pdf/`, with detail visibility (owner, direct/delegated/deciding
  manager, HR approvers incl. SystemAdmin).
- **Response headers:** `Content-Type: application/pdf`,
  `Content-Disposition: attachment; filename="permission_request_<reference_no>.pdf"`,
  `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. Each download is audited as
  `permission_request_pdf_downloaded`.

| Map key | Source |
|---|---|
| `reference_no` | `reference_no` |
| `request_date`, `exit_date` | `request_date` |
| `employee_name` | profile `full_name_en` → `full_name` → `full_name_ar` → user name/email |
| `employee_id` | profile `employee_number` → `employee_id` |
| `department` | profile `department_name_en` → `department` → `department_ref.name` → `department_name_ar` |
| `job_title` | profile `job_title_en` → `job_title` → `position_ref.name` → `job_title_ar` |
| `direct_manager` | the manager who decided; before a decision, the currently valid direct manager |
| `from_time`, `to_time` | `HH:MM` |
| `exit_type` (checkbox) | `business` / `personal` / `emergency` |
| `justification` | `reason` |
| `employee_signature_image` | requester's stored signature |
| `employee_signature_date` | `created_at` (local date) |
| `manager_decision` (checkbox) | `approved` / `rejected`; both blank until the manager decides |
| `manager_name`, `manager_signature_image`, `manager_signature_date` | `manager_decision_by`, their signature, `manager_decision_at` — only once decided |
| `hr_notes`, `hr_name`, `hr_signature_image`, `hr_signature_date` | `hr_decision_note`, `hr_decision_by`, their signature, `hr_decision_at` — only once decided |

- **Signatures:** these come from `EmployeeProfile.signature` of the actor the request recorded for each stage
  (approve or reject), never from the downloader. An undecided stage, or a signer with no stored signature, leaves the
  box blank and logs a diagnostic. When the HR stage was skipped, the HR panel stays blank.
- **No CEO data:** the map, the value builder, and the rendered form contain no CEO field or section. This is verified
  by tests.
- **Map metadata note:** the map's informational `source` for `hr_signature_date` reads `request.hr_completed_at`. The
  renderer ignores `source` and uses `hr_decision_at`, as required. The generator script writes that same string, so
  correct both together if the metadata should match.

## 6. Frontend integration guidance

These paths are already emitted by the backend as notification `action_url`s and pending-approval `review_path`s. Use
them as-is, or tell backend to change them:

| Page | Suggested route | API calls | Render |
|---|---|---|---|
| Employee request form | `/employee/permission-requests/new` | `POST /api/permission-requests/` | `request_date` fixed to today (surface the server's `422` if the device date differs); `from_time`/`to_time` minute pickers with a live duration (max 120); `exit_type` radio (3 options); `reason` textarea (≤1000). Show field errors from `errors[]`. |
| Employee request list | `/employee/permission-requests` | `GET /api/permission-requests/?status=&page=` | `reference_no`, `request_date`, time window, `duration_minutes`, `exit_type_label(_ar)`, `status_label(_ar)` |
| Employee request detail | `/employee/permission-requests/:id` | `GET /{id}/`; `POST /{id}/cancel/` when `workflow.can_cancel`; `GET /{id}/pdf/` | All fields, `direct_manager`, decision blocks, `workflow.history` timeline |
| Manager inbox / detail | `/manager/permission-requests`, `/manager/permission-requests/:id` | `GET /manager/` (`?status=all` for history); `GET /{id}/`; `POST /{id}/manager-approve/` or `manager-reject/` with `{comment}`; `GET /{id}/pdf/` | `employee.full_name`, `employee_number`, `department`; request fields; buttons only when `workflow.can_approve` / `can_reject` |
| HR inbox / detail | `/hr/permission-requests`, `/hr/permission-requests/:id` | `GET /hr/`; `GET /{id}/`; `POST /{id}/hr-approve/` or `hr-reject/`; `GET /{id}/pdf/` | Same as manager plus the manager decision block |

- The pending-approvals dashboard item uses `request_type: "PERMISSION"`, `request_type_label: "Exit Permission"`.
- In-app notifications use `related_object_type: "permission_request"` with the `request` category.
- After any decision or cancel, re-render from the returned detail object; it already reflects the new state.

## 7. Evidence, migration, environment, deviations

### Migration and environment

- **Migration:** `permission_requests/migrations/0001_initial.py` creates one table with its indexes, partial unique
  index, and check constraints. There is no data migration. Deploy with `python manage.py migrate`.
- **Environment variables:** none new. "Today" uses `APP_TIME_ZONE` (default `Asia/Riyadh`); organizations have no
  per-company time-zone field.
- **Notifications:** submission notifies the direct manager (or eligible HR approvers when starting at HR). Manager
  approval notifies HR approvers other than the requester. Final decisions notify the requester. Failures are logged
  (`permission_request_notification_failed`) inside a savepoint and never roll back the request.
- **Audit actions:** `permission_request_submitted`, `permission_request_manager_approved`,
  `permission_request_manager_rejected`, `permission_request_hr_approved`, `permission_request_hr_rejected`,
  `permission_request_cancelled`, `permission_request_pdf_downloaded`. Metadata is limited to `request_id`,
  `reference_no`, `company_id`, `from_status`, `to_status`, `duration_minutes`, `exit_type`, `actor_id`, and
  `actor_source` for manager decisions. It never contains the reason, notes, or signatures. `sync_workflow` also writes
  `workflow_transition`.

### Shared files touched

- `config/settings.py` — app registered.
- `config/urls.py` — `api/` include.
- `core/services/workflow_engine.py` — `permission_request` template, adapter, action URLs, pending-approval item.
- `in_app_notifications/integrations.py` — company resolution for `"Permission Request"`. Without it, approver
  notifications are dropped by the fail-closed tenant filter.
- `employees/services/manager_relationships.py` — manager-stage fallback and reroute.
- `core/tests_pdf_forms.py` — the new pair registered in the template/map contract.
- `static/pdf_templates/README.md` and `.agents/context/{workflow_engine,pdf_template_library}.md` — documentation.

### Intentional deviations

1. The workflow key is `permission_request`, not `permission_request_approval`, matching the repository's
   `<entity>_request` keys.
2. Server-assigned fields are **rejected** (`422`) rather than ignored, and times with seconds are rejected.
3. Authorization failures, including self-approval, return `403`. The loan module returns `422` for self-approval;
   `422` is used here only for invalid or stale state.
4. "Current workday" means today's date in `APP_TIME_ZONE`. No weekend or holiday calendar is applied.
5. Cancellation sends no notification, matching the loan convention. Submission notifies the direct manager, not their
   delegate, matching loans; the delegate sees the request in the manager queue.
6. The PDF is served as `application/pdf`, as required. Loans use `application/octet-stream`.
7. Concurrency is verified by row-lock, stale re-check, and duplicate-decision tests rather than a multi-connection
   race test. No suite in the repo uses transactional database tests, and under `--reuse-db` their flush would erase
   migration-seeded data for later runs.

### Test evidence

All commands were run locally from `Backend/` against the dev Postgres container. The `ffi_hr_backend` container does not
mount the source, so running tests inside it would exercise stale code.

| Command | Result |
|---|---|
| `DB_PASSWORD=postgres python -m pytest permission_requests -q` | First run: 86 passed, 2 failed. Both failures were test setup: a queryset update set `manager_profile` without the legacy `manager` column that a DB trigger requires to match. Fixed; both re-run green. |
| `SECURE_SSL_REDIRECT=false DB_PASSWORD=postgres python -m pytest permission_requests core/tests_pdf_forms.py core/tests_pdf_signers.py core/tests_templates.py core/test_route_contract.py core/test_tenant_scope_contract.py core/tests.py loans leaves/tests/test_manager_workflow.py leaves/tests/test_tenant_notification_safety.py in_app_notifications/tests.py employees/tests.py -q` | **349 passed, 7 failed** (31m50s). All of `permission_requests` and the PDF, template, route, tenant-scope, workflow, loan, leave, and notification suites passed. |
| `python manage.py check` | No issues |
| `python manage.py makemigrations --check --dry-run` | No changes detected |
| `python -m compileall -q permission_requests core` | OK |
| `ruff check` (changed Python files) / `ruff format` (new app and `workflow_engine.py`) | All checks passed. `integrations.py` and `manager_relationships.py` were already unformatted at HEAD and were not reformatted. |

The 7 remaining failures are all in `employees/tests.py` and are not caused by this feature:

- **6 × `EmployeeDeletionWorkflowTests`:** `403 You do not have access to the requested company`. The CEO test user has an access row only for `other_company`. The uncommitted `organization/services.py` change already in the working tree makes access rows authoritative for every non-admin role, so that CEO is refused for their own profile company.
- **`test_unlinking_user_with_leave_relationship_returns_conflict`:** the Django test client raises `TypeError: Cannot encode None for key 'user_id'` because the test sends `{"user_id": None}` without `format="json"`. It fails before any view runs.

Known environment limitation: without `SECURE_SSL_REDIRECT=false`, the local `.env` redirects plain-HTTP test requests,
which causes about 96 additional `301` failures in `employees/tests.py`. The permission request tests disable the
redirect themselves.
