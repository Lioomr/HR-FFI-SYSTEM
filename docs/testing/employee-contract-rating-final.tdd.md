# Employee Contract Rating backend TDD evidence

Source plan: `C:/Users/Asus/.claude/plans/new-feature-employee-soft-sparkle.md`.

## User journeys

- HR makes the one-time `RATE`/`SKIP_TO_CEO` routing decision before any rater is contacted.
- A manager and employee independently submit the same decision-free 18-criterion evaluation.
- The CEO sees both responses, may request a non-blocking HR comment, and alone decides renew, renew with increase, terminate, or return one/both responses.
- A renew-with-increase salary mutation is atomic and exactly once.
- A terminate outcome remains scheduled until the contract expiry task processes it exactly once.
- Every viewer receives a company-scoped, structurally privacy-safe representation.

## Phase evidence

| Phase | RED evidence | GREEN evidence | Guarantee |
|---|---|---|---|
| 1 - responses | `pytest contract_ratings/tests/test_final_phase1.py -q --tb=short`: 6 failed, 21 passed | Same command: 27 passed | Final response model has no recommendation/proposal fields; exact scoring validation; idempotent cycle creation; direct-to-CEO state transition. |
| 1.5 - shared term writer | Existing extraction already present; no production change required | `pytest employees -q --tb=short`: 375 passed, 3 third-party warnings, 16 subtests passed | `finalize_decision()` behavior, including standalone immediate termination, remains unchanged. |
| 2 - CEO and optional HR input | `pytest contract_ratings/tests/test_final_phase2.py -q --tb=short`: collection failed because `request_hr_comment` was absent | Phase 1 + 2 command: 55 passed | HR is coarse by default and advisory only after a CEO request; rater privacy is structural; CEO returns are per-side; salary application is validated, atomic, exactly once, and mismatch-safe. |
| 3 - milestones and notifications | `pytest contract_ratings/tests/test_final_phase3.py -q --tb=short`: 3 failed, 14 passed | Phase 1 + 2 + 3 command: 72 passed | 90-day creation is idempotent; 65-day incomplete notices go to CEO approvers, pending-rater reminders are targeted, HR is excluded until requested/final, and failed dispatches retry. |
| 4.5 - scheduled termination | `pytest contract_ratings/tests/test_final_phase45.py -q`: 8 failed, 1 passed | Same command: 9 passed | Termination is delayed until expiry, atomic, idempotent, conflict-safe, and independent from the record-only HR acknowledgement and standalone contract-decision flow. |
| Final HR gate | `pytest contract_ratings/tests/test_final_gate.py -q --tb=short`: collection failed because `submit_hr_gate_decision` was absent | Same command: 20 passed | Creation notifies HR only; Rate opens the evaluations; Skip reaches CEO with no responses or rater access; account linkage, delegation, reminders, final outcomes, and no-manager notifications are enforced. |
| Click-through response gaps | `pytest contract_ratings/tests/test_final_api_walks.py -q --tb=short`: 3 failed, 3 passed | Same command: 6 passed; full module: 134 passed | CEO return actions preserve CEO-shaped response data, skipped cycles expose the HR router's display name, and HR's coarse termination outcome includes notice-acknowledgement data. |

## Coverage and remaining phases

- Pre-gate contract-rating suite: `pytest contract_ratings -q --tb=short`: **105 passed**.
- Pre-gate coverage: `pytest contract_ratings -q --cov=contract_ratings --cov-report=term-missing`: **105 passed, 93% total coverage**.
- Hardening matrix: delegated manager/HR/CEO actions, HR self-dealing, list privacy, salary validation/decrease, snapshot conflicts, scheduler boundaries, historical cycles, and unauthorized routes: **24 passed**.
- Final consolidated suite: `pytest contract_ratings -q --cov=contract_ratings --cov-report=term-missing`: **134 passed, 95% total coverage**.
- Full employee regression: `pytest employees -q --tb=short`: **375 passed, 3 third-party deprecation warnings, 16 subtests passed in 289.58s**.
- Direct authenticated API walks: **6 passed** covering rated salary change, return/resubmit plus HR advisory, scheduled termination, manual resolution, no-HR-comment decision, and Skip-to-CEO/no-return behavior.
- Django checks: `makemigrations contract_ratings --check --dry-run --skip-checks` reported no changes; `manage.py check` reported no issues.
