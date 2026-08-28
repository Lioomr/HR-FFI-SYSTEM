# Code Audit Findings — Agent Fix Plan

> Generated 2026-08-24 by code inspection (backend + frontend). Each finding is a self-contained
> work item an agent can pick up independently. Fix in priority order within each severity band.
>
> **Rules for fixing agents:**
> 1. Read the linked evidence before changing anything; re-confirm it still exists.
> 2. One finding per commit, prefix `refactor:` / `fix:` / `chore:` per AGENTS.md.
> 3. Do not change behavior beyond what the finding describes.
> 4. Run verification after each fix (listed per finding). Backend: `cd Backend && pytest`.
>    Frontend: `cd FrontEnd && npm run lint && npm run type-check && npm run test`.
> 5. After backend/frontend code changes run `graphify update .` at repo root.
> 6. If a finding turns out to be wrong or already fixed, mark it here with a note instead of forcing a change.

---

## Backend findings

### B1. [HIGH] Duplicate role-resolution function (two sources of truth)
- **Evidence:** identical `get_role()` in `Backend/accounts/permissions.py:4` and `Backend/core/permissions.py:9`.
- **Why:** `get_role` gates nearly every permission class (graph degree ~104). Divergence between copies silently splits authorization behavior per app.
- **Fix:** keep `core.permissions.get_role`; make `accounts/permissions.py` re-export it (`from core.permissions import get_role`). Delete the duplicate body. Grep all `accounts.permissions.get_role` importers to confirm they still resolve.
- **Verify:** `pytest Backend/accounts Backend/core -q`; grep shows only one definition.

### B2. [HIGH] Hardcoded department PK as CEO approver identity
- **Evidence:** `CEO_APPROVER_DEPARTMENT_ID = 1` in `Backend/core/permissions.py:6`, consumed by `core/delegation.py:20-22`, `core/services/pending_approval_email.py:74`, `loans/permissions.py:122`.
- **Why:** Departments are company-scoped seeded rows; PK=1 breaks on fresh/reseeded environments and cannot represent per-company CEO departments.
- **Fix (minimal):** replace constant lookup with a settings-driven value (`SYSTEM_SETTINGS` field or env var, e.g. `CEO_APPROVER_DEPARTMENT_CODE` resolved via Department code) with fallback to current behavior + warning log. Do not attempt full per-company modeling without a plan update; document deviation in PR if deferred.
- **Verify:** `pytest Backend/loans Backend/core -q`; manual smoke of CEO approval resolution.

### B3. [HIGH] Employee-ID generation: race + triplicated logic
- **Evidence:** `generate_employee_id` `Backend/employees/views.py:88`; `_generate_unique_employee_id` `views.py:298` (10 attempts, no prefix); `EmployeeImporter._generate_unique_employee_id` `employees/services/importer.py:122-131` (20 attempts, prefix param); call sites `views.py:300,944` (`"FFI"` vs `"EMP"` default mismatch).
- **Why:** uniqueness checked against in-memory set only → concurrent HR users can collide; three near-copies drift.
- **Fix:** extract single helper into `employees/services/employee_ids.py` (prefix param, attempts param). Keep DB unique constraint as the real guard; catch IntegrityError at create sites with one retry. Use company `employee_id_prefix` consistently.
- **Verify:** `pytest Backend/employees -q`.

### B4. [MEDIUM — FIXED 2026-08-24] Orphaned snippet file
- **Evidence:** `Backend/leaves/permissions_snippet.py` — zero importers (verified); duplicates `IsManagerOfEmployee` from `core/permissions.py`; its `has_permission` only checks auth.
- **Fix:** delete the file.
- **Verify:** full test suite; grep `permissions_snippet` returns nothing.

### B5. [MEDIUM] Script graveyard at `Backend/` root
- **Evidence:** `check_employee.py`, `check_urls.py`, `create_admin.py`, `create_test_user.py`, `create_employee_profile.py`, `list_users.py`, `run_debug_tests.py`, `seed_leaves.py`, `show_headers.py`, `test_urls.py`, `update_user_role.py`, `verify_api_contract.py`, `verify_endpoint.py`, `verify_manager_workflow.py`, `verify_payroll.py`. Hardcoded `"password123"`, `shell=True` subprocess, writes `debug_output.txt`.
- **Fix:** delete one-off verify/debug scripts that duplicate pytest coverage; move genuinely useful ones (e.g. `seed_leaves.py`, `create_admin.py`) into `management/commands/` with env-var credentials. Confirm with team lead which to keep before deleting (`run_debug_tests.py` is trivially reproducible with pytest).
- **Verify:** suite passes; `python manage.py check`.

### B6. [MEDIUM] `print()` in production code path
- **Evidence:** `Backend/announcements/utils.py:379-381` (WhatsApp send loop results to stdout).
- **Fix:** replace with `logger.info/logger.warning`; include recipient mask (reuse `mask_phone` from `core/services/messaging_providers.py`).
- **Verify:** `pytest Backend/announcements -q`.

### B7. [MEDIUM] Broad exception swallowing without logging
- **Evidence:** 100+ `except Exception:` blocks. Highest density: `leaves/views.py` (~25), `assets/views.py` (~14), `loans/views.py` (~12), `attendance/views.py` (~8). Silent swallows with no log include `leaves/serializers.py:169`.
- **Fix:** triage each block: (a) narrow to expected exception types where obvious (`InvalidOperation`, `FieldDoesNotExist`, `ObjectDoesNotExist`); (b) add `logger.warning(..., exc_info=True)` where swallowing is intentional. Do not change control flow. Start with serializers + views that decide API responses.
- **Verify:** app-level tests per touched app.

### B8. [LOW — FIXED 2026-08-24] Copy-pasted file-bytes helper
- **Evidence:** `_asset_invoice_pdf_bytes` `assets/views.py:85-101` vs `_leave_document_pdf_bytes` `leaves/views.py:331-347` (same open/read/finally/close).
- **Fix:** move shared helper to `core/files.py` (e.g. `read_field_file_bytes(field_file, suffix)`), reuse in both.
- **Verify:** PDF-related tests in assets + leaves.

### B9. [LOW] Float/Decimal mixing in leave balance math
- **Evidence:** `leaves/utils.py:675-717` float cursors/arithmetic alongside Decimal elsewhere; serializers quantize back.
- **Fix:** convert pipeline to Decimal end-to-end OR document why float is safe here; at minimum add comment marking the invariant (days ≤ 2dp). Low risk change — do carefully with existing balance tests as oracle.
- **Verify:** `pytest Backend/leaves -q` (balance tests are extensive).

### B10. [LOW] `agent_memory` app inconsistencies
- **Evidence:** `agent_memory/views.py` — bare `IsAuthenticated`, non-envelope errors (`{"error": ...}` lines 22, 26, 36, 44), raw `str(exc)` leaked to client (lines 26, 44).
- **Fix:** use `core.responses.success/error` envelope; return generic message + log detail server-side. If the app is experimental, gate behind a feature flag setting.
- **Verify:** `pytest Backend/agent_memory -q` (may be thin; add basic response-shape test).

### B11. [LOW] Substring-based Arabic translation may mangle data
- **Evidence:** `_translate_if_arabic` `core/responses.py:27-44` replaces key phrases inside arbitrary strings (including user data echoed back).
- **Fix:** restrict translation to `message`/known error strings only, not recursive over `data` payloads; or match against exact ErrorDetail messages produced by backend validation keys.
- **Verify:** i18n/error tests; bilingual smoke of a failing request.

---

### B12. [HIGH — ON HOLD: spec reconciliation required] Annual leave accrual undercounts (6 failing tests)
- **Status:** DO NOT FIX until policy owner reconciles the semantics. Decision made 2026-08-24: this is a spec question, not a code fix — the wrong choice trades 6 failing tests for different failing tests and ships incorrect payroll-adjacent math.
- **Who decides:** the author of the annual-leave-payment feature (`0019_annual_leave_payment` migration / `AnnualLeavePaymentRequest` work) — they know which suite reflects intended policy.
- **The conflict:** `leaves/utils.py:306-309` counts `(as_of - cycle_start).days // 30` bins; `leaves/tests/test_existing.py` encodes **calendar-months-started** (hire-month counts, e.g. Mar 20 → May 17 = 3 periods). Both cannot be right.
- **Decision checklist for the policy owner:**
  1. Does accrual start counting in the hire month itself (partial month = full period) or only after 30 elapsed days?
  2. Is a month "started" (calendar boundary) or "completed" (30 days served) the accrual unit?
  3. Does the cap apply per contract-year cycle at 12 × 1.75 = 21 regardless of counting method? (Both suites agree here.)
  4. Which suite is the contract: `test_existing.py` accrual tests (calendar-months) or the bin-based behavior implied by current `get_completed_annual_periods`?
- **After decision:** fix is ~3 lines in `get_completed_annual_periods` (either direction), then FULL leaves suite rerun on a DB-capable machine — shared balance math feeds many passing expectations.

### B13. [HIGH — FIXED 2026-08-24] Delegation creation rejected by DB trigger
- **Root cause (confirmed = suspect (a)):** `DelegationRuleSerializer.validate()` overrode the model's `capabilities` default with `[]` on create; the `ffi_validate_cross_company_delegation` trigger correctly rejects empty arrays. Model default (`default_delegation_capabilities`, `core/models.py:175`) was fine all along.
- **Resolution (by debugger session):** `Backend/core/serializers.py:117` — validate() now falls back to `default_delegation_capabilities()` on create. Also `Backend/leaves/tests/test_manager_workflow.py`: added missing `EmployeeProfile` for `hr_user` in `ManagerWorkflowTests.setUp` (matches fixture pattern for all other users).
- **Regression evidence:** full leaves/assets/core suite — 167 passed, 8 failed; the 8 failures are exactly the parked B12 accrual cluster (untouched). `test_manager_can_create_own_delegation_rule` and `test_delegated_hr_can_approve_leave_request` both pass.
- **Original diagnosis (for the record):** flagged by senior-debugger live-stack verification (same-company manager→delegate grants: 422 via API, raw IntegrityError via ORM). Static analysis ranked 3 trigger reject branches; suspect (a) — capabilities emptied by the serializer — proved correct.

---

## Frontend findings

### F1. [MEDIUM] Systemic weak typing (`any`) in pages/stores/API layer
- **Evidence:** 100+ occurrences: `catch (err: any)` across `pages/**` (AdminUsersListPage ×5, AdminWhatsAppIntegrationPage ×5, HRAssetsPage ×8 …), `(data as any).results` casts in `services/api/managerApi.ts` (×9+), `values: any` form handlers.
- **Why:** defeats type-check safety exactly at error-handling and API boundaries where regressions hide.
- **Fix:** introduce `UnknownApiError`/narrowed types: use existing `isApiError`/`httpErrors.ts` helpers for catches; define discriminated union for list envelopes and a single normalizer (extend `utils/dataUtils.normalizeListData`) used by managerApi instead of per-endpoint guessing.
- **Verify:** `npm run type-check`, `npm run lint`, `npm run test`.

### F2. [MEDIUM] Response-shape guessing (4 shapes per endpoint)
- **Evidence:** `managerApi.ts:163-176, 188-204, 217-229` accept `{status,data:{items}}`, `{results}`, bare array, `{status,data:{results}}` interchangeably.
- **Why:** symptom of backend envelope drift; hides contract violations; every new endpoint re-implements guessing.
- **Fix:** pair with backend to confirm actual shape per endpoint (check `plans/API Route Status Matrix.md`), then reduce each function to one canonical parse through the shared normalizer (F1). Log-and-fail loudly on unexpected shape in dev.
- **Verify:** manager inbox/team/attendance page tests.

### F3. [MEDIUM] Mixed URL prefixes in frontend API layer (root cause: backend dual routes)
- **Evidence (frontend):** unprefixed paths in `employeesApi.ts` (`/employees`, `/employees/export`, …), `invitesApi.ts` (`/invites/…`), `payrollApi.ts` (`/payroll-runs…`), `managerApi.ts:190` (`/employees/manager/team`) vs `/api/...` everywhere else (leaveApi, attendanceApi, assetsApi…).
- **Evidence (backend root cause):** `config/urls.py` double-registers whole trees: `employees.urls` at both line 34 (`""`) and 48 (`api/`), `audit.urls` lines 32-33, `payroll.urls` line 38 plus manual export routes 36-37.
- **Why:** violates AGENTS.md route policy; doubles route surface; Nginx/proxy allow-listing becomes error-prone.
- **Fix (staged):**
  1. Frontend first: normalize all service calls to `/api/...` (safe today because both routes exist).
  2. Backend later (separate PR, needs proxy/env review): drop unprefixed legacy includes, keep compatibility redirects if any external consumer exists; update `plans/API Route Status Matrix.md`.
- **Verify:** frontend e2e-ish flows via `npm run test`; backend suite; grep confirms single style.

### F4. [LOW] Parallel workflow-stage builders mid-migration
- **Evidence:** `components/leaves/LeaveApprovalMap.tsx:41`, `components/assets/AssetReturnApprovalMap.tsx:14`, `components/loans/LoanApprovalMap.tsx:16,132` (legacy `buildStages` + new `buildStagesFromWorkflow` from `components/requests/workflowPresentation.ts` as fallback).
- **Fix:** once backend `workflow` payload confirmed present on all detail responses, delete legacy branches and unify stage building in `workflowPresentation.ts`.
- **Verify:** leave/loan/asset detail page tests.

### F5. [LOW] `translations.ts` monolith (319 KB)
- **Evidence:** `FrontEnd/src/i18n/translations.ts`; sibling tooling `find_missing.cjs/js` scripts to detect missing keys.
- **Fix (optional/structural):** split per-domain namespaces merged at index; keep flat key contract to avoid touching consumers. Only worth doing if merge conflicts are observed — otherwise defer.

### F6. [LOW — FIXED 2026-08-24] Scattered localStorage magic strings
- **Evidence:** `"ffi_app_language"` hardcoded in `services/api/apiClient.ts:78` duplicating `i18n/i18nStore.ts:4` STORAGE_KEY; `'ffi_sidebar_collapsed'` inline in `layouts/BaseLayout.tsx:398,959`.
- **Fix:** export keys from a single `storageKeys.ts`; import everywhere.
- **Verify:** type-check; language toggle + sidebar collapse smoke.

### F7. [LOW — FIXED 2026-08-24] Repeated download+revoke cleanup blocks
- **Resolution:** canonical `utils/download.ts` created (`downloadBlob`/`openBlob`/`openOrDownloadBlob`, 5s delayed revoke); `services/api/downloads.ts` kept as a re-export shim (`triggerBlobDownload` name preserved — it is module-mocked in `EmployeesListPage.archive.test.tsx`). 16 inline sites converted (leave details ×4, CEO inbox, announcements ×2, doc archive, payslips ×2, import ×3, plus the shim). Behavior note: the 7 pre-existing `triggerBlobDownload` consumers and 5 inline sites moved from immediate-revoke to delayed-revoke (safer on Safari).
- **Evidence:** same blob-download pattern ~10×: `EmployeeLeaveRequestDetailsPage.tsx:113,139`, `LeaveRequestDetailsPage.tsx:133,153`, `ManagerLeaveRequestDetailsPage.tsx:173,193`, `AnnouncementWidget.tsx:90`, `AnnouncementsPage.tsx:124`, `MyLeaveRequestsPage.tsx:96`, `CEOLeaveInboxPage.tsx:147`, `EmployeeDocumentArchive.tsx:540`.
- **Fix:** shared `downloadBlob(blob, filename)` util (revoke included) in `utils/`.
- **Verify:** download buttons on listed pages still work (manual or component tests).

### F8. [INFO] console.error as de-facto logger
- **Evidence:** 21 uses across pages/components (mostly legit error reporting).
- **Fix (optional):** introduce thin `logger` wrapper now so future remote logging has one seam. Not urgent.

---

## Cross-cutting context for fixing agents
- Multi-company scoping is sacred: never weaken `filter_queryset_by_company_scope` usage while refactoring (see `.agents/context/multi_company.md`).
- Workflow engine is projection-style: domain status transitions then `sync_workflow()` (see updated `.agents/context/workflow_engine.md`).
- Route renames require compatibility routes + `plans/API Route Status Matrix.md` updates (AGENTS.md policy).

---

## Contract findings (frontend ↔ backend) — verified via Django URL resolver

> Method: extracted all ~208 unique frontend request paths from `FrontEnd/src/services/api/*.ts`,
> dumped all 596 backend url patterns via `django.urls.get_resolver`, cross-matched, then confirmed
> each mismatch with `django.urls.resolve()`. These are hard evidence, not style opinions.

### C1. [CRITICAL — FIXED 2026-08-24] CEO asset approval endpoints 404 (6 endpoints)
- **Resolution:** FE paths corrected to `/api/ceo/assets/...` in `assetsApi.ts` (6 strings). Regression guard added: `Backend/core/test_frontend_contract.py` (SimpleTestCase, resolves real URLConf — no DB needed). Verified: pytest 3/3, vitest CEO suites 14/14, eslint clean, tsc clean.
- **Evidence:** Django `resolve('/api/assets/ceo/assets/damage-reports/')` → **Resolver404**. Backend routes live at `/api/ceo/assets/...` (`CEOAssetDamageReportViewSet` / `CEOAssetReturnRequestViewSet`).
- **Broken calls:** `assetsApi.ts:300,308,316,324,332,340` — `/api/assets/ceo/assets/{damage-reports,return-requests}/...`
- **Impact:** `CEOAssetDamageReportsPage.tsx`, `CEOAssetReturnRequestsPage.tsx`, and CEO dashboard probes (`ceoSummaryApi.ts:79-80`) cannot load or act on requests. Unit tests pass only because they mock the API module.
- **Fix direction:** change FE paths to `/api/ceo/assets/...` (matches sibling convention: `/api/ceo/attendance/`, `/api/loans/ceo/loan-requests`). Backend route is tested and consistent; do NOT add compat route on BE.
- **Verify:** `resolve()` check in Django shell; add an integration test hitting real URLConf; manual CEO approval smoke.

### C2. [HIGH — FIXED 2026-08-24] Employee-import result & error-file endpoints 404 (2 endpoints)
- **Resolution:** `history/` segment added in `employeesApi.ts` (`getImportStatus`, `downloadImportErrors`). Covered by the same `test_frontend_contract.py` guard. Note: import pages have no component tests — consider adding coverage (see testing strategy).
- **Evidence:** `resolve('/imports/employees/5/')` → **Resolver404**; actual routes are `/imports/employees/history/{pk}` and `/imports/employees/history/{pk}/errors-file`.
- **Broken calls:** `employeesApi.ts:310` (`getImportStatus`) and `employeesApi.ts:349` (`downloadImportErrors`) omit the `history/` segment.
- **Impact:** `ImportResultPage.tsx:32,46` and `ImportHistoryPage.tsx:61` — import result polling and error-report download fail for HR users.
- **Fix direction:** add `history/` segment in FE (or have BE register alias — prefer FE change; BE route is canonical and tested).
- **Verify:** resolve check; run import flow manually.

### C3. [MEDIUM] Frontend response-shape "guessing" defends against shapes that never occur
- **Evidence:** `managerApi.ts` accepts 4 envelope variants per endpoint, but `ManagerAttendanceViewSet.list` (Backend/attendance/views.py:936-948) always returns the standard `{status:"success", data:{count,results,summary}}` paginated envelope.
- **Why:** dead defensive branches hide future contract regressions instead of failing loudly; every new endpoint copies the guessing pattern.
- **Fix:** collapse to single canonical parse via shared normalizer (pairs with F1/F2); log-and-throw on unexpected shape in dev builds.

### C4. [LOW] Frontend calls Django-admin-mounted endpoint
- **Evidence:** `adminApi.ts:5` → `GET /admin/summary/` resolves to a custom view registered inside `admin/` urls (`config/urls.py`). Works, but routes business traffic through the admin namespace (session/admin security assumptions may differ from DRF APIs).
- **Fix:** relocate view under `/api/...` with DRF auth, keep admin path as alias if needed.

### C5. [DOC GAP] API Route Status Matrix silent on affected routes
- **Evidence:** no entries matching `ceo/assets` or `imports/employees` in `plans/API Route Status Matrix.md`.
- **Fix:** after fixing C1/C2, add both route families to the matrix per AGENTS.md documentation policy.

## Suggested execution order
0. Contract bugs first (user-facing breakage): C1, C2 — small diffs, immediate impact
1. Quick wins, zero behavior risk: B4, B8, F6, F7
2. High-value low-risk: B1, B6, F3 step 1 (frontend-only normalization)
3. Needs care/tests: B3, B7, F1+F2, C3
4. Needs product/plan decision first: B2, B5, F3 step 2 (backend route removal), F4, F5, B11, C4
