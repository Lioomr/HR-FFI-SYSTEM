# Workflow Engine Context

> **TL;DR:** `core` app defines a shared approval engine. Models: `WorkflowDefinition`, `WorkflowStageDefinition`, `WorkflowInstance`, `WorkflowAction`, `DelegationRule`, `RequestObligation`. The engine is a **projection layer**: the domain request models (LeaveRequest, LoanRequest, …) own their `status` field — views transition the status per stage, then call `core.services.sync_workflow(instance, actor=request.user)` to mirror state into `WorkflowInstance`/`WorkflowAction`. Never write those two models directly. Gate actions with `can_user_act_on_instance(user, instance)` (respects delegation). Serialize workflow-backed detail responses with `context={"request": request}` so `workflow.can_approve` / `can_reject` / `current_actor` resolve — otherwise the frontend hides valid buttons. Chains: Leave Employee→Manager→HR→CEO (CEO optional), Loan →Manager→HR→CFO→CEO, Asset →Manager→CEO.

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

Default leave/loan flow: **Employee → Manager → HRManager → CEO** (CEO stage is optional per LeaveType/LoanRequest config)

Asset flow: **Employee → Manager → CEO**

Loan flow: **Employee → Manager → HRManager → CFO → CEO**

## Delegation Rules

- `DelegationRule` allows a manager to delegate their approval authority to another user for a date range.
- Backend must check delegation rules when resolving "who can approve this stage" — see `core/services.py`.
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

## Key Service Functions

`Backend/core/services/workflow_engine.py` (re-exported from `core.services`):
- `sync_workflow(instance, *, actor=None, workflow_key=None)` — atomic projection of the domain object's current status into `WorkflowInstance`, plus idempotent `WorkflowAction` history (deduped via `legacy_signature` metadata). Audits each new transition as `workflow_transition`. Call after every create/approve/reject/cancel in domain views.
- `can_user_act_on_instance(user, instance, workflow=None)` — permission gate before approve/reject: explicit `current_actor_user`, delegate stage, direct manager (with `get_active_delegation` override), or role approvers (`hr`/`cfo`/`ceo`/`disbursement`).
- `get_workflow_snapshot(instance, *, actor=None)` — syncs, then returns `{status, current_stage, current_actor, can_approve, can_reject, can_cancel, history}` for serializer use.
- `get_pending_approvals_for_user(user, limit)` / `get_pending_approvals_for_role(role, limit)` — inbox queries over `WorkflowInstance`.
- Delegation helpers live in `core/services/delegation.py` (`get_active_delegation`, `get_delegated_manager_user_ids`, ...).

## Frontend Patterns

- Inbox pages (LeaveInboxPage, LoanInboxPage) poll for `status=PENDING_<role>` items.
- Action buttons (Approve/Reject) call the relevant API endpoint, which transitions the request status and calls `sync_workflow`.
- After a decision, re-fetch the request details to reflect updated status.
- Show workflow history (all `WorkflowAction` entries) in the request detail view.
- **Never serialize workflow-backed detail responses without request context** — actor-specific flags such as `workflow.can_approve`, `workflow.can_reject`, and `workflow.current_actor` depend on `get_workflow_snapshot(obj, actor=request.user)`. Use serializers with `context={"request": request}` on custom retrieve/action responses, otherwise the frontend may hide valid approval buttons.
