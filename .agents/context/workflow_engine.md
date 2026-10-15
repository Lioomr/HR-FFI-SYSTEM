# Workflow Engine Context

> **TL;DR:** `core` provides shared workflow snapshots and approval history, while each domain service owns its request status and transitions. Use the domain transition service, sync through the workflow helpers, gate actions with `can_user_act_on_instance`, and serialize actor-specific workflow fields with request context. For employee request UX, Current Requests is a summary that links to request-specific screens; the leave list/detail is the approval-trail reference (`LeaveApprovalMap`, `ApprovalTimeline`, and current-actor banner). Before edits, trace all linked UI/API/service/permissions/delegation/scope/audit/notification/toggle/test paths. Leave requires CEO review; loans use Manager→HR→CFO→CEO; assets use Manager→CEO; exit permission uses Manager→HR with **no CEO stage**.

The `core` app provides a shared approval engine used by Leave, Loan, and Asset flows.

## Models (`Backend/core/models.py`)

| Model | Purpose |
|---|---|
| `WorkflowDefinition` | Named workflow template (e.g., "leave_approval", "loan_approval") |
| `WorkflowStageDefinition` | Ordered stage within a definition — role required, optional CEO gate |
| `WorkflowInstance` | Runtime workflow attached to a specific request (FK + content_type) |
| `WorkflowAction` | Single actor decision on an instance: APPROVED / REJECTED / DELEGATED |
| `DelegationRule` | Temporary role reassignment: `delegator`, `delegate`, `role`, `valid_from`, `valid_until` |
| `UserPreference` | Per-user settings (notification preferences, language) |

## Standard Approval Chain

Leave flow: alternative employee review (when selected) → manager (when valid) → HR → CEO → HR completion when applicable. CEO review is required; see the Leave Request Rules below for exceptions and exact transitions.

Loan flow: **Employee → Manager → HRManager → CFO → CEO** (verify any request-specific optional stage against live service code).

Asset flow: **Employee → Manager → CEO**

Exit permission flow (`permission_requests`, workflow key `permission_request`): **Employee → Manager → HRManager → approved**. There is no CEO stage. No valid manager starts at HR (refused with 422 when no HR approver other than the requester exists); an HRManager/SystemAdmin requester's request is final after manager approval. See `plans/Permission Requests Backend Handoff.md`.

Employee profile change flow (`employees`, workflow key `employee_profile_change`): **Employee → HR → approved / partially approved / rejected**, single HR stage. One request holds many line items (personal details, passport / national ID data, and scans whose OCR only pre-fills the form). An HR approver (HRManager/SystemAdmin or active HR delegate, never the requester) decides every item in ONE call; the engine records a single `APPROVE` (all or some approved: `APPROVED`/`PARTIALLY_APPROVED`) or `REJECT` (none: `REJECTED`), so there is no partial workflow state. Approved items update the profile / login email and approved scans become new `EmployeeDocument`s (older ones kept). Pending-inbox type `EMPLOYEE_PROFILE_CHANGE`, review path `/hr/employees/profile-change-requests`. Contract: `plans/Employee Profile Change Requests API.md`.

## Delegation Rules

- `DelegationRule` allows a manager to delegate their approval authority to another user for a date range.
- Delegation grants only workflow approval capability for the configured role and active dates. A read-only company/data-access rule does not make the delegate an approver. Backend must check delegation rules when resolving "who can approve this stage" — see `core/services/delegation.py` and `can_user_act_on_instance`.
- Example: if Omar's active manager approval is delegated to Sara, Sara should see and act on requests waiting at Omar's manager stage in her approval inbox. The employee/request owner remains unchanged, and Sara's decision is recorded with Sara as the actor and the delegation attached. Check the actual role, date range, company scope, and workflow approval capability before diagnosing a missing item.
- Delegated actions are recorded with the delegate as actor and the delegation FK stored in `WorkflowAction`.

## Request Obligations

`RequestObligation` is a reusable pre-final-approval gate for request objects. It lives in `core`, links to the parent request through a generic FK, and can optionally point at a target object such as an asset.

- Business Trip leave (`LeaveType.code = BUSINESS_TRIP`) is the first implementation.
- Obligations are synced by `core.services.request_obligations.sync_leave_obligations()`.
- Asset obligations are blocking when an active assigned asset has `must_return_before_travel = True`; they resolve only after HR processes the return and the active assignment is gone.
- Pending approval obligations are blocking when the travelling employee still has pending workflow approvals and no active delegation covers the trip dates.
- CEO final approval must block on open blocking obligations unless a waiver reason is supplied. Waivers must audit `request_obligation_waived`.
- If Business Trip `delegated_to` is set, sync creates or updates a `DelegationRule` covering `start_date` through `date_of_rejoin` or `end_date`.

## Adding a New Approval Workflow

1. Map the model in `_adapter_for_instance()` (`workflow_engine.py`): workflow key + legacy status-snapshot and event builders. `WorkflowDefinition`/stages auto-create from the code template via `get_or_create_workflow_definition(key)` — no data migration needed.
2. On request creation, set the initial domain status and call `sync_workflow(instance, actor=request.user)` — it get-or-creates the `WorkflowInstance`.
3. Each approval/rejection action transitions the parent request `status`, then calls `sync_workflow(instance, actor=request.user)`; missing `WorkflowAction` rows and `AuditLog` entries (`workflow_transition`) are generated automatically.
4. Notify the next approver (email via Bird when configured, WhatsApp via Evolution when a valid mobile exists).

## Recorded History

Legacy workflows rebuild `WorkflowAction` rows from the domain model's decision timestamps on every `sync_workflow`, which loses repeated or overwritten decisions. A workflow whose `metadata["history_mode"] == "recorded"` skips that rebuild; its history is written when each action happens:

```python
start = begin_recorded_transition(locked, actor=actor)  # under the row lock, before changing the instance
# ... change and save the domain status ...
record_workflow_transition(locked, start, action=WorkflowAction.Action.APPROVE, actor=actor, note=note)
```

- `begin_recorded_transition` syncs a legacy workflow first (keeping its rebuilt rows), then switches it to recorded. Pass `new_instance=True` only for a brand-new submission.
- `record_workflow_transition` projects the saved status and writes one row with the real actor, stages, and note, plus the `workflow_transition` audit.
- These modules record every transition this way, each from a service module that owns the transition rules:
  - Leave requests — `Backend/leaves/services.py`
  - Annual leave settlements — `Backend/leaves/annual_payment_services.py`
  - Loan requests (including payroll deduction) — `Backend/loans/services.py`
  - Asset return requests — `Backend/assets/services/return_requests.py`
  - Asset damage reports (cancel only so far; adapter `asset_damage_report`) — `Backend/assets/services/damage_reports.py`
  - Exit permission requests — `Backend/permission_requests/services.py`
  - Employee archive requests — `Backend/employees/archive_request_services.py`
  - Employee profile change requests — `Backend/employees/services/profile_change_requests.py`
  - Contract decisions — `Backend/employees/contract_expiry.py`
  - Starting work acknowledgments — `Backend/job_offers/starting_work_service.py`
- Job offers already keep an explicit per-event log (`approval_events`), rebuilt one row per event, so they need no conversion. Manual attendance approval and attendance corrections have no live transitions; their adapters only serve existing history.
- Each module keeps its existing history vocabulary (for example `advance` when a stage forwards to the next one), so frontends render recorded rows like the rebuilt ones.

## Requester Cancel (pending requests)

Each module owns a requester cancel service (row lock, `begin_recorded_transition`, `CANCELLED`, `record_workflow_transition(Action.CANCEL, actor=employee)`); see `plans/Employee Request Edit and Cancel Plan.md`.

| Kind | Route | Cancellable statuses | Notes |
|---|---|---|---|
| Leave | `POST /api/leaves/leave-requests/{id}/cancel/` | all pending (`submitted` … `pending_hr_completion`) | Closes Business Trip obligations/delegation. |
| Annual leave settlement | `POST /api/leaves/annual-leave-payments/{id}/cancel/` | `pending_hr`, `pending_ceo` | Only self-filed, non-termination settlements (else 403). `cancelled` frees the cycle and is ignored by carry-forward. |
| Asset return | `POST /api/assets/return-requests/{id}/cancel/` | `PENDING_MANAGER`, `PENDING`, `PENDING_CEO` | Unblocks a new return request for the asset. |
| Asset damage report | `POST /api/assets/damage-reports/{id}/cancel/` | `PENDING_HR`, `PENDING_CEO` | Serializer exposes top-level `can_cancel` (no workflow snapshot). |
| Loan / permission / profile change | existing `cancel` routes | module-specific | Unchanged. |

`get_workflow_snapshot(...)["can_cancel"]` (`_requester_can_cancel`) is true only for the owner while the workflow is `submitted`/`in_review`; settlements additionally require self-filed and non-termination. Non-owners get 404 from every cancel route; decided requests get 422.

## Requester Edit (before the HR stage)

The owner edits their own request only until it reaches HR and while no stage decision is recorded; afterwards they cancel and resubmit. Each module's edit service takes the row lock, re-checks the window (`requester_edit_refusal`), revalidates the merged request with the create rules (excluding the request itself from overlap/conflict/balance counts), saves only changed fields without changing status or route, and records one `WorkflowAction.Action.EDIT` row (employee actor, approver_role `""`, note `Edited: <field names>`, `metadata.changed_fields`). The current approver gets an "updated" notification after the change; a failure never undoes it. A body that changes nothing records nothing.

| Kind | Route | Editable while | Notes |
|---|---|---|---|
| Leave | `PATCH /api/leaves/leave-requests/{id}/edit/` | `submitted`, `pending_delegate`, `pending_manager`; no delegate/manager/HR/CEO decision; not returned to an alternative employee from HR or later; never `hr_manual` | Create fields except `delegated_to` (422; use `set-delegate`). Validation runs with the request's own reservation withdrawn (status flipped inside the locked transaction, then restored) so balance/yearly caps count only other requests. Re-syncs Business Trip obligations and the trip delegation rule. Audits `leave_request_edited`; notifies `leave.updated` to the alternative employee, else manager, else HR. |
| Permission | `PATCH /api/permission-requests/{id}/edit/` | `pending_manager` with no decision (`pending_hr` is the HR stage) | Create fields; new attachments are appended. Interval conflict and Late limit re-checked under the employee lock excluding itself. No attendance adjustment exists yet while pending. Audits `permission_request_edited` (never the reason); notifies the manager `permission.updated`. |
| Loan | `PATCH /api/loans/loan-requests/{id}/edit/` | `submitted`, `pending_manager`; no manager/HR/CFO/CEO/disbursement decision (a loan that started at HR or the CEO is never editable) | Create fields `amount`, `loan_type`, `installment_months`, `reason` merged onto the stored loan and revalidated by `LoanRequestEditSerializer` (open-loan 25% cap, installment salary cap/6-month service/1-10 months; switching to `open` drops the stored months); `employee`/`employee_profile`/`company`/`status` are 422. The route never depends on the amount, so status/route are kept and nothing is re-derived (`approved_amount` and the deduction period are set at approval; the PDF renders live). History `changed_fields` use the API names (`amount`). Audits `loan_request_edited` (never the reason); notifies the manager `loan.updated`. |
| Asset return | `PATCH /api/assets/return-requests/{id}/edit/` | `PENDING_MANAGER` with no decision (`PENDING` is the HR stage) | `note` only (non-empty); `asset`/`employee`/`status` are 422. Audits `asset_return_request_edited` (never the note); notifies the manager `asset_return.updated`. |

`get_workflow_snapshot(...)["can_edit"]` (`_requester_can_edit`, also in `get_workflow_snapshots`/read-only snapshots) is true only for the owner while the workflow is `submitted`/`in_review` and the domain `requester_edit_refusal(...)` returns `None`. Non-owners get 404 from every edit route; requests outside the window get 422.

## Cancellation Requests (approved requests)

An approved request is never cancelled or edited by the employee directly. The owner files a **cancellation request** with a reason; HR confirms or declines it. One shared model, `core.CancellationRequest` (generic FK to the request, `kind`, `company`, `requested_by`, `reason`, `status` `pending`/`confirmed`/`declined`/`withdrawn`, `decided_by`/`decided_at`/`decision_note`; a partial unique constraint allows one `pending` row per request). `core/services/cancellation_requests.py` holds a per-kind registry (`KINDS`: owner, company, state eligibility `refusal`, the module's HR cancel as `confirm`, HR/employee paths) and orchestrates: it locks the request row (then the cancellation row), re-checks eligibility under the lock, and records history on the request's own recorded workflow.

| Kind (`kind`) | Employee routes (`request-cancellation/`, `withdraw-cancellation-request/` on the detail route) | Eligible while | HR confirm runs |
|---|---|---|---|
| Leave (`leave`) | `/api/leaves/leave-requests/{id}/` | `approved`, `end_date >= today`, not `hr_manual` | `leaves.services.apply_hr_cancellation` (closes Business Trip obligations/delegation; balance follows status) |
| Permission (`permission`) | `/api/permission-requests/{id}/` | `approved`, `request_date >= today` | `permission_requests.services.apply_hr_cancellation` (deletes the approval's `AttendanceAdjustment`, recalculates the day after commit) |
| Settlement (`annual_leave_payment`) | `/api/leaves/annual-leave-payments/{id}/` | `approved`, self-filed, not termination (`settled_at` is stamped by the CEO approval and no payroll/payment record exists, so HR verifies payout before confirming) | `leaves.annual_payment_services.apply_annual_payment_hr_cancellation` (`cancelled` frees the cycle) |
| Asset return (`asset_return`) | `/api/assets/return-requests/{id}/` | `APPROVED` (never `PROCESSED`) | `assets.services.return_requests.apply_hr_cancellation` (assignment untouched) |
| Damage report (`asset_damage`) | `/api/assets/damage-reports/{id}/` | `APPROVED` | `assets.services.damage_reports.apply_hr_cancellation` |
| Loan (`loan`) | `/api/loans/loan-requests/{id}/` | `pending_disbursement` only (no payroll reservation exists yet) | `loans.services.apply_hr_cancellation` (leaves the disbursement queue) |

- History: `cancellation_requested` (employee actor; note = reason, except permission which never records the reason), `cancellation_withdrawn` (employee), `cancellation_declined` (HR actor, HR note, `approver_role: "hr"`); a confirm is the module's usual `cancel` row with the HR actor and HR comment (default `Cancelled at the employee's request.`). Rows carry `metadata.cancellation_request_id`. `WorkflowAction.action` is now `max_length=32` (`core/0017`).
- Snapshot: `_workflow_snapshot_from_instance` adds `can_request_cancellation` (owner, eligible, nothing pending), `can_withdraw_cancellation_request` (owner with a pending one) and `cancellation_request` (latest row or `null`, so a decline note stays visible). `get_workflow_snapshots` prefetches the latest rows in one query per model.
- HR inbox `GET /api/core/cancellation-requests/` with `POST {id}/confirm/` (comment optional) and `{id}/decline/` (comment required): HRManager/SystemAdmin, accessible-company scope. The requester or request owner can never decide (403); a non-pending row or an ineligible request is 422.
- Audit `cancellation_requested`/`_withdrawn`/`_confirmed`/`_declined` (kind, target id, from/to status; never the reason or note). Notifications (in-app + email, WhatsApp off, after commit, failures logged): `cancellation.requested` to company HR approvers except the requester; `cancellation.confirmed`/`cancellation.declined` to the employee.
- A pending cancellation request does not make the approved request pending: pending-approval inboxes and counters are unchanged.

## Leave Request Rules (`Backend/leaves/services.py`)

- Route: alternative employee (if chosen) → direct manager (if valid) → HR → CEO → HR completion (non-Saudi travellers only). An HR manager's own leave also goes to their manager first, then skips the HR stage and goes to the CEO.
- The CEO stage is required for every leave request.
- The employee cancels their own request while it is pending (`submitted`, `pending_delegate`, `pending_manager`, `pending_hr`, `pending_ceo`, `pending_hr_completion`) via `POST /api/leaves/leave-requests/{id}/cancel/` (`apply_requester_cancellation`); approved/rejected/cancelled return 422. HR cancels any in-progress or approved request with a reason via `POST /api/leaves/leave-requests/{id}/hr-cancel/`; an HR member's own request needs another HR member. Either cancel of a Business Trip closes its obligations and ends the delegation rule it created.
- The employee edits their own request before HR via `PATCH /api/leaves/leave-requests/{id}/edit/` (`apply_requester_edit`; see Requester Edit above).
- An alternative employee added after submission (`set-delegate`) moves the request to `pending_delegate`; `delegate_return_status` remembers the stage it returns to once they approve.
- There is no per-leave-type CEO flag; HR manual leave records are the only leave that skips approval.
- HR "send to CEO" works only from `submitted`/`pending_hr`; a request already waiting on the CEO is refused, never overwritten.

## Key Service Functions

`Backend/core/services/workflow_engine.py` (re-exported from `core.services`):
- `sync_workflow(instance, *, actor=None, workflow_key=None)` — atomic projection of the domain object's current status into `WorkflowInstance`, plus idempotent `WorkflowAction` history (deduped via `legacy_signature` metadata). Audits each new transition as `workflow_transition`. Call after every create/approve/reject/cancel in domain views.
- `can_user_act_on_instance(user, instance, workflow=None)` — permission gate before approve/reject: explicit `current_actor_user`, delegate stage, direct manager (with `get_active_delegation` override), or role approvers (`hr`/`cfo`/`ceo`/`disbursement`).
- `get_workflow_snapshot(instance, *, actor=None)` — syncs, then returns `{status, current_stage, current_actor, can_approve, can_reject, can_cancel, can_edit, can_request_cancellation, can_withdraw_cancellation_request, cancellation_request, history}` for serializer use.
- `get_pending_approvals_for_user(user, limit)` / `get_pending_approvals_for_role(role, limit)` — inbox queries over `WorkflowInstance`.
- Delegation helpers live in `core/services/delegation.py` (`get_active_delegation`, `get_delegated_manager_user_ids`, ...).

## Frontend Patterns

- Inbox pages (LeaveInboxPage, LoanInboxPage) poll for `status=PENDING_<role>` items.
- Action buttons (Approve/Reject) call the relevant API endpoint, which transitions the request status and calls `sync_workflow`.
- After a decision, re-fetch the request details to reflect updated status.
- Show workflow history (all `WorkflowAction` entries) in the request detail view.
- Employee Current Requests (`FrontEnd/src/pages/employee/CurrentRequests.tsx`) is a cross-request summary for leave, permission, loan, and annual-leave settlements. Its cards link to request experiences; they do not themselves render a timeline. For leave, `MyLeaveRequestsPage` and `EmployeeLeaveRequestDetailsPage` are the concrete trail examples: `LeaveApprovalMap` shows stage progress; `ApprovalTimeline` shows recorded workflow events; `PendingActionBanner` shows who/stage currently has the request. Preserve a way for employees to reach equivalent real progress/history for the request kind being changed.
- Before changing a request screen or adding a request kind, trace its summary/list/detail route, typed API client, serializer, domain transition service, workflow adapter and recorded-history mode, role/delegate/company permissions, audit and notifications, obligations, translations, feature toggles, and relevant tests. Inspect toggle defaults and consumers first; do not change toggles unless the task asks.
- Do not claim the UI has approval-trail parity just because the backend has `workflow.history`. Confirm that the relevant employee detail route fetches and renders it. The annual-leave settlement shortcut currently navigates to the leave-balance page; verify whether a per-settlement detail/history view exists before treating it as equivalent to leave.
- **Never serialize workflow-backed detail responses without request context** — actor-specific flags such as `workflow.can_approve`, `workflow.can_reject`, and `workflow.current_actor` depend on `get_workflow_snapshot(obj, actor=request.user)`. Use serializers with `context={"request": request}` on custom retrieve/action responses, otherwise the frontend may hide valid approval buttons.
