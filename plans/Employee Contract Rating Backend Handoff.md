# Employee Contract Rating backend handoff

Implemented from `C:/Users/Asus/.claude/plans/new-feature-employee-soft-sparkle.md`. This handoff describes the final backend-only design. The frontend was intentionally not changed.

## Final workflow

1. The hourly task creates one rating per current contract cycle when expiry is within 90 days. It starts in `PENDING_HR_GATE` and notifies HR only.
2. HR makes one irreversible routing choice: `RATE` opens the parallel evaluation cycle and notifies the manager and employee; `SKIP_TO_CEO` notifies CEO approvers and never exposes the cycle to either rater.
3. On the `RATE` path, the current manager (or delegate) and employee independently submit the same 18 bilingual criteria plus an overall remark. Responses contain no recommendation, proposed change, salary, title, or position fields. After both responses, the rating moves directly to `PENDING_CEO`.
4. On the `SKIP_TO_CEO` path, the rating moves directly to `PENDING_CEO` with no response rows. Return-for-correction actions are invalid because there is nothing to return.
5. The CEO approver (or delegate) may request one advisory HR comment, return collected responses, or make the final decision.
6. Final decisions are `RENEW`, `RENEW_WITH_CHANGES`, and `TERMINATE`. `RENEW_WITH_CHANGES` requires CEO-approved salary terms and an effective date and applies exactly once after snapshot validation.
7. `TERMINATE` records a scheduled outcome. The hourly task archives/deactivates the employee atomically at contract expiry. HR acknowledgement is record-only and never gates execution.

The independent `ContractDecision` workflow remains available and unchanged. A finalized or changed standalone decision makes a linked rating require manual resolution rather than silently rewriting either workflow.

## API contract

All routes require authentication, the authorized active-company header, and the existing success/error envelopes. Lists use `StandardPagination` (`data.items`).

| Method | Route | Payload / behavior |
|---|---|---|
| GET | `/contract-ratings/criteria/` | Returns the authoritative 18 criteria and grade ranges. |
| GET | `/contract-ratings/` | Company-scoped, role-shaped list; optional `status` filter. |
| GET | `/contract-ratings/{id}/` | Company-scoped, role-shaped detail. |
| GET | `/contract-ratings/{id}/pdf/` | Privacy-shaped PDF; coarse HR access is denied until a CEO requests HR input. |
| POST | `/contract-ratings/{id}/hr-gate/` | `{rating_mode: "RATE" | "SKIP_TO_CEO"}`; HR-only, one-time routing decision. |
| POST | `/contract-ratings/{id}/manager-response/` | `{criterion_ratings, overall_remark?}`. |
| POST | `/contract-ratings/{id}/employee-response/` | `{criterion_ratings, overall_remark?}`. |
| POST | `/contract-ratings/{id}/request-hr-comment/` | Empty body; CEO approver only; idempotent. |
| POST | `/contract-ratings/{id}/hr-comment/` | `{comment}`; HR approver only and only after the rating-specific request. A late advisory comment is accepted after `DECIDED`. |
| POST | `/contract-ratings/{id}/ceo-decision/` | `{ceo_decision, comment?, ceo_approved_terms?, salary_effective_date?}`. |
| POST | `/contract-ratings/{id}/acknowledge-termination-notice/` | Empty body; HR only; idempotent record keeping. |

CEO return values are `RETURN_TO_MANAGER`, `RETURN_TO_EMPLOYEE`, and `RETURN_TO_BOTH`; each requires a reason in `comment`. Final values are `RENEW`, `RENEW_WITH_CHANGES`, and `TERMINATE`. Salary fields are rejected for all other actions.

Each criterion value must be exactly `{grade, score, remark}`. Scores are integers from 0 through 100 and must fall within the selected grade range. Server code calculates averages and grades; submitted computed values are ignored. Unknown decision/proposal fields are rejected with the standard 422 envelope.

## Privacy and authorization

- Employees and managers have no access before HR chooses `RATE`, and no access at any time on `SKIP_TO_CEO`. On a rated cycle they receive only the safe header plus their own response. The other response, comparison, HR/CEO content, salary data, termination result, notifications, and workflow history are structurally absent.
- A rater who also has a privileged group still receives the rater-shaped payload for that employee.
- HR receives a coarse record by default. While the gate is pending it additionally sees the fresh `account_connected` signal and gate fields. Full responses and comparison unlock only for the rating for which a CEO requested input. After a final decision, HR also receives the final operational outcome.
- CEO visibility is pending CEO work plus ratings decided by that CEO actor. CEO sees both responses and comparison.
- Company scope, workflow authorization, live manager relationships, delegation, and active-company write checks are enforced server-side.
- An HR/CEO actor cannot review or decide a rating when that actor authored its manager response.

## Safety, audit, and notifications

All workflow mutations lock the rating, employee profile, and linked standalone decision and recheck company, contract-cycle, archive, and standalone-decision snapshots. Conflicts move the rating to `MANUAL_RESOLUTION_REQUIRED` and notify HR. Salary and termination writes are transactionally coupled to workflow/audit history.

Milestones are persisted and retried by the hourly task:

- Creation: HR only, for the routing decision.
- Gate `RATE`: manager and employee; gate `SKIP_TO_CEO`: CEO approvers only.
- 65-day pending gate: HR. On a rated incomplete cycle: CEO approvers plus only the missing raters.
- Both responses submitted and periodic pending reminder: CEO approvers.
- HR comment requested: HR; HR comment submitted: requesting CEO.
- Final decision: HR and, only for `RATE`, the manager; never the employee.
- Termination executed: HR and, only for `RATE`, the manager.

Audit/history covers creation, response submission/resubmission, HR request/comment, CEO return/final decision, salary application, termination acknowledgement/execution, and manual-resolution conflicts.

## Migrations and compatibility

`contract_ratings.0002_final_decision_flow` removes manager proposal/recommendation and mandatory HR-review columns and adds advisory HR and CEO-decision columns. `contract_ratings.0003_hr_rating_gate` adds the one-time gate fields and safely marks every pre-gate historical row as `RATE` because `SKIP_TO_CEO` did not exist when those rows were created. Existing public `/contract-ratings/` paths remain stable. Removed endpoints intentionally return 404:

- `/contract-ratings/{id}/hr-review/`
- `/contract-ratings/{id}/positions/`

The employee contract-decision endpoint exposes only the authorized rating summary `{status, ceo_decision, ceo_comment}`.

## Verification evidence

See `docs/testing/employee-contract-rating-final.tdd.md` for red/green evidence. Current focused results:

```text
pytest contract_ratings -q --tb=short
134 passed

pytest contract_ratings -q --cov=contract_ratings --cov-report=term-missing
134 passed, 95% total coverage

pytest employees -q --tb=short
375 passed, 3 third-party deprecation warnings, 16 subtests passed
```

The suite covers all states and both HR-gate branches, role-shaped list/detail privacy, permissions and delegation, self-dealing, returns/resubmission, salary success/mismatch/rollback/idempotency, scheduled termination success/conflict/rollback/idempotency, notification routing/retry, scheduler boundaries, and coexistence with standalone `ContractDecision`. Six authenticated direct-API walkthroughs cover the plan's backend end-to-end scenarios.

## File inventory

| File | Purpose |
|---|---|
| `Backend/contract_ratings/criteria.py` | Authoritative bilingual criteria and grade ranges. |
| `Backend/contract_ratings/models.py` | Final response, HR advisory, CEO outcome, salary, termination, and notification state. |
| `Backend/contract_ratings/scoring.py` | Strict validation and server-side scoring/comparison. |
| `Backend/contract_ratings/permissions.py` | Company access and privacy role selection. |
| `Backend/contract_ratings/serializers.py` | Final write contracts and structural read shaping. |
| `Backend/contract_ratings/services.py` | Locked transitions, guards, audit, salary application, and acknowledgement. |
| `Backend/contract_ratings/tasks.py` | Opening/reminder/retry processing and scheduled termination. |
| `Backend/contract_ratings/views.py` | Final REST actions and PDF/criteria endpoints. |
| `Backend/contract_ratings/pdf.py` | Role-aware printable representation. |
| `Backend/contract_ratings/workflow.py` | Workflow template projection. |
| `Backend/contract_ratings/migrations/0002_final_decision_flow.py` | Legacy final-decision schema transition. |
| `Backend/contract_ratings/migrations/0003_hr_rating_gate.py` | One-time HR gate fields and safe legacy mode backfill. |
| `Backend/contract_ratings/tests/test_final_gate.py` | Both gate branches, access, account signal, skip decisions, and notifications. |
| `Backend/contract_ratings/tests/test_final_api_walks.py` | Authenticated end-to-end REST walkthroughs for the final scenarios. |
| `Backend/contract_ratings/tests/test_final_phase1.py` | Response/scoring/state tests. |
| `Backend/contract_ratings/tests/test_final_phase2.py` | CEO, HR advisory, privacy, salary, API tests. |
| `Backend/contract_ratings/tests/test_final_phase3.py` | Scheduler and notification tests. |
| `Backend/contract_ratings/tests/test_final_phase45.py` | Scheduled termination tests. |
| `Backend/contract_ratings/tests/test_final_hardening.py` | Delegation, list privacy, boundaries, and conflict hardening. |
| `Backend/employees/contract_expiry.py` | Shared contract-term writer; standalone flow remains unchanged. |
| `Backend/employees/serializers.py` | Minimal authorized rating summary on contract decisions. |
| `Backend/core/services/workflow_engine.py` | Workflow template registration and inbox metadata. |
| `Backend/config/celery.py` | Hourly rating processing schedule. |

No frontend files are part of this backend delivery.
