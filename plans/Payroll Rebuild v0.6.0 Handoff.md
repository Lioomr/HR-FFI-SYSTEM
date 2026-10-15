# HANDOFF REPORT — Payroll executive exemption v0.6.0

Date: 2026-10-14 (Africa/Cairo). Scope: the authorized executive payroll rule. No FrontEnd/MobileApp edit, production operation, commit or push. Other shared-checkout work was preserved.

## 1. What was done (files changed, migrations)

`Backend/payroll/engine.py` uses the existing `core.executives.is_executive_profile` once per company profile during input normalization. It passes the derived boolean to the calculator and freezes it in `item.input_snapshot.source.executive_exempt`. The classifier/title list itself was not modified or duplicated. Profile loading includes the existing position relation used by that helper.

`Backend/payroll/calculator.py::EmployeeInput` adds private `executive_exempt` and `accommodation_assignment_present` booleans, default false. The second flag distinguishes no assignment from an existing unknown/incomplete assignment. No model column, migration, company setting, endpoint or role was added.

For exempt subjects the calculator ignores attendance ABSENT dates, omits attendance-source warning/manual-confirmation facet, pays entered normal overtime without its cap/limit warnings, and treats genuinely unassigned accommodation as none/0 without accommodation incompleteness. Approved unpaid leave, paid-leave protection, audited absence overrides, existing accommodation assignments and other costs still use the normal rules. Raw attendance/mapping evidence remains in the private source snapshot; exemption does not fabricate mapping coverage.

Both engine candidate normalization and the pure calculator skip AttendancePayrollDeduction late fines. Existing mutable draft claims release via the existing audited mechanism when classification changes; their assessed source amount remains intact. Eligible disciplinary PenaltyRecord/PenaltyDeduction claims retain normal collection, exact cap, affordability and warnings. Salary/proration, both provision modes, GOSI, day-based work, loans and authorized carry balances are unchanged. Other blocking/input/revision errors are preserved; there is no generic error/warning filter.

`Backend/payroll/dto.py` exposes the readonly HR flag, reports attendance-derived absence as0 and manual_confirmation_required=false for exempt items. Existing attendance coverage fields retain actual evidence. Classification changes are audited as existing EMPLOYMENT_INPUT_CHANGE adjustments; completed/paid snapshots are not reclassified on GET.

Tests: extended `Backend/payroll/test_calculator.py`; added `Backend/payroll/test_executive_payroll.py`, reusing the existing integration fixture/helpers. They cover CEO group/exact titles/negative Assistant General Manager, accountless GM, mapping/confirmation/warning counts, preserved money, unlimited normal overtime, recorded absence/unpaid leave/manual overrides, assigned/unknown accommodation, medical incompleteness, blocking errors, readonly flag, frozen history, employee privacy and attendance-claim release with disciplinary collection.

Docs/fixtures: `plans/Payroll Rebuild API Contract.md`, payroll portion of `plans/API Route Status Matrix.md`, `Backend/payroll/contract_examples.json` and this report. Applied migrations0005/0006 remain restored; no migration was created.

## 2. Contract status: changed since last report (Contract changes)

Contract **v0.5.4 → v0.6.0**. Changed public DTO field: **I.executive_exempt added**, a readonly HR-only boolean identifying the exemption used by the stored calculation. Employee payslip DTOs/PDFs do not expose it. Legacy snapshots with no flag return false; current profile classification is not guessed on read. Existing DTO fields retain their shapes; the specified absence/accommodation/overtime values now reflect the executive rule.

New rules are in section2.7: no attendance-record absence/source-confirmation requirement, uncapped normal overtime without limit warnings, no-assignment accommodation none/0, and no attendance late-fine claiming. Existing assignments, approved unpaid leave/manual absence and disciplinary claims remain applicable; other errors/financial rules remain unchanged. Section6 defines/examples the HR flag; section10 adds executive golden rows; section12 records exact delivery/boundaries. The matrix records these implemented rules without adding paths.

**No validation code was added.** The existing report has only error/warning channels, so visibility uses the permitted DTO fallback. `executive_attendance_exempt` is not emitted; severity info is not introduced. Error/warning count keys, response channels and can_finalize semantics remain unchanged, with values computed after exemption. Counts remain **44 validation codes,121 enum entries,148 bilingual keys,16 JSON examples**. Only I gains a field; every prior example field/value and the other15 examples remain unchanged. All10 stored fixtures match the contract.

No endpoint, role, setting, schema migration, enum value, HTTP status code or error-body shape changed. CFO's existing payroll access and FULL_MONTH configurable/snapshotted default remain unchanged.

## 3. Commands run and their results (tests passed/failed with counts)

| Final check | Result |
|---|---|
| Required PostgreSQL payroll/penalties/loans | **434 passed,0 failed,0 skipped**, **71 warnings**, **37 subtests passed**, **125.44s**. |
| SQLite calculator/foundation/new-chain/Phase2/executive integration | **201 passed,1 expected PostgreSQL-only skip**, **26.32s**. |
| System check / migration drift | No issues / no changes detected. |
| Restored applied migrations0005/0006 | Match Git HEAD; exit0/no diff. |
| Ruff lint/format | Passed for all5 touched current Python files. |
| Contract/fixtures |16 valid examples; all10 fixtures match; only I gains executive_exempt;44 codes/121 enum entries unchanged. |

Exact final pytest outputs:

```text
434 passed, 71 warnings, 37 subtests passed in 125.44s (0:02:05)
201 passed, 1 skipped in 26.32s
```

```powershell
.\tools\dev-compose.ps1 up -d --build backend notification-worker celery-beat
docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_v060_final backend pytest payroll/ penalties/ loans/ -q --disable-warnings --maxfail=8
docker compose -f docker-compose.dev.yml exec -T -e DB_ENGINE=django.db.backends.sqlite3 -e DB_NAME=:memory: backend pytest payroll/test_calculator.py payroll/test_foundation.py payroll/test_foundation_sqlite.py payroll/test_phase2.py payroll/test_executive_payroll.py --nomigrations -q --disable-warnings --maxfail=8
docker compose -f docker-compose.dev.yml exec -T backend python manage.py check
docker compose -f docker-compose.dev.yml exec -T backend python manage.py makemigrations --check --dry-run
docker compose -f docker-compose.dev.yml ps backend notification-worker celery-beat
git diff --exit-code HEAD -- Backend/payroll/migrations/0005_attendancepayrolldeduction.py Backend/payroll/migrations/0006_attendancepayrolldeduction_claim_state.py
python -m ruff check Backend/payroll/calculator.py Backend/payroll/engine.py Backend/payroll/dto.py Backend/payroll/test_calculator.py Backend/payroll/test_executive_payroll.py
python -m ruff format --check Backend/payroll/calculator.py Backend/payroll/engine.py Backend/payroll/dto.py Backend/payroll/test_calculator.py Backend/payroll/test_executive_payroll.py
```

Initial focused run: **103 passed,6 failed**. The new tests used stale in-memory run objects after PATCH, adding synthetic reconciliation errors/old counts; refreshing those objects corrected the assertions. The next required run was **428 passed,5 failed,71 warnings,37 subtests passed** (114.94s); SQLite was **195 passed,5 failed,1 skipped** (24.54s). These remaining failures were a new test's KeyError: it incorrectly assumed can_finalize was persisted in validation_snapshot. The assertion now derives it from stored issues and also checks the real API report. These were test corrections; no errors were suppressed or required checks weakened. The final runs also include the additional accountless GM golden case.

System check: no issues. Migration drift: no changes detected. Applied migration comparison: exit0/no diff. The five touched current Python files pass Ruff lint/format; restored migrations were not reformatted. Documentation comparison confirms only I gains executive_exempt and the enum/code/example counts above are unchanged. Rebuilt backend, notification-worker and celery-beat are healthy; local stamp commit2e59eb49d32d, dirty=true (shared checkout).

## 4. Assumptions you made and open questions

No new policy question is required to implement the authorized rule. Exemption is computed from the existing helper's current subject classification at draft calculation/recalculation time and stored for history. No-assignment means no active overlapping assignment in the payroll period; existing unknown/incomplete assignments retain ordinary handling. Previously authorized carry liabilities are not forgiven.

The conditional informational entry was omitted because it would require a new validation channel/schema; the readonly DTO flag provides the requested visibility without changing counts/channels. This is the explicitly permitted fallback.

## 5. Anything that the frontend agent must know

Consume HR I.executive_exempt as a boolean indicating the stored calculation's exemption; it is readonly and cannot be PATCHed. Do not expose it in employee payslips. Exempt items can have actual source_available=false/uncovered dates while manual_confirmation_required=false; use the latter and adjusted validation report for confirmation counts.

Normal overtime cap values remain visible as source data but are not applied for exempt employees. Missing accommodation reports none/0 only when there is no assignment; existing assignments and missing medical data retain their normal completeness behavior. Blocking errors still require correction even for executive subjects. Salary monthly inputs/manual_inputs, decimal formatting, paths, permissions, pagination, throttles and private/no-store rules remain unchanged. No FrontEnd/MobileApp implementation was edited.

## 6. Known gaps or things you could not verify

**Existing upstream conflict:** `Backend/penalties/views.py` excludes executive subjects and returns422 when creating a penalty for one; `penalties/services.py` excludes/withdraws executive automatic candidates. This task did not change those upstream APIs/services. Payroll still collects eligible issued disciplinary claims already in the database, including claims preceding promotion, and reports their normal cap/affordability warnings. Likewise, existing executive request-submission restrictions were not changed; approved leave already present remains a payroll input. No restriction was worked around in application code.

No live employee-data audit or production operation was performed. The full unrelated backend suite was not rerun; current required suites cover payroll/penalties/loans, and the focused SQLite suite covers the foundation/actual new migration chain and these integrations. Historical full-suite failures outside payroll remain recorded in the Phase2 report; they are not claimed fixed. Fresh-project SQLite setup still has older unguarded PostgreSQL migration limitations, so focused SQLite setup uses --nomigrations and separately exercises the new chain. No additional phase started.
