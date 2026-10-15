# HANDOFF REPORT — Payroll rebuild Phase 2

Date: 2026-10-11 (Africa/Cairo). Contract v0.5.0. Phase 2 implementation delivered; the full backend suite has five failures outside payroll, listed below. This task stops after Phase 2. Local development only; no production operation, commit or push. No FrontEnd/MobileApp edits by this backend task. Other sessions' shared-checkout changes were preserved.

## 1. What was done (files changed, migrations)

`Backend/payroll/engine.py` is the single transactional payroll writer. Generation, recalculation and the compatibility penalty/attendance syncs all use the Phase 1 pure calculator. It locks the company/run and dependent records consistently, freezes configuration and evidence, writes independently rounded salary/addition/deduction/provision lines and reconciles run/item/slip totals. Total Company Cost remains Net plus known provisions. Accountless included employees receive HR-only slips. Lifecycle exclusions retain inactive item history.

Attendance normalization uses active BioTime coverage, employed dates, ABSENT records, approved paid/unpaid leave and the existing schedule/holiday helpers. Unmapped or partially covered employees get the approved warning/manual-confirmation behavior. Paid leave prevents the full-absence shortcut; penalty wage withholding is matched to dates to avoid double charges. Missing required date evidence blocks finalization rather than being guessed. Normal overtime uses the monthly hours cap; weekly rest and holiday work stay day-based. Manual overrides carry reasons and old/new/source values in immutable adjustment/audit history.

The writer reserves whole eligible claims and the existing first due full loan, preserves exact Article 70 comparisons, applies the priority order, reserves existing carry balances and creates only authorized new absence/GOSI carry at finalization. Unaffordable claims remain whole and pending; unaffordable loans remain approved. Other deductions expose manual re-entry amounts. Cancellation is DRAFT-only, requires a reason, restores the loan's recorded pre-deduction state/fields through the existing workflow service, releases claims/carry reservations, inactivates slips and audits the cancellation and restored items. Cancelled runs can be replaced without losing their history. Finalize, publish and cancel retries do not duplicate collections or notifications.

Approved manager routes, strict request validation, optimistic revisions, ownership checks, standard error envelopes and private/no-store outputs are implemented in `Backend/payroll/api.py`, `dto.py`, `urls.py`, `serializers.py` and `views.py`. Settings GET does not create a row. Settings, employee GOSI and accommodation writes use the existing audited services. Assignment overlap remains service-validated on PostgreSQL and SQLite. Employee archival ends accommodation assignments on the actual archive date with the actor recorded.

Employee JSON and the itemized PDF use an explicit salary/additions/deductions/Net whitelist; company provisions, company GOSI, cost flags and raw internal evidence are excluded. Employee PDFs use the existing localized font/shaping helpers. HR CSV/XLSX/PDF exports retain legacy overview columns and add line/provision/validation/adjustment/accommodation detail. Money is exported as exact decimal strings; raw rent reconciliation retains rational numerators/denominators and separates vacancy, residents outside payroll and rounding difference. Frozen resident/property names prevent later profile edits from changing historical rent reports. Existing notification dispatch runs after commit and remains deduplicated.

Phase 2 files added: `Backend/payroll/{engine,api,dto,exporting,test_phase2}.py`, `Backend/payroll/contract_examples.json`, `Backend/payroll/migrations/0012_payrollrunitem_is_active.py`, and this report. Phase 2 files modified: `Backend/payroll/{models,services,serializers,views,urls,accommodation,settings_serializers,test_attendance_deductions,test_foundation_migrations,test_foundation_sqlite}.py`; `Backend/penalties/{payroll,test_penalties}.py`; `Backend/loans/{services,tests}.py`; `Backend/employees/services/archiving.py`; the API contract and payroll portion of the route matrix. Phase 1 foundation files/migrations remain as listed in its handoff; unrelated dirty files are not attributed to this task.

New Phase 2 migration: **payroll.0012_payrollrunitem_is_active**, portable `PayrollRunItem.is_active = BooleanField(default=True)`. It is applied locally. No PostgreSQL-only DDL was added in Phase 2. Phase 1's conditional uniqueness, guarded exclusion and legacy backfill remain intact; forward/backfill/reverse probes include 0012.

## 2. Contract status: changed since last report (Contract changes)

Version **0.4.0 → 0.5.0**. Changed contract sections: **header; 1, 2, 3, 9, 11 and 12**. The route matrix's payroll portion now marks the approved endpoints implemented and links this report. The changes are:

- Section 2 specifies stable claim selection inside the penalties tier: existing reservations/applied claims for the same run first, then `created_at`, source kind and primary key. `Backend/payroll/engine.py`, `payroll/services.py` and `penalties/payroll.py` therefore select the same claims regardless of which compatibility sync entrypoint is called first. This affects selected `PenaltyDeduction` / `AttendancePayrollDeduction` claim amounts, statuses and reservation ownership when claims compete for the shared exact cap. Their field names and existing state enums do not change. Company-row locking is now explicitly prefixed to the dependent lock order.
- Section 3 adds internal `Backend/payroll/models.py::PayrollRunItem.is_active` and migration `0012_payrollrunitem_is_active.py`. Excluded items remain in history but leave current item lists/totals/reconciliation; cancelled runs retain their included item history and inactive cancelled slips. The internal flag is not added to public DTOs.
- Header and sections 1/9/11/12 record authorization, delivered wiring, frontend handoff and the Phase 2 stopping boundary.

**Public paths changed: none. Public DTO fields changed: none. Enum values changed: none. HTTP status codes changed: none. Error shapes changed: none.** The contract still contains exactly **44 validation codes**, **121 enum entries**, **149 bilingual translation keys** and **16 JSON examples**. All examples and the golden table are unchanged. There are no other approved business-rule changes in v0.5.0.

The previously approved Article 70 effect remains explicit: raw fine166.50 is compliant with the exact166.666… cap at gross1,000, then independently rounds to posted167. The exact and rounded amounts are audited; no rounded-cap recheck occurs. This is the already approved less-than-one-riyal rounding effect, not an additional change.

## 3. Commands run and their results (tests passed/failed with counts)

| Check | Final result |
|---|---|
| Required PostgreSQL `payroll/ penalties/ loans/` suites | **385 passed, 0 failed, 0 skipped**, 25 subtests passed, 71 warnings; 107.30s. |
| Full PostgreSQL backend | **2,624 passed, 5 failed**, 425 subtests passed, 385 warnings; 415.49s. All five failures listed in section6. |
| SQLite pure/foundation/actual-new-migration-chain/Phase2 suites | **164 passed, 1 expected PostgreSQL-only skip**, 20.90s. |
| `manage.py check` | No issues (0 silenced). |
| `makemigrations --check --dry-run` | No changes detected. |
| `showmigrations payroll` | All applied through0012. |
| Ruff lint and formatting | All checks passed; **47 Python files already formatted**. |
| Contract examples/enums | **16 JSON examples valid; all10 saved fixtures match; 121 enum entries; 44 codes**. Bilingual149-key parity is also exercised by the required suite. |
| Local Docker refresh | backend, notification-worker and celery-beat rebuilt/recreated through the approved wrapper and all **healthy**. Image stamp: commit2e59eb49d32d, dirty=true (shared working tree). |

Commands are run from the repository root unless stated otherwise. PostgreSQL test databases are dedicated local test names; no authoritative employee-data query was run.

```powershell
.\tools\dev-compose.ps1 up -d --build backend notification-worker celery-beat
docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_phase2_handoff backend pytest payroll/ penalties/ loans/ -q --disable-warnings --maxfail=6
docker compose -f docker-compose.dev.yml exec -T -e DB_NAME=ffi_payroll_phase2_final_all backend pytest -q --disable-warnings --maxfail=12
docker compose -f docker-compose.dev.yml exec -T -e DB_ENGINE=django.db.backends.sqlite3 -e DB_NAME=:memory: backend pytest payroll/test_calculator.py payroll/test_foundation.py payroll/test_foundation_sqlite.py payroll/test_phase2.py --nomigrations -q --disable-warnings --maxfail=5
docker compose -f docker-compose.dev.yml exec -T backend python manage.py check
docker compose -f docker-compose.dev.yml exec -T backend python manage.py makemigrations --check --dry-run
docker compose -f docker-compose.dev.yml exec -T backend python manage.py showmigrations payroll
python -m ruff check <touched Python files>
python -m ruff format --check <touched Python files>
```

Required-suite coverage includes the pure golden examples, foundation/migration/backfill tests, employee-payslip security tests, existing payroll/penalty/loan suites and 54 Phase 2 integration/route/security scenarios. It verifies approved DTO field shapes against contract examples, company isolation, ownership, role restrictions, private headers, actual PDF text/privacy, reconciliation, strict numeric input, stale edits, audit rollback, accountless slips, source/leave integration, whole claims/loans, exact Article 70 metadata, carry reservation/collection/release, cancellation replacement, snapshot/history behavior, both provision modes, overtime overrides, rents and after-commit notification retries.

Initial failures were not hidden: nullable joins under PostgreSQL FOR UPDATE were restricted to the owning rows; audit JSON values were frozen; Company Cost reconciliation was corrected to Net+provisions; export relation lookup and frozen employee PDF naming were corrected. Legacy tests expecting a posted0.93 deduction now assert the approved rounded1.00 while retaining exact0.93 source/claim evidence. The old claim-call-order assertion now checks deterministic selection; the bulk-fetch regression still checks one actual profile load rather than counting unrelated validation queries. The payroll migration probe now normalizes other app migrations before a backwards-only payroll plan. The initial full backend run was **2,620 passed, 6 failed**; its one payroll migration failure was fixed. The initial SQLite run stopped at **42 passed, 5 failed, 1 skipped** because reused user IDs hit cached HTTP429 throttles across scenarios. SQLite API test fixtures now clear cache between scenarios because rollback reuses user primary keys; production throttles remain enabled and unchanged, and the final SQLite run passes. A documentation-check script initially used the singular enum key and raised KeyError; correcting it to the actual `validation_codes` key produced the passing example/count check above. These are corrections to implementation/test isolation, not additional policy changes.

## 4. Assumptions you made and open questions

- `provision_proration` remains configurable and frozen per run, default **FULL_MONTH**. **PRORATED_BY_DAYS** is implemented and tested; user policy confirmation is still pending. Rent receives its own occupied-slot allocation and no second proration.
- CFO stays in `Backend/payroll/permissions.py::PAYROLL_MANAGER_ROLES`. User confirmation is pending; removal remains one constant edit. No new role or permission system was introduced.
- `allowed_overtime` is a normal-hours limit per calendar month, as approved. The importer yes/no→1/0 data risk remains in the pre-go-live audit; no automatic reinterpretation was performed.
- Date evidence uses the existing payroll timezone/schedule helpers and actual employed interval. No missing hire/archive/end date is guessed. Existing full-loan selection remains the preserved mechanism; no instalment scheduler was introduced.

## 5. Anything that the frontend agent must know

Use the exact approved root-mounted paths in sections5–7 and the updated route matrix; both slash forms resolve. HR routes require SystemAdmin, HRManager or CFO and existing company scope. Head-office aggregate reads are supported where documented; writes need the selected concrete company. Employee routes expose only the owner's active COMPLETED/PAID slips; DRAFT/cancelled/other-owner records remain invisible.

Money is a two-decimal string; do not convert raw rent ratios into employee amounts or redistribute the report's rounding difference. Unknown accommodation/medical lines are null and `cost_incomplete=true`; explicit none is0.00. Summary provision totals are known subtotals with separate unknown counts. Accountless employee slips are HR-only and are not notified.

List pagination remains `data.items`, `page`, `page_size`, `count`, `total_pages`, default25. Structured validation uses the unchanged44 codes and bilingual keys. Native revision/count parameters retain their types. Use returned revisions for writes; stale updates return409, invalid/blocked changes422, inaccessible records404 and period/assignment conflicts409 in the unchanged envelopes. Cancellation requires a reason. Completed/paid runs are immutable. A replacement period is permitted only after its DRAFT predecessor is cancelled.

Existing throttles remain: finalize **5/min**, generate-payslips **5/min**, export **10/min**; global throttles also apply. Repeated successful lifecycle actions return the documented idempotent counts/messages. Manual changes need reasons; overtime beyond the cap needs its explicit override. Settings refresh is opt-in and audited. History includes original/effective/new values, actor, timestamp and reason. New protected JSON and downloadable outputs use private/no-store.

No public path/DTO/enum/error breaking change was introduced by Phase 2. This task did not edit the frontend/mobile implementation.

## 6. Known gaps or things you could not verify

The full backend suite is **not entirely green**: **2,624 passed, 5 failed**, with425 subtests passed and385 warnings. The five failures are outside payroll and were not hidden or weakened:

| Exact failing test | Reported output / observed cause |
|---|---|
| `employees/test_contract_expiry.py::ContractExpiryWorkflowTests::test_invalid_original_duration_fails_without_changing_profile` | `django.core.exceptions.ValidationError: {'contract_expiry': ['Contract expiry must be after contract date.']}`. Fixture creation encounters the employee model's current validation before the intended workflow assertion. |
| `employees/test_single_manager.py::CrossCompanyManagerRightsTests::test_workflow_engine_routes_every_request_type_with_a_capability_to_the_cross_company_manager` (subtest `AttendanceCorrectionRequest`) | `AssertionError: None != <User: cross@one-manager.test>`. The test expects a manager route for this attendance request under the shared checkout's current routing policy. |
| `employees/tests.py::EmployeeListCacheTests::test_second_call_is_served_from_cache_without_hitting_the_db` | `AssertionError: 8 not less than 6.0`. The cache query-count threshold fails. |
| `employees/tests_signature_stale_manager.py::test_the_stale_manager_really_does_block_a_full_profile_save` | `Failed: DID NOT RAISE ValidationError`. The current profile save behavior differs from the test's expected stale-manager rejection. |
| `core/tests_pdf_forms.py::test_no_bundled_template_is_left_without_a_map_by_accident` | Unmapped bundled template: `leave_request_blank_canva_style.pdf`. |

These results are from the shared working tree, not a clean baseline comparison; this report does not claim that a baseline full run proved them pre-existing. No unrelated employee/workflow/cache/PDF-template code was changed to force them green. The initial full run had6 failures; the payroll migration isolation failure was repaired, leaving these5 in the final full run. Accordingly, the request for an entirely green full backend suite remains unmet even though the required payroll/penalties/loans suites pass.

Fresh whole-project SQLite bootstrap still fails on older unguarded PostgreSQL tenant-trigger migrations outside the new payroll chain. SQLite tests use `--nomigrations` for project setup and separately exercise the actual new chain forward/backfill/reverse and service overlap enforcement. The single PostgreSQL-specific foundation assertion is expected to skip on SQLite; PostgreSQL runs exercise it.

No live authoritative employee-data audit/count was run, so actual unmapped/partially covered employees and allowed_overtime0/1 candidates remain unverified offline. The private-output `report_archived_payroll_dates` management command is ready for pre-go-live cleanup and must be run against authorized data. Legacy unknown/ambiguous profile links remain reported rather than guessed; legacy-unknown DRAFT recalculation is blocked until resolved.

Publication was verified with the existing dispatcher mocked and after-commit callbacks exercised; no real email/WhatsApp messages were sent. Production deployment, frontend/mobile acceptance and the pending CFO/proration decisions remain outside this Phase 2 task. Phase 3 has not started.
