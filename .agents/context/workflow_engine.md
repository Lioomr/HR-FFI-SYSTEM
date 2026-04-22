# Workflow Engine Context

> **TL;DR:** `core` app defines a shared approval engine. Models: `WorkflowDefinition`, `WorkflowStageDefinition`, `WorkflowInstance`, `WorkflowAction`, `DelegationRule`, `RequestObligation`. Never write status fields directly — call `core.services.advance_workflow(instance, actor, decision, comment)`. Resolve next actor with `get_pending_approver_for_instance(instance)` (respects delegation). Use `can_actor_approve(user, instance)` to gate buttons. Serialize workflow-backed detail responses with `context={"request": request}` so `workflow.can_approve` / `can_reject` / `current_actor` resolve — otherwise the frontend hides valid buttons. Chains: Leave Employee→Manager→HR→CEO (CEO optional), Loan →Manager→HR→CFO→CEO, Asset →Manager→CEO.

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

1. Create or reuse a `WorkflowDefinition` + `WorkflowStageDefinition` records (via migration data or admin).
2. On request creation, create a `WorkflowInstance` linked to the request object.
3. Each approval action creates a `WorkflowAction` record.
4. Emit an `AuditLog` entry at each stage transition.
5. On final approval/rejection, update the parent request `status` field.
6. Notify the next approver (via Bird notification service if configured).

## Key Service Functions

`Backend/core/services.py`:
- `get_pending_approver_for_instance(instance)` — returns User who should act next (respects delegation)
- `advance_workflow(instance, actor, decision, comment)` — advances to next stage or finalises
- `can_actor_approve(user, instance)` — permission check before showing approve/reject buttons

## Frontend Patterns

- Inbox pages (LeaveInboxPage, LoanInboxPage) poll for `status=PENDING_<role>` items.
- Action buttons (Approve/Reject) call the relevant API endpoint that triggers `advance_workflow`.
- After a decision, re-fetch the request details to reflect updated status.
- Show workflow history (all `WorkflowAction` entries) in the request detail view.
- **Never serialize workflow-backed detail responses without request context** — actor-specific flags such as `workflow.can_approve`, `workflow.can_reject`, and `workflow.current_actor` depend on `get_workflow_snapshot(obj, actor=request.user)`. Use serializers with `context={"request": request}` on custom retrieve/action responses, otherwise the frontend may hide valid approval buttons.
