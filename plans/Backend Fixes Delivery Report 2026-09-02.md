# Backend corrective delivery report

**TASK_ID:** BACKEND-FIXES-2026-09-02  
**FEATURE:** Loan PDF authorization, email HTML safety, contract correctness/history, absence eligibility and regression recovery  
**BRANCH:** `fix/backend-fixes-2026-09-02`  
**REPORT DATE:** 2026-09-02, Asia/Riyadh  
**BASE COMMIT:** `6f4e0240d3f8594ff77d102c7b9979cddbc21689`  
**STATUS:** READY_FOR_INTEGRATION  
**Delivery form:** Local working-tree changes. No commit, merge, deployment or integration approval was performed.

**Verified result:** Final PostgreSQL suite: **762 passed, 0 failed, 27 additional subtests passed**. Independent fresh-database run with normal hashing: **86 passed, 0 failed**. Five existing pypdf deprecation warnings remain. [Full test log](../output/backend-fixes-2026-09-02/full-postgres-final.log), [JUnit](../output/backend-fixes-2026-09-02/full-postgres-final.xml), [independent run](../output/backend-fixes-2026-09-02/independent-postgres.log), [runtime/source manifest](../output/backend-fixes-2026-09-02/verification-manifest.json).

## 1. Fix summary

The request was to resolve two P0 security findings and five P1 correctness findings, triage all prior regressions, and verify against PostgreSQL. Implemented changes:

| Finding | Implemented behavior | Evidence |
|---|---|---|
| P0: loan PDF IDOR | The effective `get_permissions()` now requires a loan-specific owner/HRManager/SystemAdmin object permission. Removed the incompatible leave permission, which referenced a delegation field absent from loans. Existing company filtering remains. | 28 cases cover both aliases, with/without trailing slash, owner, same-company non-owner, foreign employee, authorized HR, foreign HR, admin and anonymous access. Unauthorized requests never invoke PDF generation. |
| P0: email HTML injection | Central helpers validate HTTP(S) URLs and escape link attributes/labels. Meeting buttons, job-offer buttons, shared action links, announcement attachment links and dispatcher links use the safe boundaries. Normal template autoescaping and escaped agenda line breaks are retained. Application action paths resolve against the configured frontend. | 47 rendered-HTML/helper/dispatcher cases cover quotes, tags, mixed-case JavaScript schemes, data URLs, controls, malformed URLs, all meeting URL fields and preservation of valid links. |
| P1: BioTime termination | Contract termination and employee archive requests share the atomic mapping-retirement/archive service. Mapping removal occurs before archive guards run. Linked account deactivation/token-version increment stays in the outer decision transaction; attendance remains. Mapping IDs/codes are recorded in the contract decision audit. | Explicit/automatic termination with/without account, archive-integrity 422 rollback and late-transaction rollback tests. Original mapped-termination probe passes independently. |
| P1: invalid salaries | Submission and finalization validate finite, nonnegative `Decimal(12,2)` values. Infinity, NaN, oversized values and excess decimal places return 422. Persisted invalid JSON terms cannot bypass approval validation. | 32 API cases: eight invalid inputs, two renewal types, submission and finalization. |
| P1: inconsistent total | Recalculate total from six salary components. Null/empty components contribute zero; omitted components retain current values. A supplied non-null total must match. Validate aggregate overflow and persist the total with the components, including no-action automatic renewal. | Derived/explicit/null totals, conflicting totals, aggregate overflow and original recalculation probe. |
| P1: lost workflow history | Contract workflow signatures include the event identity and timestamp. Legacy fixed signatures are recognized by kind and timestamp without rewriting old rows. Each HR submission and CEO action survives subsequent manual-resolution resubmission. | Four scenarios cover three HR/CEO attempts each, final approve/reject, repeated sync, legacy compatibility, unchanged prior rows and retained comments. |
| P1: pre-hire absence | Shared eligibility now requires an absent hire date or hire date on/before the target date, in addition to existing company, status, account, archive, approved-leave and workday filters. | Service, scheduled yesterday run, range backfill, hire-date boundary and repeat-backfill tests. |

The original review probes are copied byte-for-byte, not rewritten to accommodate the fixes. Their SHA-256 is `B57284E1FD2355299B8B33AA1549D4D1B1F8AF5B43D7AE4580A92ECFDD8A265A`. All 11 pass in a fresh PostgreSQL run alongside the 75 permanent P0 cases. “Independent” here means unchanged prior-review assertions and a separate clean database/run, not an external human audit.

## 2. Changed files

Paths are relative to the repository. All changes below belong to this corrective delivery; the earlier `plans/Backend Delivery Review 2026-09-02.md` is retained as historical evidence.

| File | What changed and why | Frontend effect |
|---|---|---|
| `Backend/loans/permissions.py` | Added loan ownership/HR/Admin object permission without leave-only fields. | PDF access correctly rejects non-owners. |
| `Backend/loans/views.py` | Applies that permission in the effective override and PDF action declaration. | Same routes, stricter intended access. |
| `Backend/loans/test_pdf_permissions.py` | New 28-case route/identity matrix; denies before rendering and checks sensitive download headers. | Contract verification only. |
| `Backend/core/services/email_html.py` | Central URL validation, escaped buttons and safe application URL resolution. | Email links remain functional; unsafe links omitted. |
| `Backend/core/services/bird_email_service.py` | Uses safe link boundaries in meeting/shared/announcement email contexts. | No API schema change. |
| `Backend/job_offers/notifications.py` | Job-offer button labels and attributes are escaped via shared helper. | No API change. |
| `Backend/in_app_notifications/dispatcher.py` | Validates action links in generic/custom templates; removes unused import. | Valid application links become absolute email links. |
| `Backend/core/test_email_html_security.py` | New 47-case HTML and URL security suite. | Verification only. |
| `Backend/employees/services/archiving.py` | Extracted atomic mapping retirement and archive operation, with profile/mapping locks. | No route/payload change. |
| `Backend/employees/views.py` | Existing archive operation delegates to shared service. | Archive API behavior preserved. |
| `Backend/employees/contract_expiry.py` | Reuses archive service, validates terms at both boundaries, derives total, records mapping retirement, validates automatic renewal. | Salary errors now return 422; returned total is derived; mapped termination succeeds. |
| `Backend/core/services/workflow_engine.py` | Attempt-specific contract events with immutable legacy compatibility. | History includes all attempts; metadata signatures are opaque. |
| `Backend/employees/test_contract_fixes.py` | New 49-case termination, rollback, salary, total and history suite. | Verification only. |
| `Backend/attendance/absence.py` | Adds target-date hire eligibility to the shared query. | No pre-hire synthetic absence rows. |
| `Backend/attendance/test_absence_eligibility.py` | Four scenarios cover service/scheduler/backfill eligibility and idempotence. | Verification only. |
| `Backend/attendance/test_schedule_absence.py` | Removed import-group lint finding. | None. |
| `Backend/attendance/views.py` | Corrected import ordering only. | None. |
| `Backend/core/test_tenant_scope_contract.py` | Success fixture grants both companies; new test proves unauthorized company assignment remains denied. | No permission relaxation. |
| `Backend/core/tests_messaging_providers.py` | Isolates template storage in provider unit tests; uses real scoped objects for pending-approval dispatch. | No application behavior change. |
| `Backend/job_offers/tests/test_api.py` | Reuses migration-seeded FFI company instead of violating unique code. | None. |
| `Backend/job_offers/tests/test_approval_workflow.py` | Mocks the current notification function. | None. |
| `Backend/pyproject.toml` | Adds `tests_*.py` to default collection, eliminating hidden regression omissions. | None. |
| `plans/API Route Status Matrix.md` | Documents exact retained routes, authorization, 422 behavior, total policy and absence eligibility. | Integration reference. |
| `plans/Backend Fixes Delivery Report 2026-09-02.md` | This report, including evidence and limitations. | Handoff reference. |

Ignored `output/backend-fixes-2026-09-02/` contains the isolated runner, original probes, command logs, JUnit files, runtime/source manifest and regression classification. Graphify generated artifacts were refreshed. No `FrontEnd/` or `MobileApp/` code was changed.

## 3. API and database impact

No public route was added, removed or renamed. Full route details and examples are in [API Route Status Matrix](API%20Route%20Status%20Matrix.md).

- **PDF:** `GET /api/loans/loan-requests/{id}/pdf/` and `/api/loans/hr/loan-requests/{id}/pdf/`, optional trailing slash. Bearer authentication; existing company selector and owner/HR/Admin authorization. 200 binary attachment; 401 anonymous; 403 same-company non-owner; inaccessible company object 404 (unauthorized selector itself can return 403). Missing/inactive loan remains 404.
- **Submit:** `POST /api/employees/{employee_id}/contract-decisions/`, compatibility `/employees/{employee_id}/contract-decisions/`. Existing HR/Admin and active-company permissions. JSON fields remain `decision_type`, optional contract dates, `proposed_terms`, `hr_comment`. Successful 200 retains `{status:"success",data:<decision>}`. Invalid terms return 422; forbidden actions remain 403; inaccessible employee 404.
- **Approve:** `POST /api/employees/contract-decisions/{decision_id}/approve/`, compatibility `/employees/contract-decisions/{decision_id}/approve/`. Existing CEO-approver/workflow checks and company scoping. Optional JSON `comment`. 200 decision response; invalid saved salary/blocked archive 422; permission 403; missing/inaccessible decision 404. A stale employee snapshot retains the existing 200 `MANUAL_RESOLUTION_REQUIRED` behavior.
- **Reads:** Existing list/detail routes retain schema, with more complete workflow history and derived total on HR-submitted decisions. Rejection routes retain their contract.

Salary example, assuming existing transportation `100.00`, accommodation `200.00` and other allowances zero/null:

```json
{"decision_type":"RENEW_WITH_CHANGES","proposed_terms":{"basic_salary":"1500.00"},"hr_comment":"Reviewed"}
```

The successful decision includes `"proposed_terms":{"basic_salary":"1500.00","total_salary":"1800.00"}`. Final approval persists total `1800.00`.

```json
{"status":"error","message":"total_salary must equal the sum of the salary components.","errors":["total_salary must equal the sum of the salary components."]}
```

This is an example 422 response. Serializer errors can instead contain `{field,message}` entries; preserve support for both existing shapes. Full actual success/list/reject samples are in [api-samples.json](../output/backend-fixes-2026-09-02/api-samples.json).

**Schema/models:** No model field or schema changes; no new migration names. Existing `EmployeeProfile`, `ContractDecision`, `WorkflowAction`, `BioTimeEmployeeMap` and audit records use their existing schema. BioTime mapping retirement removes live routing only. Attendance is preserved. Termination follows the existing archive flags/reason and disables the linked account, rather than inventing a new lifecycle schema.

**Migration verification:** All existing migrations applied successfully to a fresh PostgreSQL database. `makemigrations --check --dry-run` found no changes. PostgreSQL archive/company guards were active during tests. No production migration or data correction was run. No new migration rollback is applicable because none was introduced.

## 4. Security review

- **Authorization/ownership/IDOR:** Loan object authorization executes after the existing scoped lookup for both aliases. Denied users cannot trigger the PDF builder. Contract role, actor, workflow and tenant checks remain in place; original unauthorized and cross-company probes pass.
- **Tenant isolation:** No application scoping function was relaxed. Corrected cross-company success tests now explicitly grant access to both tenants, and a new negative test checks that absence of this grant still denies assignment. Foreign employee and foreign HR loan PDF tests deny access.
- **Email injection:** URL validation is separate from HTML escaping. Only valid HTTP(S) links are used; controls, backslashes, unsafe schemes and malformed links are omitted. Attribute/label escaping prevents valid-but-hostile URL strings from escaping their HTML context. User text remains autoescaped; trusted markup parameters remain internal, not API HTML input fields.
- **Storage/downloads:** PDF output remains a generated authenticated binary attachment with private/no-store and nosniff headers. This delivery introduces no public file path or upload endpoint. Existing private-upload configuration and MIME/extension/size/content validation were not changed; their regression tests run in the full suite. This is not a fresh infrastructure audit of deployed file storage.
- **Audit:** Existing loan PDF export audit remains. Contract finalization audits record mapping retirement; rollback tests verify that unsuccessful finalization does not leave a successful contract audit. Workflow transition history retains each attempt without rewriting prior rows.
- **Sensitive data:** No additional salary fields or raw stored file URLs were exposed. The runner does not read application `.env`; provider HTTP is blocked, test uploads are temporary, and credentials were not added to source or reports.

## 5. Regression failure classification

All 39 failures from the previous full-suite report are classified individually in [regression-classification.json](../output/backend-fixes-2026-09-02/regression-classification.json).

| Previous failures | Classification | Resolution |
|---|---|---|
| 23 job-offer API setup failures | Test defect | `FFI` is migration-seeded; use `get_or_create` and retain all assertions. |
| 7 job-offer approval setup failures | Test defect | Mock removed `EmailService` import replaced with the actual generic notification boundary. |
| 4 messaging provider failures | Test defect | Provider unit tests isolate configured template storage; keep actual default rendering and provider payload assertions. |
| 1 pending-approval dispatch failure | Test defect | Namespace-only recipient had no persisted scoped identity/request. Use real company/profile/loan fixtures. |
| 1 cross-company manager assignment failure | Test defect | Expected success without authority over the manager's tenant. Explicitly grant both companies and add denied-access regression. |
| 3 Windows WebSocket tests | Environment/harness issue | Original network guard blocked local asyncio sockets. Runner permits loopback while retaining the external network guard. |

The eight failed original review probes represented **application defects** addressed by the P0/P1 fixes above; they are separate from the 39 existing-suite failures. The unchanged 11-probe set now passes.

Failures during this fix cycle are retained, not hidden: initial P0 fixtures omitted the admin active-company header (4 failures); new salary tests assumed a boolean `success` key instead of the actual `status` envelope (32 failures); absence fixtures first violated application/company database guards (two runs of 3 failures) and then used invalid uppercase leave values (3 failures in the first full run). These were test defects; fixtures now use valid guarded states and model enum values. No database guard was disabled and no permission was weakened to make tests pass.

## 6. Exact commands and results

Run from `D:\HR-FFI-SYSTEM` in PowerShell. The runner changes to `Backend/`, suppresses application dotenv loading, uses temporary uploads and memory cache/channels/broker, and blocks external sockets. PostgreSQL is always selected with `FFI_REVIEW_POSTGRES=1`. Fast hashing affects test processes only; the independent run uses the configured normal hashers. Outbound providers and production services are not exercised.

Database setup command:

```powershell
docker run --rm -d --name ffi-delivery-review-20260902 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=ffi_delivery_review -p 127.0.0.1:55439:5432 postgres:16-alpine
```

Result: disposable loopback-only PostgreSQL started. Passed: container/database setup. Failed: 0.

For commands A–H below, these process variables were set before invocation:

```powershell
$env:FFI_REVIEW_POSTGRES='1'
$env:FFI_REVIEW_FAST_HASHER='1'
```

**A. Initial focused P0 tests**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q loans/test_pdf_permissions.py core/test_email_html_security.py --junitxml=../output/backend-fixes-2026-09-02/p0.xml *> output/backend-fixes-2026-09-02/p0.log
```
Result: 26.02 s; admin fixture selector corrected afterward. Passed: 67. Failed: 4.

**B. P0 rerun**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q loans/test_pdf_permissions.py core/test_email_html_security.py --junitxml=../output/backend-fixes-2026-09-02/p0-rerun.xml *> output/backend-fixes-2026-09-02/p0-rerun.log
```
Result: 4.72 s. Passed: 71. Failed: 0. Four later dispatcher cases are included in the independent and final full runs.

**C. Focused contract tests**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q employees/test_contract_fixes.py employees/test_contract_expiry.py --junitxml=../output/backend-fixes-2026-09-02/contracts.xml *> output/backend-fixes-2026-09-02/contracts.log
```
Result: 12.14 s; incorrect envelope-key assertions corrected afterward. Passed: 31. Failed: 32.

**D. Fix and prior-regression rerun**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q employees/test_contract_fixes.py employees/test_contract_expiry.py attendance/test_absence_eligibility.py attendance/test_schedule_absence.py job_offers/tests/test_api.py job_offers/tests/test_approval_workflow.py core/tests_messaging_providers.py core/test_tenant_scope_contract.py --junitxml=../output/backend-fixes-2026-09-02/fixes-and-regressions.xml *> output/backend-fixes-2026-09-02/fixes-and-regressions.log
```
Result: 22.32 s; absence setup fixture rejected by existing model guard. Passed: 141. Failed: 3.

**E. Absence rerun before final fixture correction**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q attendance/test_absence_eligibility.py attendance/test_schedule_absence.py --junitxml=../output/backend-fixes-2026-09-02/absence.xml *> output/backend-fixes-2026-09-02/absence.log
```
Result: company deactivation fixture correctly rejected by PostgreSQL guard. Passed: 13. Failed: 3.

**F. First full suite**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q -o faulthandler_timeout=60 --junitxml=../output/backend-fixes-2026-09-02/full-postgres.xml *> output/backend-fixes-2026-09-02/full-postgres.log
```
Result: 171.31 s; 27 additional subtests passed, 5 pypdf deprecation warnings. Three invalid leave-status fixtures corrected afterward. Passed: 759. Failed: 3.

**G. Final absence tests (service, scheduler and backfill)**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q attendance/test_absence_eligibility.py attendance/test_schedule_absence.py --junitxml=../output/backend-fixes-2026-09-02/absence-final.xml *> output/backend-fixes-2026-09-02/absence-final.log
```
Result: 2.40 s. Passed: 16. Failed: 0.

**H. Final full backend suite, including feature/permission/tenant/regression tests**

Command:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q -o faulthandler_timeout=60 --junitxml=../output/backend-fixes-2026-09-02/full-postgres-final.xml *> output/backend-fixes-2026-09-02/full-postgres-final.log
```
Result: 191.83 s; 27 additional subtests passed, 5 existing pypdf deprecation warnings. Passed: **762**. Failed: **0**. All prior regression failures are resolved in this run. JUnit's suite total is 789 including the 27 subtests; it contains 762 individual `testcase` elements.

**I. Independent fresh PostgreSQL reproduction with normal hashing**

Command:
```powershell
docker exec ffi-delivery-review-20260902 createdb -U postgres ffi_fixes_independent
$env:FFI_REVIEW_POSTGRES='1'
$env:FFI_REVIEW_FAST_HASHER='0'
$env:FFI_REVIEW_DB='ffi_fixes_independent'
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py pytest -q ../output/backend-fixes-2026-09-02/test_delivery_review.py loans/test_pdf_permissions.py core/test_email_html_security.py --create-db --junitxml=../output/backend-fixes-2026-09-02/independent-postgres.xml *> output/backend-fixes-2026-09-02/independent-postgres.log
```
Result: 46.22 s; all 11 original probes plus 75 P0 permanent cases. Passed: 86. Failed: 0.

**J. Migrations and Django checks**

Commands, in a separate process with `FFI_REVIEW_POSTGRES=1` and default review database:
```powershell
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py manage migrate --noinput
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py manage check
.\Backend\.venv\Scripts\python.exe output/backend-fixes-2026-09-02/run_verification.py manage makemigrations --check --dry-run
```
Result: all migrations applied; no system-check issues; no model changes detected. Passed: 3 commands. Failed: 0. Outputs: `migrate.log`, `check.log`, `makemigrations.log`.

Runtime was verified as PostgreSQL 16.15, Python 3.13.3, Django 6.0.2, DRF 3.16.1, pytest 9.0.3, pytest-django 4.12.0 and psycopg2-binary 2.9.11. The source/runtime manifest records package versions, normal hashers and SHA-256 hashes for all 22 changed backend files.

**K. Ruff, formatting and diff review**

Commands:
```powershell
$reviewFiles = @(git diff --name-only --diff-filter=AM e64d280^ e64d280 -- Backend | Where-Object { $_ -like '*.py' })
$changedFiles = @(git diff --name-only -- Backend | Where-Object { $_ -like '*.py' })
$newFiles = @(git ls-files --others --exclude-standard -- Backend | Where-Object { $_ -like '*.py' })
$allFiles = @($reviewFiles + $changedFiles + $newFiles | Sort-Object -Unique)
& .\Backend\.venv\Scripts\ruff.exe check --fix @allFiles
& .\Backend\.venv\Scripts\ruff.exe format @newFiles
& .\Backend\.venv\Scripts\ruff.exe check @allFiles
git diff --check
graphify update .
```
Result: 3 auto-fixable findings corrected during development; final Ruff passes. New Python files formatted. Diff has no whitespace errors. Graph update completes with parser warnings for five existing MobileApp index files. Passed: final lint/diff/graph checks. Failed: 0. Git's LF/CRLF notices are not test failures.

## 7. New tests and coverage limits

129 permanent parameterized test cases were added: 28 loan permissions, 47 email safety, 49 contract fixes, 4 absence eligibility/backfill/scheduler, and 1 explicit denied cross-company manager assignment. Existing tests were retained and repaired without weakening application checks. Normal pytest now discovers `tests_*.py`.

The independent run validates original findings on a fresh database. The full suite uses real PostgreSQL constraints/triggers and temporary files. Provider HTTP, cache/channel/broker infrastructure and worker deployment are isolated. Coverage percentage, load/soak testing and a separate static type check were not run; no claim of those gates is made.

## 8. Remaining risks and operational requirements

- Earlier incorrect absence rows are not deleted automatically. HR must review affected dates before any audited data correction.
- Workflow events already lost before this fix cannot be recreated from overwritten model timestamps alone. This delivery preserves new attempts and existing stored history; historical recovery would need separate audit-data review.
- Pre-existing invalid pending salary payloads now fail safely with 422 and may require an explicit HR/CEO resolution. No production records were scanned or repaired.
- Historical absence backfills intentionally use current active/archive/account state plus hire date; there is insufficient lifecycle history to reconstruct past termination/reactivation eligibility. Unknown hire dates remain eligible under the documented compatibility policy.
- Five existing pypdf deprecation warnings remain in actual leave/loan PDF generation tests. They concern page ownership during content replacement and should be addressed before upgrading to the warned incompatible release.
- `backfill_absences --dry-run` still prints dates without calculating a detailed eligibility preview; this pre-existing limitation is outside the requested prevention fix.
- Actual mail delivery, Redis/Celery operation, deployed storage configuration, browser integration and production concurrency/load remain integration checks. No production-readiness claim is made from isolated tests.

## 9. Frontend integration and synchronization

Use existing Bearer authentication, JSON content type for mutations and `X-Active-Company-Id`. No new headers, upload fields or public paths are required. PDF responses are binary downloads; preserve 401/403/404 handling.

Contract clients should send decimal strings, omit the derived total where possible, and display the returned total. If sending a total, calculate it from the same six components including retained values. Display both supported 422 error-list forms. Retain existing approval loading state, reload after success, and handle `MANUAL_RESOLUTION_REQUIRED` as HR action required. CEO deadlines, automatic processing and notification timing remain unchanged; more complete workflow history may add rows, not new top-level fields.

No frontend code was edited. Frontend work can proceed against the documented contract after manager review; consumers submitting inconsistent totals or relying on non-owner PDF access will now correctly receive errors. These are intended validation/security corrections, not route removals.

Manager integration checks: confirm both PDF aliases with the real authenticated client/company header; submit and approve valid and invalid salary edits; verify every history attempt appears; terminate a mapped fixture employee and confirm preserved attendance/disabled login; verify hire-date boundary and approved leave in the scheduled environment. Review the remaining risks above before deployment planning.

## 10. Final recommendation

**Recommendation: READY_FOR_INTEGRATION.** All requested P0/P1 fixes are implemented and tested. The unchanged original probes pass independently, the complete collected PostgreSQL suite passes, and all previous regression failures have a recorded classification and passing rerun.

The next action is Delivery Manager review of this branch, evidence and frontend contract, followed by the integration checks in section 9. This recommendation does not issue integration approval or authorize production deployment.
