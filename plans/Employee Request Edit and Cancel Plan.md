# Employee Request Edit and Cancel Plan

Status: **approved decisions; Phase 1 (pending cancel) backend implemented 2026-10-13; Phase 2 (edit before HR) backend done for leave + permission 2026-10-13** (`PATCH .../{id}/edit/`, `workflow.can_edit`, workflow action `edit`, migration `core/0016`); Phase 2 loan + asset return backend done 2026-10-14 (`PATCH /api/loans/loan-requests/{id}/edit/` while `submitted`/`pending_manager`, `PATCH /api/assets/return-requests/{id}/edit/` while `PENDING_MANAGER`, note only; no migration). **Phase 3 (cancellation request for approved items) backend done 2026-10-13**: one `core.CancellationRequest` model (generic FK, one pending per request) instead of per-model fields, employee `POST .../{id}/request-cancellation/` + `withdraw-cancellation-request/`, HR inbox `/api/core/cancellation-requests/` with `confirm`/`decline`, workflow actions `cancellation_requested`/`cancellation_declined`/`cancellation_withdrawn`, flags `workflow.can_request_cancellation`/`can_withdraw_cancellation_request`/`cancellation_request`, migration `core/0017`. Loan scope narrowed to `pending_disbursement` only; settlements to self-filed `approved` ones. Source: product owner answers, 2026-10-13. Routes and guards: `plans/API Route Status Matrix.md`.

## Decisions

| # | Decision |
|---|---|
| 1 | Employees can cancel their own **pending** requests, **including leave** (reverses the 2026-09-13 change in commit `f0f65124`). |
| 2 | Employees can **edit only until the request reaches the HR stage**. Once it is `pending_hr` (or later) the request is locked; the employee cancels and resubmits instead. |
| 3 | For **approved** requests, the employee does not cancel directly: they submit a **cancellation request that goes to HR**; HR confirms or declines. |

## Resulting rules per request kind

| Kind | Pending cancel (direct) | Edit window (before HR) | Approved: cancellation request to HR |
|---|---|---|---|
| Leave | `submitted`, `pending_delegate`, `pending_manager`, `pending_hr`, `pending_ceo`, `pending_hr_completion` | `submitted`, `pending_delegate`, `pending_manager` | `approved`; HR confirms via existing `hr-cancel` |
| Loan | existing `CANCELLABLE_STATUSES` | `submitted`, `pending_manager` | `approved`/`pending_disbursement`-onward until payroll deduction; never after `deducted` |
| Permission | `pending_manager`, `pending_hr` | `pending_manager` | `approved` (HR confirm also reverses the attendance adjustment) |
| Asset return | add `CANCELLED`; `pending_manager`, `pending`, `pending_ceo` | `pending_manager` | `approved` but not `processed` |
| Asset damage report | add `CANCELLED`; `pending_hr`, `pending_ceo` | none (starts at HR) | `approved` |
| Annual leave settlement | add cancel; `pending_hr`, `pending_ceo` | none (starts at HR) | `approved` before settlement/payment |
| Profile change | existing (`PENDING_HR`) | none (starts at HR); cancel + resubmit | n/a (final on decision) |

Consequence of decision 2: settlements, damage reports and profile changes start at HR, so they have **no edit window**. Their "edit" is cancel and resubmit.

## Backend design

- **Cancel (pending):** one `requester_cancel` service per module, same shape as `loans.services.apply_cancellation` (row lock, `begin_recorded_transition`, set `CANCELLED`, `record_workflow_transition`, `Action.CANCEL`). Leave also calls `close_leave_obligations` (ends the Business Trip delegation rule). Remove the `LeaveRequest` exclusion in `core/services/workflow_engine.py` `can_cancel`, replace `refuse_requester_cancellation`.
- **Edit (before HR):** `PATCH /{id}/` per module, reusing the create serializer (overlap/duplicate checks exclude the instance). Service records a new `EDIT` workflow action, re-notifies the current approver, re-syncs obligations/delegation (leave). Expose `workflow.can_edit` beside `can_cancel` in `get_workflow_snapshot`.
- **Cancellation request (approved):** extend each model, no new approval engine: `cancellation_requested_at`, `cancellation_requested_by`, `cancellation_reason`. Employee `POST /{id}/request-cancellation/` (reason required, only when approved and owner). HR sees these in the existing inbox; confirm calls the existing HR cancel service, decline clears the flag with a note. Record both as workflow actions and notify HR/employee.
- **Do not** allow edit or direct cancel after approval; payroll-linked states (loan `deducted`, settled settlement, processed return) are never cancellable.
- Migrations: asset return/damage `CANCELLED` choice; cancellation-request fields.

## Frontend design

- One shared action bar driven by `workflow.can_cancel`, `workflow.can_edit` and a new `workflow.can_request_cancellation`.
- Loan list switches from status check to the workflow flags.
- Create forms reused in edit mode; AR/EN strings; timeline renders "edited" and "cancellation requested/declined".
- Keep the approval-trail pages consistent (leave detail, loan detail, permission detail, settlement on balance page, My Assets tabs).

## Phases

1. **Pending cancel parity:** leave, settlement, asset return, damage report (+ enums/migrations, `can_cancel`, tests, docs).
2. **Edit before HR:** permission, loan, leave, asset return.
3. **Cancellation request for approved items** + HR inbox handling.

## Docs and tests to update with the change

- `.agents/context/workflow_engine.md` (leave rules line "Employees cannot cancel").
- `plans/API Route Status Matrix.md` (stale employee leave cancel row at line 110 plus new routes).
- Tests: `leaves/tests/test_referral_and_cancel_services.py`, `leaves/tests/test_existing.py`, per-module workflow tests, frontend request pages.

## Open items to verify before coding

- Settlement unique-per-cycle constraint (cancel must free the cycle).
- Damage report workflow adapter / recorded-history mode.
- Frontend leave detail page behaviour.
- Docker rebuild per `AGENTS.md` after backend/frontend changes (shared stack; working tree currently has many uncommitted changes from other sessions).
