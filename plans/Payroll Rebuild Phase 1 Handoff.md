# HANDOFF REPORT — Payroll rebuild Phase 1

> Historical Phase 1 report. Phase status and the stop instruction below describe that completed task; they do not restrict later user-authorized phases or fixes. Use the current contract and verify implementation in source.

Date: 2026-10-11 (Africa/Cairo). Contract v0.4.0. Phase 1 complete; Phase 2 not started. Local development only. No commit, push or production operation. No FrontEnd/MobileApp edit by this task; unrelated shared-checkout changes were preserved.

## 1. Work completed

Pure calculator: `Backend/payroll/calculator.py`, with Decimal-only money, independent whole-riyal HALF_UP lines, salary/employment proration, authoritative supplied work-date evidence, manual absence/paid-unpaid leave/penalty overlap, February full absence, normal monthly overtime caps and audited-override inputs, priority/whole-claim affordability, exact Article70 fine cap, pending/uncollected evidence, both provision modes, service-anniversary tiers, one GOSI bearing party, incomplete known costs and exact Fraction-based 30-slot rent reconciliation. It returns snapshots/lines/collection decisions; it performs no ORM writes, notifications or audits. The manual-total overlap and conflicting full-month-evidence cases have explicit regression tests.

Foundation schema: `Backend/payroll/models.py` extends run/item/payslip and attendance-claim fields; adds PayrollSettings, PayrollLine, PayrollAdjustment, PayrollCarryForward, PayrollCarryForwardCollection, AccommodationAssignment and PayrollRentAllocation. PayrollOwnedModel validates company/relationship consistency. History uses existing AuditLog with request/service auditing; no second audit writer. New payslip default is DRAFT; legacy nullable links remain diagnosable. Conditional period uniqueness excludes CANCELLED while still rejecting two non-cancelled runs. Source period storage is source_year/source_month; DTO source_period stays nested.

Other model edits are exactly the approved additions: `Backend/employees/models.py` deduct_gosi_from_employee and payroll_config_revision; `Backend/loans/models.py` payroll_pre_deduction_snapshot; `Backend/penalties/models.py` claimed_exact_amount. `Backend/payroll/permissions.py` adds IsPayrollManager with one allowlist, PAYROLL_MANAGER_ROLES = {SystemAdmin, HRManager, CFO}; CFO removal is a one-line change there.

Audited configuration services/strict serializers: `Backend/payroll/configuration.py`, `settings_serializers.py`. These enforce active-company access, mandatory reasons, optimistic revisions, no-op behavior, transactional audit rollback and frozen run settings with explicit audited refresh. `Backend/payroll/accommodation.py` validates inclusive no-overlap on both databases, scopes employee/rent references, serializes writes, and provides audited archive-ending support. Neither these services nor the archive helper are registered in routes or lifecycle writers yet.

Translations: `Backend/payroll/i18n.py` and `Backend/payroll/locale/{en,ar}/LC_MESSAGES/django.po` plus compiled `.mo` files; 149 bilingual keys, 121 enum entries and exactly44 validation codes. The private-output report is `Backend/payroll/management/commands/report_archived_payroll_dates.py` (with package __init__.py files). It lists missing archive/termination dates, allowed_overtime0/1 review candidates, supplied-month unmapped/partial BioTime coverage and unresolved legacy linkage; stdout is counts only.

Eight migrations, all applied locally:

1. `Backend/employees/migrations/0031_payroll_rebuild_foundation.py`.
2. `Backend/loans/migrations/0007_payroll_rebuild_foundation.py`.
3. `Backend/penalties/migrations/0007_payroll_rebuild_foundation.py`.
4. `Backend/payroll/migrations/0007_payroll_rebuild_foundation.py`.
5. `Backend/payroll/migrations/0008_backfill_legacy_payroll.py`.
6. `Backend/payroll/migrations/0009_accommodation_exclusion.py`.
7. `Backend/payroll/migrations/0010_payroll_model_validation.py`.
8. `Backend/payroll/migrations/0011_nullable_assignment_actors.py`.

Backfill preserves original monetary values/halalas and zero previous deductions, aligns status/inactivity to the parent, resolves only unambiguous company/profile/run/user matches, records unresolved/duplicate links, and audits the system migration. Legacy item-only allowance aggregates are reported because an exact component split is unavailable; no current salary guess is made. PostgreSQL exclusion/extension DDL is guarded forward and reverse; SQLite uses portable service validation. Tests exercise real PostgreSQL migration execution and real SQLite new-chain forward/backfill/reverse.

Tests added: `Backend/payroll/test_calculator.py`, `test_foundation.py`, `test_foundation_migrations.py`, `test_foundation_sqlite.py`.

## 2. Contract changes

`plans/Payroll Rebuild API Contract.md`: v0.3.0 -> v0.4.0. Header and sections1,3,9,11,12 record authorization/delivery, generated migration inventory, storage clarification, Phase 2 boundaries and the existing SQLite bootstrap limitation. `plans/API Route Status Matrix.md`: only the payroll portion updates foundation availability and handoff evidence. Sections2,4-8,10, the golden table and all16 JSON examples are byte-equivalent after newline normalization to v0.3.0.

- Public paths/methods: no additions, removals or renames in Phase 1; no URLs/viewsets edited.
- DTO fields: no change. source_period remains {year,month}; internal line/carry fields are source_year/source_month. Assignment created_by/updated_by stay nullable SET_NULL; migration0011 permits their already nullable state in model validation.
- Enums: unchanged,121 entries; validation codes unchanged, exactly44. No new error code for strict manual absence confirmation.
- Status codes: unchanged; no HTTP status behavior newly published. Internal services use contract409 stale_revision/assignment_overlap and422 domain errors; generic scope404/permission behavior uses existing helpers.
- Error shapes: unchanged. Internal PayrollDomainError.payload preserves native typed params for the Phase 2 response adapter; global core.exceptions and response envelopes were not modified. HTTP adapter/serialization verification belongs to Phase 2.
- Approved business rules: unchanged. No calculation-policy deviation introduced.

The observed fresh-SQLite bootstrap limitation is reported rather than worked around by editing older migrations. This is a verification limit, not a new payroll rule.

## 3. Commands and results

Final PostgreSQL command (isolated test database, rebuilt source):

    docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_phase1_final2_20261011 backend pytest payroll/ penalties/ loans/ -q --disable-warnings

Result: **331 passed, 0 failed, 0 skipped; 25 subtests passed; 71 warnings; 75.79 seconds**. The warnings count is the same as the pre-change required-suite baseline. Baseline before implementation:215 passed,25 subtests passed,71 warnings. Shared checkout test additions occurred during this task, so that earlier count is not the final source inventory.

Final SQLite command:

    docker compose -f docker-compose.dev.yml exec -T -e DB_ENGINE=django.db.backends.sqlite3 -e DB_NAME=:memory: backend pytest payroll/test_calculator.py payroll/test_foundation.py payroll/test_foundation_sqlite.py --nomigrations -q --disable-warnings

Result: **110 passed, 0 failed, 1 skipped; 12.63 seconds**. The single skip is test_real_postgres_exclusion_rejects_direct_overlap, which requires PostgreSQL and passes in the full PostgreSQL run. The SQLite service overlap test executes; the separate subprocess test applies/reverses the actual new migration chain against a real SQLite legacy-model-state schema. --nomigrations does not claim fresh historical SQLite bootstrap support.

Other checks:

- `python -m pytest payroll/test_calculator.py -q --disable-warnings`:78 pure calculator tests passed; final Docker suites also include all78 with the last overlap assertion.
- `docker compose -f docker-compose.dev.yml exec -T backend python manage.py check`:0 issues,0 silenced.
- `docker compose -f docker-compose.dev.yml exec -T backend python manage.py makemigrations --check --dry-run employees loans penalties payroll`:no changes detected.
- `docker compose -f docker-compose.dev.yml exec -T backend python manage.py showmigrations payroll employees loans penalties`:all eight new migrations marked applied.
- `./tools/dev-compose.ps1 up -d --build backend notification-worker celery-beat`:successful local rebuild/recreate; `./tools/dev-compose.ps1 ps backend notification-worker celery-beat`:all three healthy. Existing orphan-container warning was left alone; no volumes removed.
- `python -m ruff check` over all new payroll source/tests/management files, payroll models/permissions and all eight migration files:passed. Ruff formatting applied to this task's files.
- `git diff --check -- Backend/payroll Backend/employees/models.py Backend/loans/models.py Backend/penalties/models.py plans`:passed.
- In-memory stdlib document checker:protected sections/examples unchanged;16 JSON examples parsed,121 enum entries,44 distinct validation codes; changed numbered sections exactly1,3,9,11,12. Runtime catalog test verifies149 English/Arabic keys and44 validation codes.

Failures/diagnostics, disclosed:

- First new PostgreSQL suite:328 passed,1 failed because direct-overlap fixture omitted audit actors and hit model validation before the constraint. Fixture corrected; nullable actor validation corrected; full final331-test suite passed. Intermediate329-test run also passed before the last two absence regressions were added.
- Fresh whole-repository SQLite `python manage.py migrate --noinput --skip-checks` fails with OperationalError near DO in pre-existing PostgreSQL trigger migrations (for example employees0015). That historical portability gap remains; the new payroll migrations pass their actual SQLite forward/reverse probe.
- Initial host environment checks encountered existing debug/host safeguards and missing local PDF/cache dependencies; runtime verification moved to the bundled Docker environment. Temporary host PDF dependencies were removed and cryptography restored to its original46.0.5 after a dependency conflict was noticed. Repository requirements/security safeguards were not changed.
- Initial Ruff findings were fixed before the final clean check. No failed test remains in the final required suites. No full-backend suite was run; Phase 1's required payroll/penalties/loans suites and focused vendor checks were completed.

## 4. Assumptions and open confirmations

Pending user confirmation remains exactly as instructed: provision_proration defaults FULL_MONTH, is configurable as PRORATED_BY_DAYS, and is snapshotted; CFO remains in IsPayrollManager's one central allowlist. BASIC overtime base and calendar-month normal-overtime limit remain disclosed assumptions. No new business decision was invented. Exact Article70 comparison precedes rounding; a posted line can exceed its exact fine/cap by less than1 riyal as already approved.

## 5. Frontend information

Use contract v0.4.0's unchanged proposed DTOs/paths and44 validation codes. IDs are numeric; employee_id is display-only. Money uses decimal strings; unknown accommodation/medical stays null with cost_incomplete, while explicit none is0. Carry/source/history and provision details are HR-only. New endpoints and itemised employee JSON/PDF are not available from this Phase 1 delivery. Existing views keep their current permissions/writers until Phase 2; IsPayrollManager does not by itself change current run-route access. No frontend/mobile code was edited by this backend task.

## 6. Known gaps and unverified work

Phase 2 remains: wire the one transactional writer, source normalization/schedule/leave readers, claims/carry reservations and finalization, DRAFT cancellation/loan restoration, publish/accountless payslip generation, API endpoints/standard-error adapter, contract example/route tests, itemised JSON/PDF/export privacy and whole-run reconciliation/concurrency. The pure calculator's debt decisions and schema do not yet change live payroll collection. The archive-ending helper is not yet attached to employee lifecycle writes. Current legacy writers explicitly set their old slip status; the DRAFT model default alone does not fix that writer.

Existing source conflicts with the approved target remain explicitly deferred: `Backend/payroll/views.py` still applies the loan during draft generation and creates slips with status PAID; `Backend/payroll/services.py` and `Backend/penalties/payroll.py` still calculate/round fine caps from nullable profile.total_salary and independently update monetary totals. Phase 1 tests verify the new pure decisions and preserve legacy regression assertions; no writer was quietly changed to hide these differences. Phase 2 must replace these paths through the agreed single writer.

Unresolved legacy links and item-only component gaps need the private preflight report/HR reconciliation before the Phase 2 engine can safely process them. Authoritative unmapped/partial employee counts were not queried; the report was verified against test fixtures only. Fresh historical SQLite bootstrap remains blocked by older unguarded PostgreSQL migrations. No production data migration, live new-endpoint acceptance test, frontend build or full backend suite is claimed. Stop here after Phase 1.
