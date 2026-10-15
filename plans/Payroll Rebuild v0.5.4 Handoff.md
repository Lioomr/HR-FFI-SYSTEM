# HANDOFF REPORT — Payroll contract v0.5.4 F4 corrections

Date: 2026-10-13 (Africa/Cairo). Scope: the verifier's ExactShare formatting fix and four wording clarifications only. No new phase, frontend/mobile edit, production operation, commit or push. Unrelated shared-checkout changes were preserved.

## 1. What was done (files changed, migrations)

`Backend/payroll/calculator.py::exact_share` now emits two-decimal numerator strings for newly calculated ExactShares. `Backend/payroll/dto.py` normalizes each rent report share, property aggregate and occupied-slot share, including older stored integer-string numerators, and formats summary rent_rounding_difference the same way. Its reconciliation parser accepts both old integer strings and decimal strings as exact Fractions. Denominators, decimal display approximations, ratios and posted amounts are unchanged; no rescaling or monetary rounding was introduced.

Existing XLSX and HR PDF exports consume rent_dto, so their raw numerator cells/text receive the same formatting. `Backend/payroll/exporting.py` and export layouts were not edited. Old stored rent snapshots are not rewritten by report/summary/export reads.

`Backend/payroll/test_calculator.py` adds one regression case covering0.00,1.00,-1.00 and1000.00/3, with exact ratio/denominator preservation. The existing rent integration scenario in `test_phase2.py` now simulates old integer-string snapshots and checks every ExactShare in the actual rent API response and summary, XLSX raw-numerator cells, PDF text, exact reconciliation and unchanged stored snapshots. No validation/permission/UI implementation changed.

Documentation changed: `plans/Payroll Rebuild API Contract.md`, the route matrix's payroll version pointer, and this report. **No migration/schema/catalog/default change.** Applied migrations0005/0006 remain restored and match Git HEAD.

## 2. Contract status: changed since last report (Contract changes)

Version **0.5.3 → 0.5.4**. Exact changes:

1. **ExactShare.numerator** is documented and implemented as a two-decimal string in all corresponding outputs, including rent reports, resident/occupied-slot shares, summary rent_rounding_difference and exports. For example1 becomes"1.00" and negative1 becomes"-1.00". Field names, denominator and decimal approximation do not change. Existing examples already used two decimals, so all16 JSON examples and10 stored fixtures remain unchanged.
2. **Wording only:** validation issue `field` is optional and omitted when absent, rather than required or a null placeholder. This documents the current implemented response; no error serializer was changed.
3. **Wording only:** `zero_salary_detail_required` is a **blocking finalization error**. An otherwise valid item PATCH accepts the change with200 and does not return422 for the missing detail itself; finalization returns422 until the detail is supplied. The validation-code table changes its description from blocking/422 to blocking(finalization); its enum value and implemented behavior are unchanged.
4. **Wording only:** I.warnings contains only severity=warning issues. Blocking errors, including suspended_pay_decision_required and zero_salary_detail_required, appear only in the validation report's errors array.
5. **Wording only:** CFO may create/update/soft-delete accommodation assignments through the API under the same role/company/reference/reason checks. The v1 UI is read-only for CFO; no backend permission or frontend implementation change is included.

Changed sections: header/version; **2.3**, **2.5**, **5** validation-code description, **6** I/V wording, **7.5** CFO note, and **12** amendment record. The route matrix changes only its payroll version pointer. No paths, DTO field names, enum values, implemented HTTP status codes/error responses, defaults, migrations, catalog keys or other rules changed. Counts remain **121 enum entries**, **44 validation codes**, **148 bilingual keys**, **16 JSON examples**.

## 3. Commands run and their results (tests passed/failed with counts)

Required PostgreSQL suites: **391 passed, 0 failed, 0 skipped**, **71 warnings**, **25 subtests passed**, in **108.44s**. Exact output:

```text
391 passed, 71 warnings, 25 subtests passed in 108.44s (0:01:48)
```

Required suites were invoked once for v0.5.4:

```powershell
.\tools\dev-compose.ps1 up -d --build backend notification-worker celery-beat
docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_v054 backend pytest payroll/ penalties/ loans/ -q --disable-warnings --maxfail=6
docker compose -f docker-compose.dev.yml exec -T backend python manage.py makemigrations --check --dry-run
docker compose -f docker-compose.dev.yml exec -T backend python manage.py check
docker compose -f docker-compose.dev.yml ps backend notification-worker celery-beat
git diff --exit-code HEAD -- Backend/payroll/migrations/0005_attendancepayrolldeduction.py Backend/payroll/migrations/0006_attendancepayrolldeduction_claim_state.py
python -m ruff check Backend/payroll/calculator.py Backend/payroll/dto.py Backend/payroll/test_calculator.py Backend/payroll/test_phase2.py
python -m ruff format --check Backend/payroll/calculator.py Backend/payroll/dto.py Backend/payroll/test_calculator.py Backend/payroll/test_phase2.py
```

Migration drift: **No changes detected**. System check: **No issues (0 silenced)**. Applied-migration comparison: exit0/no diff. Ruff: all checks passed; all4 current Python files formatted (the restored applied migrations were not formatted). Documentation comparison: all16 JSON examples and10 fixtures are unchanged;121 enum entries/44 codes remain. An inspection script initially hit Windows console encoding while printing Arabic text; rerunning inspection with UTF-8 avoided that output-only limitation.

The approved local wrapper rebuilt backend, notification-worker and celery-beat; all are **healthy**. Build stamp: commit2e59eb49d32d, dirty=true (shared checkout).

## 4. Assumptions you made and open questions

No new assumption, permission or policy choice. The formatting fix pads currency numerators without changing their exact values or denominator. Older stored integer numerators remain supported; reporting does not rewrite frozen evidence. FULL_MONTH remains configurable/snapshotted and CFO keeps its existing access.

## 5. Anything that the frontend agent must know

Read ExactShare.numerator as a decimal string with two decimals; never convert its display approximation into a pay/reconciliation source. Summary rent_rounding_difference and XLSX/PDF exports use the same numerator formatting.

Do not require `field` on every validation issue. Pull blocking errors from the validation report, not item.warnings. A successful item PATCH can still leave a blocking zero_salary_detail_required error for finalization. CFO accommodation API writes are allowed even though the v1 UI is read-only. Existing manual_inputs/monthly salary inputs, pagination, decimals for other money, throttles, tenant scoping and cache/privacy rules are unchanged.

## 6. Known gaps or things you could not verify

The full backend and whole SQLite suites were not rerun for these narrowly scoped corrections; the required PostgreSQL payroll/penalties/loans suites were run once. Prior full-backend failures outside payroll remain historical findings in the Phase2 handoff; this amendment does not claim to resolve them. Existing fresh-project SQLite bootstrap and offline employee-data verification limits remain unchanged.

No frontend/CFO UI implementation or production data was changed. No additional phase started.
