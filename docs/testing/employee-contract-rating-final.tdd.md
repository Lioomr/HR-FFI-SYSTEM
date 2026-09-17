# Employee Contract Rating backend TDD evidence

Source plan: `C:/Users/Asus/.claude/plans/new-feature-employee-soft-sparkle.md`.

## User journeys

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

## Coverage and remaining phases

Phase 2, Phase 3, Phase 4.5, full-app coverage, manual API walks, and final hardening evidence will be appended as they complete.
