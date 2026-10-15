# HANDOFF REPORT — Legacy payroll presentation v0.6.1

Date: 2026-10-15 (Africa/Cairo). Scope: the verifier's legacy-run DTO/reconciliation and finalized-validation corrections. No production query or operation, FrontEnd/MobileApp edit, commit or push.

## 1. What was done (files changed, migrations)

`Backend/payroll/dto.py` now checks legacy reconciliation against active item net and count only. Payslip net/count remain visible but do not determine a legacy match. Nonlegacy aggregate, per-item, line, payslip and rent checks remain strict.

A shared read projection supplies run and summary totals. For legacy runs, gross is the exact sum of active paid basic_salary + total_allowances; additions, provisions and company cost are null, and cost_incomplete is true. Stored totals, snapshots, items and payslips are unchanged by these reads. Other totals and modern calculations are unchanged.

COMPLETED/PAID validation reports have finalize_state finalized, can_finalize true, errors [] and zero blocking count. Existing blocking issues are retained under infos with severity info; code/message/params and stored snapshots remain intact. Warnings stay warnings. DRAFT blocking semantics, existing transition guards and publication reconciliation enforcement remain unchanged. Nonfinalized runs report finalize_state not_finalized; this includes CANCELLED without changing its existing behavior.

`Backend/payroll/api.py` adds info severity filtering to the existing validation-report route, including employee/code filters. Global counts and finalization state remain independent of filters.

`Backend/payroll/i18n.py` and the English/Arabic `Backend/payroll/locale/{en,ar}/LC_MESSAGES/django.po`/`.mo` expose the new severity/state labels. `Backend/payroll/contract_examples.json`, `Backend/payroll/test_foundation.py` and `Backend/payroll/test_phase2.py` update enum/catalog/DTO checks. New `Backend/payroll/test_legacy_presentation.py` contains nine regression cases, including the 52-item/33-payslip fixture, exact halalas, inactive records, incorrect legacy item net/count, unchanged modern strictness, finalized informational issues, draft blockers and filtering.

Documentation changed: `plans/Payroll Rebuild API Contract.md`, payroll portion of `plans/API Route Status Matrix.md`, and this report. No model or migration changed; applied migrations0005/0006 remain identical to HEAD.

## 2. Contract status: changed since last report (Contract changes)

Version0.6.0 ->0.6.1. Changed sections: header;2.7 (clarifies the new finalized projection independently of executive classification);5 (enums/catalog);6 (V schema/examples);7.3 (info filter);9 (legacy projections and complete example);10 (golden requirements);12 (amendment record).

- R.total_gross and summary.total_gross_salary derive active legacy paid amounts exactly, without rerounding or persistence. R/summary total_additions, total_provisions and total_company_cost now return null for legacy runs; their cost_incomplete is true. Existing net/deduction/category-breakdown fields remain unchanged; a zero line breakdown is not evidence that historical additions/provisions were computed.
- V adds finalize_state: finalized|not_finalized, and infos: issue[]. Informational issues have severity info. On finalized runs only, historic errors move to infos, errors/counts.errors become empty/0 and can_finalize is true. counts retains its existing errors/warnings keys; infos increment neither. Run/summary validation_counts use the same projection. A false reconciliation.matches remains visible even when finalization is already complete.
- Existing GET `/payroll-runs/{run_id}/validation-report/` accepts severity=info. No new path/method, role, setting, status code or error-envelope shape. Existing successful HTTP responses remain200; existing invalid-filter/transition/publication errors retain their codes/envelopes.
- Enum additions: validation_severity.info and finalize_state values finalized/not_finalized. New bilingual keys: payroll.validation_severity.info, payroll.finalize_state.finalized, payroll.finalize_state.not_finalized. No new validation code: exactly44 codes,124 enum entries and151 catalog keys per language.
- Examples: enum directory and V updated; one combined legacy R/summary/V example added. Exactly17 valid JSON blocks and11 stored fixtures. Other original JSON examples are unchanged.

No other contract rules, calculation formulas, settings/defaults, permissions, DTO fields, routes or employee-facing payslip representations changed. The executive exemption remains unchanged and emits no new executive info code.

## 3. Commands run and their results (tests passed/failed with counts)

Required PostgreSQL suites: `docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_v061_final backend pytest payroll/ penalties/ loans/ -q --disable-warnings --maxfail=8`: **455 passed,0 failed,0 skipped,71 warnings,44 subtests passed**,122.07s. Collection breakdown: payroll229, penalties103, loans123; all passed. Log: `.codex-v061-required.log`.

SQLite focused verification: `docker compose -f docker-compose.dev.yml exec -T -e DB_ENGINE=django.db.backends.sqlite3 -e DB_NAME=:memory: backend pytest payroll/test_legacy_presentation.py payroll/test_phase2.py payroll/test_foundation.py --nomigrations -q --disable-warnings --maxfail=8`: **99 passed,0 failed,1 expected PostgreSQL-only exclusion-constraint skip**,9.93s. Log: `.codex-v061-sqlite.log`.

Initial runs found two fixture errors: model creation retained total_net as a Python string until refresh. API read cases already passed; direct DTO assertions needed a persisted-model refresh. Corrected the fixture with refresh_from_db. Initial PostgreSQL:453 passed,2 failed,71 warnings,44 subtests,122.09s. Initial SQLite:97 passed,2 failed,1 skipped,10.26s. Logs are retained as `.codex-v061-{required,sqlite}-initial.log`; final runs above replace them as current evidence. No application-code change was needed for those failures.

`manage.py check`: no issues. `manage.py makemigrations --check --dry-run`: no changes. `git diff --check`: passes. Applied migration0005/0006 diff: empty.

Ruff checks pass for dto.py, i18n.py and the new test module; six touched Python files pass formatting. api.py/test_foundation.py/test_phase2.py pass Ruff with I001 excluded: each already has an import-order I001 at HEAD, verified separately, and those unrelated imports were preserved. JSON examples/fixtures and English/Arabic compiled catalog parity checks pass.

Local stack: `tools/dev-compose.ps1 up -d --build backend notification-worker celery-beat` succeeded (commit stamp f39ecacab0bc, dirty=true). All three services are healthy; runtime source inspection confirms the new totals and finalized projection. After the fixture correction, only the test file was copied into the test container; application code was unchanged after the build. Full backend suite was not rerun for this scoped DTO change.

## 4. Assumptions you made and open questions

No unresolved payroll rule question. Used the existing boolean can_finalize as a presentation readiness signal: true on finalized runs, paired with finalize_state finalized. It does not authorize editing or a new lifecycle transition. Info entries have their own array so historical errors remain visible without inflating error/warning counts.

The production-shaped fixture is synthetic:52 active items,33 login-linked payslips, stored gross0, item/run net57239.00, and exact derived gross62439.00. No live employee records were inspected or modified.

## 5. Anything that the frontend agent must know

Use V.finalize_state finalized to show “Finalized”; keep action availability tied to run status. Render V.infos as informational and retain its issue details. Existing warnings remain warnings; severity=info can filter the informational list. Global counts are unfiltered and exclude infos.

Handle null legacy additions/provisions/company-cost totals as unknown, with cost_incomplete true. Run uses total_gross; summary retains its existing total_gross_salary name. Payslip coverage can be33/52 while legacy reconciliation matches. Employee-facing payslip DTOs are unchanged. FrontEnd/MobileApp were not edited.

## 6. Known gaps or things you could not verify

No production replay or full backend rerun was performed. Verification covers the requested app suites and synthetic production-shaped legacy data. SQLite uses --nomigrations because older unrelated migrations still contain PostgreSQL-only DDL; the existing PostgreSQL-specific test is deliberately skipped there. No new schema or migration is introduced by this change.
