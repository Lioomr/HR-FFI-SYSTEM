# HANDOFF REPORT — Payroll contract v0.5.2 additive amendment

Date: 2026-10-12 (Africa/Cairo). Scope: the verifier's two additive Item DTO fields and the requested prefill/golden checks. No new phase, frontend/mobile edit, production operation, commit or push. Other shared-checkout work was preserved.

## 1. What was done (files changed, migrations)

`Backend/payroll/dto.py` exposes the six effective full monthly salary inputs from the run item's frozen `input_snapshot.source.salary` and a boolean derived from its active run-local salary override. It does not read current employee salary fields or reverse-prorate paid amounts. Existing item scalars and salary line arrays retain their paid amounts.

`Backend/payroll/api.py` compares validated PATCH salary inputs to those effective monthly inputs before recording overrides. Unchanged prefilled salary keys do not create an adjustment, pin automatic values or produce salary-adjustment audit history. A salary-only prefill with no effective change retains the existing422 `field_not_editable` behavior and leaves persisted money, snapshots, revision and history untouched. A prefill submitted with a bonus change applies/audits only the bonus. Other PATCH fields, reason/revision checks and errors are unchanged.

`Backend/payroll/test_phase2.py` adds four golden/integration cases: June16 joiner with automatic salary; the same joiner with an active Basic adjustment; unchanged salary prefill with a bonus edit; and unknown legacy inputs. The first two exercise actual GET/PATCH responses and unchanged paid values, snapshots, revision, audit and adjustment counts. They also prove that a later profile salary edit does not change editor defaults. Existing DTO shape checks explicitly retain121 enum entries/44 validation codes; the employee whitelist check rejects both new HR fields.

`Backend/payroll/contract_examples.json` updates only I. `plans/Payroll Rebuild API Contract.md` updates the header/version, section6 I definition/example, section7 prefill semantics, section10 golden rows and section12 amendment record. `plans/API Route Status Matrix.md` changes only its payroll contract version pointer to v0.5.2. This report records the amendment; the previous Phase2 handoff remains historical.

**Migrations: none.** No calculator, model, lifecycle, permission, default setting or translation changes.

## 2. Contract status: changed since last report (Contract changes)

Contract **v0.5.2**, as requested (previous local version v0.5.0). Changed public DTO: **I only**.

- Added `monthly_salary_components`: object with `basic_salary`, `accommodation_allowance`, `transportation_allowance`, `telephone_allowance`, `petrol_allowance`, `other_allowance`, each a two-decimal string representing the full effective monthly input, never prorated. For legacy records missing the original monthly snapshot the object is null; no profile/paid-value guess is made and existing legacy edit restrictions remain.
- Added `salary_adjusted`: boolean, true when a run-local salary override is active.

The I example remains a full-month example, so its monthly and paid values coincide. The contract explicitly distinguishes them: June16 joining with monthly Basic6,000 gives `monthly_salary_components.basic_salary="6000.00"` and paid `basic_salary="3000.00"`; an active monthly Basic6,100 correction gives6,100.00 versus3,050.00 and `salary_adjusted=true`.

Existing fields changed: **none**. Paths changed: **none**. Enums changed: **none**. Status codes/error shapes changed: **none**. All previous JSON example fields/values are preserved; exactly one of16 examples gains the two fields. Counts remain **121 enum entries**, **44 validation codes**, **149 bilingual keys**. No other contract rules changed.

## 3. Commands run and their results (tests passed/failed with counts)

| Check | Final result |
|---|---|
| Required PostgreSQL payroll/penalties/loans suites | **389 passed, 0 failed, 0 skipped**; 71 warnings, 25 subtests passed;99.06s. |
| SQLite calculator/foundation/new-migration-chain/Phase2 suites | **168 passed, 1 expected PostgreSQL-only skip**;21.39s. |
| System check / migration drift | No issues / no changes detected. |
| Ruff lint / formatting | All checks passed / all3 files formatted. |
| Documentation/enum/DTO checks |16 examples valid; only I gains two fields; all10 fixtures match;121 enum entries and44 codes unchanged. |
| Rebuilt local services | backend, notification-worker and celery-beat all healthy. |

```powershell
.\tools\dev-compose.ps1 up -d --build backend notification-worker celery-beat
docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_v052 backend pytest payroll/ penalties/ loans/ -q --disable-warnings --maxfail=3
docker compose -f docker-compose.dev.yml exec -T -e DB_ENGINE=django.db.backends.sqlite3 -e DB_NAME=:memory: backend pytest payroll/test_calculator.py payroll/test_foundation.py payroll/test_foundation_sqlite.py payroll/test_phase2.py --nomigrations -q --disable-warnings --maxfail=3
docker compose -f docker-compose.dev.yml exec -T backend python manage.py check
docker compose -f docker-compose.dev.yml exec -T backend python manage.py makemigrations --check --dry-run
docker compose -f docker-compose.dev.yml ps backend notification-worker celery-beat
python -m ruff check Backend/payroll/dto.py Backend/payroll/api.py Backend/payroll/test_phase2.py
python -m ruff format --check Backend/payroll/dto.py Backend/payroll/api.py Backend/payroll/test_phase2.py
```

System check: no issues. Migration drift: no changes detected. Ruff: all checks passed, all3 files formatted. An initial format check requested formatting of the expanded privacy assertion; formatting was applied and the final check passed. The final local build refreshed all three affected services and all are healthy. Stamp: commit2e59eb49d32d, dirty=true (shared working tree).

The documentation comparison passed:16 valid JSON examples; only I gains the two requested fields; every prior example field/value and every enum value matches the pre-amendment copy. All10 stored fixtures match the contract;121 enum entries and44 validation codes remain.

## 4. Assumptions you made and open questions

No new policy choice was made. “No-op” retains the approved existing response for no effective changes (422 `field_not_editable`), rather than adding a new success status/shape. Mandatory reason and current revision are still required. For legacy records whose monthly inputs were never stored, null preserves the existing unknown-data policy and avoids an unsafe prefill.

The earlier pending CFO and provision-proration confirmations are unchanged. No additional permission/default change is included in this amendment.

## 5. Anything that the frontend agent must know

Prefill `PATCH changes.salary_components` from **I.monthly_salary_components**, never I.basic_salary/allowance scalars or I.salary_components, which remain paid/prorated lines. Use the returned run revision and a reason. `salary_adjusted` indicates an active run-local adjustment, not merely employment proration.

An unchanged prefill does not activate an adjustment. With no other effective edit it returns the existing422/no-change error; with another effective edit only that change is applied. A legacy null monthly object is not safe to prefill. The new fields are HR-only; employee payslip DTOs remain unchanged. Existing pagination, decimals, rate limits/throttles, tenant scoping and private/no-store headers remain unchanged.

## 6. Known gaps or things you could not verify

The full backend suite was not rerun for this narrow additive amendment. The preceding Phase2 run remains historical evidence:2,624 passed and5 failures outside payroll, detailed in `plans/Payroll Rebuild Phase 2 Handoff.md`; this report does not claim those failures were fixed.

The existing fresh whole-project SQLite bootstrap limitation remains unchanged; the focused SQLite run uses `--nomigrations` for project setup and independently tests the actual new payroll migration chain. The PostgreSQL-only exclusion assertion is expected to skip on SQLite. No live employee-data audit or production/frontend acceptance was performed. No other phase was started.
