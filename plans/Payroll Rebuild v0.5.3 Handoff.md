# HANDOFF REPORT — Payroll contract v0.5.3 required fixes

Date: 2026-10-13 (Africa/Cairo). Scope: the verifier's assumption/catalog cleanup, restoration of the two applied migrations, and the same-version additive Item manual_inputs field. No new phase, frontend/mobile edit, production operation, commit or push. Shared-checkout work outside these fixes was preserved.

## 1. What was done (files changed, migrations)

Removed the retired provision-proration assumption from `Backend/payroll/calculator.py` and `Backend/payroll/settings_serializers.py`. Remaining policy assumptions are overtime base BASIC and normal-overtime limits per calendar month. The approved missing-hire-date data-quality fallback remains unchanged.

Removed its English/Arabic entries from `Backend/payroll/i18n.py`, `Backend/payroll/locale/{en,ar}/LC_MESSAGES/django.po` and regenerated both `django.mo` files. A stdlib PO compiler regenerated valid GNU catalogs; comparison against the preceding compiled catalogs proved that only the retired message was removed and every remaining translation/header was preserved. Current Item projection in `Backend/payroll/dto.py` suppresses only that retired entry if an older frozen result contains it; stored snapshots/audit history and money are not rewritten.

Updated existing checks in `Backend/payroll/test_calculator.py`, `test_foundation.py` and `test_phase2.py` to verify the remaining assumptions, 148-key EN/AR/source/compiled catalog parity and old-snapshot projection without rewriting evidence. The same-version manual-input addition also adds one golden/integration test; calculation rules are unchanged.

Updated `Backend/payroll/contract_examples.json` and the current contract. The route matrix only updates its payroll version pointer/default-access wording to match. This report records the exact changes.

Same-version addition: `Backend/payroll/dto.py` exposes I.manual_inputs as an explicit nine-field whitelist read from stored run-local overrides. Decimal entries retain their entered halalas/two decimals; absence override alone defaults to null, other numeric entries to0.00 and the boolean tofalse. `Backend/payroll/test_phase2.py` proves bonus250.50 stays250.50 in manual_inputs while its posted scalar/line is251.00, validates all nine fields/defaults and excludes the object from employee responses. No engine/calculator/write-path changes were needed for this addition.

Executed the requested Git checkout restoration of `Backend/payroll/migrations/0005_attendancepayrolldeduction.py` and `0006_attendancepayrolldeduction_claim_state.py`. Both now match Git HEAD without a diff. They were not subsequently formatted. **No new migration or schema change.**

## 2. Contract status: changed since last report (Contract changes)

Contract **v0.5.2 → v0.5.3**. Removed active pending-confirmation wording from provision-proration/default/access rules. `provision_proration` remains configurable and snapshotted, with FULL_MONTH default and PRORATED_BY_DAYS available. CFO keeps access; the allowlist was not edited.

Changed catalog key: **removed `payroll.assumption.provision_proration_pending`**, including its EN/AR messages and compiled entries. Bilingual message count is **148**, previously149. Earlier handoffs/version records remain historical evidence, not the current catalog count.

Changed examples versus v0.5.2: **S (company settings)** removes that single element from `data.assumptions`; **I (HR item)** adds only `manual_inputs`, with absence_days_override, overtime_normal_hours, weekly_rest_work_days, official_holiday_work_days, bonus, incentive, other_addition, other_deduction and override_overtime_eligibility. Both stored fixtures match. The other14 examples and every prior I field/value remain unchanged. The v0.5.2 monthly_salary_components/salary_adjusted fields remain unchanged. Current normal item/calculator assumption lists no longer contain the retired entry. The additive field was implemented solely in DTO projection: the existing rounded line scalars and write path are unchanged.

Changed contract areas: header version; section2 policy wording; section3 settings default description; section5 enum-default/catalog description; section6 S example; section7 writable-setting wording; section10 default-mode golden wording; section12 access/default wording and this amendment record. The route matrix changes only the payroll pointer/confirmation wording. The same-version addition updates the date, section6 I definition/example, section10 golden check and section12 addition record; the version remains0.5.3.

Changed public DTO field: **I.manual_inputs added**. No existing public field, path, enum, status code, error shape, monetary calculation, permission, setting default or other contract rule changed. Counts remain **16 JSON examples**, **121 enum entries**, **44 validation codes** and **148 bilingual keys**. The retired assumption entry/catalog key is removed; only the requested manual-input object is added.

## 3. Commands run and their results (tests passed/failed with counts)

Final required PostgreSQL suites including the additive field: **390 passed, 0 failed, 0 skipped**, **71 warnings**, **25 subtests passed**, in **114.99s**. Exact output:

```text
390 passed, 71 warnings, 25 subtests passed in 114.99s (0:01:54)
```

The preceding fix-only run on2026-10-12 passed389 tests, with71 warnings and25 subtests, in109.06s. That is historical evidence; the final result below includes the additional bonus/manual-input golden test.

Required suites were invoked **once** for the2026-10-13 manual-input addition (in addition to the preceding fix-only run):

```powershell
git checkout -- Backend/payroll/migrations/0005_attendancepayrolldeduction.py Backend/payroll/migrations/0006_attendancepayrolldeduction_claim_state.py
git diff --exit-code HEAD -- Backend/payroll/migrations/0005_attendancepayrolldeduction.py Backend/payroll/migrations/0006_attendancepayrolldeduction_claim_state.py
.\tools\dev-compose.ps1 up -d --build backend notification-worker celery-beat
docker compose -f docker-compose.dev.yml exec -T backend python manage.py makemigrations --check --dry-run
docker compose -f docker-compose.dev.yml exec -T backend python manage.py check
docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_v053_manual backend pytest payroll/ penalties/ loans/ -q --disable-warnings --maxfail=6
docker compose -f docker-compose.dev.yml ps backend notification-worker celery-beat
```

Restored migration comparison: exit0/no diff. After restoration and rebuild, `makemigrations --check --dry-run`: **No changes detected**. System check: **No issues (0 silenced)**. Ruff lint/format checks on the seven touched current Python files passed; applied migrations were excluded from formatting as requested.

Documentation/catalog comparisons for the two fixes passed: S loses one assumption,121 enum entries/44 codes remain unchanged, and EN/AR PO/MO/source catalogs contain148 message keys. For the manual-input addition, only I gains manual_inputs; every prior I field/value and all other fixtures remain unchanged. The earlier fix-only build was healthy. The manual-input addition initially could not rebuild because the Docker Desktop engine was stopped; it was started locally so verification could proceed. The retry succeeded: backend, notification-worker and celery-beat are all healthy (commit2e59eb49d32d, dirty=true). The stopped-engine failure was operational and did not require a code change.

## 4. Assumptions you made and open questions

No new policy assumption or open confirmation is introduced. FULL_MONTH remains the configurable/frozen default and CFO keeps access. The two remaining policy assumptions are BASIC overtime base and the calendar-month normal-overtime limit. Existing data-quality fallbacks and warnings are unchanged.

## 5. Anything that the frontend agent must know

Stop expecting the retired provision-proration entry in settings/item `assumptions`. The settings array retains the BASIC-overtime and calendar-month-limit entries. The v0.5.2 monthly input and salary-adjusted fields, proration semantics, PATCH/no-op behavior, permissions, pagination, decimals, throttles and error envelopes remain unchanged. No new translations need adding; one bilingual key was removed.

Prefill manual editor entries from I.manual_inputs rather than posted scalars. For example, bonus250.50 is still250.50 in manual_inputs even though the posted bonus is251.00. Absence null means no entered override, not zero observed absence. Other manual quantities/money default to0.00 and the override flag defaults tofalse. This object is HR-only and does not appear in employee payslip DTOs. Existing posted lines, calculations and editor write semantics are unchanged.

## 6. Known gaps or things you could not verify

The full backend suite and whole SQLite suite were not rerun for these narrow fixes and the additive DTO field; the required PostgreSQL payroll/penalties/loans suites were run once. The prior full-backend five failures outside payroll remain historical findings in the Phase2 handoff; this amendment does not claim to resolve them. Existing fresh-project SQLite bootstrap and offline employee-data verification limits remain unchanged.

Historical stored snapshots may still retain the retired assumption as evidence; current Item responses hide only that entry. No production data was modified. No additional phase started.
