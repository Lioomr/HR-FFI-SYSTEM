# FRONTEND DELIVERY REPORT

**TASK_ID:** BACKEND-FIXES-2026-09-02-INTEGRATION
**BRANCH:** `fix/backend-fixes-2026-09-02`
**BASE COMMIT:** `6f4e0240d3f8594ff77d102c7b9979cddbc21689`
**REPORT DATE:** 2026-09-02, Asia/Riyadh
**STATUS:** READY_FOR_MANAGER_REVIEW (see section 10 for what remains open)
**Delivery form:** Local working-tree changes. No commit, merge, deployment or integration approval was performed.

---

## 1. Summary

### What was integrated

The frontend was aligned with the corrective backend delivery `BACKEND-FIXES-2026-09-02`
across the five areas named in the task: contract decisions, salary terms, loan PDF
downloads, attendance, and the shared API/error layer.

- **Contract decisions.** The screen now handles all eight `ContractDecision.Status`
  members, lets HR act when the backend will accept a resubmission, reports the status
  the backend returned instead of assuming an approval, renders the complete workflow
  history including repeated HR and CEO attempts, and shows automatic-renewal and
  failure reasons plus per-channel notification delivery states.
- **Salary terms.** Amounts are sent as decimal strings. `total_salary` is never sent —
  the six components are, and the backend-derived total is displayed. Components the HR
  user does not touch are preserved. Client-side validation mirrors the backend's
  `Decimal(12,2)` rule, and backend 422s are rendered in full in both supported shapes.
- **Loan PDF.** An authenticated blob download was added for the loan's own employee and
  for HR/SystemAdmin, with distinct 401/403/404 handling. No URL, storage path or token
  is ever placed in a query string.
- **Attendance.** Check-in and check-out now reload using the range the page is showing.
  `LATE`, `ABSENT` and the `PENDING_*` states stay visually distinct, and the backend
  `late_minutes` / `is_late_flagged` values are displayed rather than recomputed.
- **API layer.** The existing `api` client, success/error envelope and
  `X-Active-Company-Id` behaviour were reused unchanged. A shared helper now collects
  every message from both backend validation shapes.

### What was NOT changed

- **No backend file was touched.**
- **No endpoint, field, response envelope or fallback behaviour was invented.** Every
  route used is documented in `plans/API Route Status Matrix.md`; the loan PDF path and
  its permission rule were read from `Backend/loans/views.py` and
  `Backend/loans/permissions.py` before use.
- **No route or permission guard was relaxed.** The one new UI guard (loan PDF button
  visibility) is narrower than the backend rule, never wider.
- **`MobileApp/` was not touched.**
- **The concurrent auth/login work in this tree was not modified** — see section 7.

---

## 2. Changed files

### 2a. Owned by this task

| File | Change | Reason | Backend contract affected |
|---|---|---|---|
| `FrontEnd/src/services/api/contractDecisionsApi.ts` | Typed `ContractSalaryTerms`, `ContractDecisionNotification`, `ContractNotificationDelivery`; `workflow` typed as `WorkflowSnapshot` instead of `Array<Record<string, unknown>>`; exported `CONTRACT_SALARY_COMPONENTS`. | Replace loose types with the real contract; give the page one authority for the six salary components. | NO — same routes, same payloads |
| `FrontEnd/src/pages/shared/ContractDecisionsPage.tsx` | HR action extended to `MANUAL_RESOLUTION_REQUIRED`; returned-status reporting; workflow history rendered; salary form reworked; 422/403/404/500 states; auto-renewal and failure alerts; notification delivery states; responsive columns. | The screen previously assumed every 200 meant approval, never showed history, and let HR type a `total_salary` the backend would reject. | NO |
| `FrontEnd/src/utils/formErrors.ts` | Added `collectApiErrorMessages(error): string[]`. | Render every 422 message, not just the first, from both the string-array and `{field,message}` shapes. Purely additive. | NO |
| `FrontEnd/src/services/api/loanApi.ts` | Added `downloadLoanRequestPdf(id): Promise<Blob>`. | The frontend had no caller for the loan PDF route at all. Purely additive. | NO |
| `FrontEnd/src/components/loan/LoanPdfDownloadButton.tsx` *(new)* | Authenticated blob download with 401/403/404 handling. | Single guarded surface for the PDF; keeps bytes in the blob. | NO |
| `FrontEnd/src/components/loan/LoanRequestDetailsPage.tsx` | Added optional `showPdfDownload?: boolean` (default `false`), rendered in the header. | CEO/CFO/manager reuse this component and would only ever get 403, so the button is opt-in. | NO |
| `FrontEnd/src/pages/hr/loan/LoanRequestDetailsPage.tsx` | Passes `showPdfDownload`. | `IsLoanOwnerOrHR` admits HRManager/SystemAdmin. | NO |
| `FrontEnd/src/pages/employee/loan/LoanRequestDetailsPage.tsx` | Renders the download button in the page header. | The signed-in employee owns this loan. | NO |
| `FrontEnd/src/stores/attendanceStore.ts` | `performCheckIn`/`performCheckOut` accept an optional `refreshParams`. | They reloaded with `{}`, discarding the page's date range. Optional argument, so existing callers still compile. | NO |
| `FrontEnd/src/pages/employee/AttendancePage.tsx` | Reload uses the page's own filter; `is_late_flagged` shown next to the status tag; `currentFilters` memoised and `fetchData` wrapped in `useCallback`. | Fix the stale-range reload; keep the late signal visible on the phone layout; clear a hook-dependency warning. | NO |
| `FrontEnd/src/services/api/attendanceApi.ts` | Removed the duplicate local `AttendanceRecord`; re-exports the one in `types/attendance.ts`. | The duplicate had drifted and was missing `is_late_flagged` and `late_minutes`. | NO |
| `FrontEnd/src/types/attendance.ts` | Added optional `workflow?: WorkflowSnapshot`. | Folds in the only field the removed duplicate had that this one lacked. | NO |
| `FrontEnd/src/i18n/translations.ts` | Added `contractDecisions.*`, `contractDecisions.terms.*`, `loans.pdf.*`, `common.forbidden` in **en** and **ar**; corrected `contractDecisions.renewalFailed`. | All new strings ship in both languages. `AUTO_RENEWAL_FAILED` and `MANUAL_RESOLUTION_REQUIRED` previously shared one label, hiding a status HR cannot resubmit behind the wording of one it can. | NO |

**New test files (owned by this task):**

| File | Tests |
|---|---|
| `FrontEnd/src/pages/shared/ContractDecisionsPage.test.tsx` | 21 |
| `FrontEnd/src/utils/formErrors.test.ts` | 8 |
| `FrontEnd/src/i18n/contractTranslations.test.ts` | 7 |
| `FrontEnd/src/pages/employee/AttendancePage.test.tsx` | 6 |
| `FrontEnd/src/components/loan/LoanPdfDownloadButton.test.tsx` | 5 |
| **Total** | **47** |

### 2b. Formatting-only, owned by this task

`npm run format:check` failed on 11 files at baseline, before any change of mine. Two of
those were files this task rewrites. Three more were unrelated and unowned; Prettier was
run on them so the gate can pass, with no behavioural edit:

- `FrontEnd/src/pages/public/JobOfferResponsePage.tsx`
- `FrontEnd/src/pages/public/JobOfferResponsePage.test.tsx`
- `FrontEnd/src/pages/shared/PendingInboxPage.tsx`

### 2c. NOT owned by this task — concurrent auth/login work

See section 7.

---

## 3. API integration

**Endpoints used** (all pre-existing; none added, renamed or invented):

| Method | Route | Used by |
|---|---|---|
| `GET` | `/api/employees/contract-decisions/` | list |
| `GET` | `/api/employees/contract-decisions/{id}/` | detail |
| `POST` | `/api/employees/{employee_id}/contract-decisions/` | HR submission / manual resolution |
| `POST` | `/api/employees/contract-decisions/{id}/approve/` | CEO approve |
| `POST` | `/api/employees/contract-decisions/{id}/reject/` | CEO reject |
| `GET` | `/api/loans/loan-requests/{id}/pdf/` | authenticated PDF blob |
| `GET` | `/api/attendance/me/` | employee attendance list |
| `POST` | `/api/attendance/me/check-in/`, `/check-out/` | attendance mutations |

**Payloads.** Contract submission sends only
`{decision_type, proposed_contract_date, proposed_contract_expiry, proposed_terms, hr_comment}`.
`proposed_terms` carries decimal strings for the six components and **never**
`total_salary`. A component the HR user blanks that previously had a value is sent as
explicit `null` (a deliberate clear); a component that was already empty is omitted so
the backend retains it. `TERMINATE` sends no terms. Approve/reject send `{comment}`
(optional, per `ContractDecisionCommentSerializer`).

Example actually sent by the form, given existing transportation `100.00` and
accommodation `200.00`:

```json
{"decision_type":"RENEW_WITH_CHANGES",
 "proposed_terms":{"basic_salary":"1500.00","transportation_allowance":"100.00","accommodation_allowance":"200.00"},
 "hr_comment":"Reviewed"}
```

**Response fields consumed.** `status`, `status_label`, `decision_type_label`,
`original_terms`, `proposed_terms` (including the backend-derived `total_salary`),
`hr_comment`, `ceo_comment`, `failure_reason`, `automatic_renewal`,
`automatic_renewal_reason`, `ceo_deadline`, `finalized_at`,
`final_notification_sent_at`, `final_notification_attempts`, `notification_status[]`
(with `deliveries[].channel` / `.status`), and `workflow` (`can_approve`, `can_reject`,
`history[]`). Workflow `metadata` signatures are rendered as opaque, never parsed.

**Error handling.** 401 is handled by the existing client interceptor (refresh, then
redirect). 403 renders an access-denied state on load and a "this decision moved on"
notice on an action, followed by a reload. 404 renders a not-found state. 422 renders
every message the backend sent and maps field-scoped entries onto the form. 5xx is
masked by `getHttpErrorMessage`, so no `psql`/stack detail reaches the user; a retry is
offered.

**Company-scope behaviour.** Untouched. Every call goes through the existing `api`
instance, which attaches `Authorization`, `Accept-Language` and `X-Active-Company-Id`
from `resolveAuthorizedActiveOrganizationId`, and refuses a request whose `company_id`
query parameter disagrees with the active company. No component sets that header itself.

---

## 4. User-flow verification

Verified by automated component tests against mocked API boundaries. **Not** verified in
a browser — see section 6.

| Flow | Verified behaviour |
|---|---|
| **Employee** | Attendance list keeps `LATE` / `ABSENT` / `PENDING_HR` distinct; `late_minutes` and `is_late_flagged` come from the backend; check-in and check-out reload with the page's own range; an empty response renders no invented rows (pre-hire days stay absent from the table). Loan detail offers the owner's PDF download. |
| **HR** | Sees the action on `PENDING_HR` and `MANUAL_RESOLUTION_REQUIRED` only; submission sends decimal strings, preserves untouched components and omits `total_salary`; 422s render in both shapes; invalid amounts are refused client-side before a request is made. |
| **CEO** | Approve/reject appear only when `workflow.can_approve` / `can_reject` allow it; the result message names the status the backend returned; a 403 on an action is reported as a stale decision and triggers a reload. |
| **Loan PDF** | Owner/HR download saves `loan_request_<id>.pdf`; 403, 404 and 401 each produce a distinct message and save nothing. The button is not rendered on the CEO, CFO or manager surfaces. |
| **Manual resolution** | The `MANUAL_RESOLUTION_REQUIRED` detail shows a warning with the backend `failure_reason` and a "Resolve manually" action; `AUTO_RENEWAL_FAILED` shows an error alert and **no** action, matching `submit_decision`, which refuses that status. |
| **Company switching** | Not re-verified. No change was made to the header or scope logic; the existing `apiClient` tests cover it. |

---

## 5. Tests

All commands run from `D:\HR-FFI-SYSTEM\FrontEnd`.

### Command A — full suite, BASELINE (before any change of mine)

```
npx vitest run --reporter=json --outputFile=../output/frontend-integration-2026-09-02/baseline.json
```

Result: 703 tests. **Passed: 655. Failed: 48.** Artefact:
`output/frontend-integration-2026-09-02/baseline.json`.

An earlier baseline pass at 19:07, taken before the concurrent auth edits landed on
disk, recorded **701 tests, 656 passed, 45 failed in 5 files**. The difference between
the two baselines is exactly the 3 concurrent auth failures — see section 7.

### Command B — new suites only

```
npx vitest run src/pages/shared/ContractDecisionsPage.test.tsx src/components/loan/LoanPdfDownloadButton.test.tsx src/pages/employee/AttendancePage.test.tsx src/utils/formErrors.test.ts src/i18n/contractTranslations.test.ts
```

Result: **Passed: 47. Failed: 0.**

### Command C — every suite this change could touch

Chosen by importer analysis: the 5 new suites, plus the consumers of the three shared
modules I edited (`attendanceApi`, `types/attendance`, `formErrors`, `translations`).

```
npx vitest run src/pages/shared/ContractDecisionsPage.test.tsx src/components/loan/LoanPdfDownloadButton.test.tsx src/pages/employee/AttendancePage.test.tsx src/utils/formErrors.test.ts src/i18n/contractTranslations.test.ts src/pages/shared/AttendancePreviewPage.test.tsx src/pages/shared/AttendancePreviewPage.ceo.test.tsx src/services/api/ceoSummaryApi.test.ts src/i18n/jobOfferTranslations.test.ts src/i18n/managerTranslations.test.ts src/i18n/startingWorkTranslations.test.ts src/utils/download.test.ts
```

Result: 99 tests. **Passed: 98. Failed: 1** —
`AttendancePreviewPage.ceo.test.tsx > requires a reason before rejecting`,
`Error: Test timed out in 20000ms` at 24504 ms.

### Command D — isolation re-run of that one failure

```
npx vitest run src/pages/shared/AttendancePreviewPage.ceo.test.tsx
```

Result: **Passed: 4. Failed: 0** (24.04 s of test time). The failure in Command C is a
load-induced timeout, not an assertion — classified as environment/harness in section 7.

### Command E — full suite to completion, AFTER the change

```
npx vitest run --reporter=default --reporter=json --outputFile.json=../output/frontend-integration-2026-09-02/full.json
```

Result: 750 tests across 77 files. **Passed: 704. Failed: 46.** Duration 1910.05 s
(31m50s). Exit code 1. Artefacts: `output/frontend-integration-2026-09-02/full.json`,
`full.log`.

The test count moved 703 -> 750, i.e. exactly the 47 tests added by this task, all
passing. Failure classification is in section 7c.

### Note on `npm run test`

`package.json` defines `"test": "vitest"`, which starts the **watch-mode** runner and
never exits. Every run above therefore used `npx vitest run`, which is the same runner
in single-shot mode. This is a script definition issue, not a test failure; a
`test:ci` script would make CI usage unambiguous.

---

## 6. Type and quality checks

| Check | Command | Result |
|---|---|---|
| Type-check | `npm run type-check` (`tsc --noEmit`) | **PASS** — 0 errors |
| Lint | `npm run lint` (`eslint .`) | **PASS** — 0 errors, **26** warnings (baseline: 0 errors / 27 warnings). One warning fewer because the `AttendancePage.tsx` hook dependency was fixed; see below. |
| Format | `npm run format:check` (`prettier --check .`) | **PASS at 22:10** — "All matched files use Prettier code style!" (baseline: FAIL, 11 files). **Re-run at 23:18: FAIL on 4 files, none of them this task's** — see the note below. |
| Build | `npm run build` (`tsc -b && vite build`) | **PASS** — built in 30.10 s; pre-existing chunk-size warning only (2,988 kB main bundle) |
| Browser checks | — | **NOT PERFORMED** — see below |

### Format-check re-run at 23:18 — 4 files, all owned elsewhere

After this task's formatting pass, `prettier --check .` reported
"All matched files use Prettier code style!". A re-run at 23:18 reports 4 files:

| File | Last written |
|---|---|
| `pages/hr/job-offers/JobOfferDetailPage.test.tsx` | 22:49:14 |
| `pages/employee/leave/MyLeaveBalancePage.test.tsx` | 22:54:33 |
| `pages/ceo/CEOAnnualLeaveSettlementsPage.test.tsx` | 22:57:57 |
| `pages/hr/leave/AnnualLeaveSettlementsPage.test.tsx` | 23:03:00 |

These are exactly four of the five **pre-existing failing suites**, and all four were
written between 22:49 and 23:03 — after this task's formatting pass and while the full
suite was still running. Another worker is actively repairing them (a concurrent
`vitest` run against three of these files was observed by PID at 22:51).

They were deliberately **not** formatted: running Prettier across a file someone else has
open mid-edit invites a lost update. The gate is green for every file this task owns.

One consequence worth stating: because those edits landed while the full suite was in
flight, part of that run observed their in-progress state. It did not distort the
classification — the per-file failure counts came back identical to the baseline
(26 / 7 / 6 / 5 / 1) — but a clean re-run once that worker finishes would be stronger
evidence.

### `AttendancePage.tsx` hook warning — resolved, and it was pre-existing

The manager flagged
`React Hook useEffect has a missing dependency: 'fetchData'` as new. Evidence that it
predates this task: the same file at `HEAD` was extracted and linted on its own.

```
git show HEAD:FrontEnd/src/pages/employee/AttendancePage.tsx > src/pages/employee/__BaselineAttendanceProbe.tsx
npx eslint src/pages/employee/__BaselineAttendanceProbe.tsx
```

```
__BaselineAttendanceProbe.tsx
  81:6  warning  React Hook useEffect has a missing dependency: 'fetchData'
✖ 1 problem (0 errors, 1 warning)
```

The identical warning sat at line 81 before the change and at line 87 after it; the
line number moved by 6 because a helper was added above. The probe file was deleted
after linting.

It has now been **fixed** regardless: `currentFilters` is a `useMemo`, `fetchData` a
`useCallback`, and the effect depends on `[fetchData]`.

```
npx eslint src/pages/employee/AttendancePage.tsx
→ (no output — 0 problems)
```

Repository-wide lint is unchanged at 0 errors / 27 warnings, because this file's warning
was already counted in the baseline 27 and other files still carry theirs.

### Browser verification — not performed

Two independent blockers, stated plainly rather than worked around:

1. **The running container does not contain this change.** `ffi_hr_frontend` (port 5173)
   serves an image built roughly five hours before these edits. Verifying the change
   needs a rebuild.
2. **The flows all require signing in, and I do not enter credentials.** Employee, HR and
   CEO contract flows, loan PDF access, attendance display and company switching are all
   behind authentication. Entering a password is outside what I will do, so even after a
   rebuild I could only smoke-test the unauthenticated shell.

A rebuild plus a human walkthrough, or a supplied non-production test account operated by
a person, is what would close this gap. It is recorded as an open item, not as a pass.

---

## 7. Synchronization findings

### 7a. Backend/frontend mismatches found

| Finding | Detail |
|---|---|
| `AUTO_RENEWAL_FAILED` is not resubmittable | `employees/contract_expiry.py:359` — `submit_decision` accepts only `PENDING_HR` and `MANUAL_RESOLUTION_REQUIRED`. The UI now offers the HR action for exactly those two and shows an explanatory error alert for `AUTO_RENEWAL_FAILED`. Previously both statuses shared the label "Manual resolution required", which invited HR to attempt an action the backend would reject with 422. |
| Approve can return a non-approval | `employees/views.py:1540` — a stale employee snapshot makes `approve` return **200** with `MANUAL_RESOLUTION_REQUIRED`. The old UI always announced "Contract decision approved." Now the returned `status_label` is reported, with a warning tone for that case. |
| Contract reject takes an optional comment | Unlike the **leave** reject route, which requires a non-empty `comment` (422 otherwise), `ContractDecisionViewSet.reject` uses `ContractDecisionCommentSerializer` with no such requirement. The UI does not force a comment here. Worth confirming this asymmetry is intended. |
| A drifted duplicate type | `services/api/attendanceApi.ts` carried a second `AttendanceRecord` missing `is_late_flagged` and `late_minutes`, so `AttendanceListResponse.results` was typed without the late fields the pages already read. Removed in favour of the one in `types/attendance.ts`. |

### 7b. Assumptions discovered

- **Blank vs. omitted salary component.** The backend distinguishes "omitted → retain
  current value" from "explicit null → clear and count as zero". A plain text input
  cannot express both, so the form prefills each component from `original_terms`: an
  untouched field re-sends its current value, and a field the user deliberately empties
  is sent as `null`. This produces the documented backend behaviour, but it does mean an
  untouched component is re-sent rather than omitted. Flagging it because it is a UI
  interpretation of an API distinction, not something the API dictated.
- **Loan PDF had no frontend consumer at all.** Nothing in `FrontEnd/` called
  `/api/loans/{...}/pdf/` before this task, so there was no authenticated blob download
  to "preserve" and no pre-existing IDOR exposure in the web client. The surface added
  here is new. If the manager would rather not ship a new loan-PDF surface under an
  integration task, `LoanPdfDownloadButton.tsx` plus its four call-site lines can be
  dropped without affecting anything else.

### 7c. Full-suite failure classification

Per-file comparison of `baseline.json` (before this change) against `full.json` (after):

| File | Baseline | Final | Classification |
|---|---|---|---|
| `pages/hr/job-offers/JobOfferDetailPage.test.tsx` | 26 | 26 | **Pre-existing** |
| `pages/hr/leave/AnnualLeaveSettlementsPage.test.tsx` | 7 | 7 | **Pre-existing** |
| `pages/employee/leave/MyLeaveBalancePage.test.tsx` | 6 | 6 | **Pre-existing** |
| `pages/ceo/CEOAnnualLeaveSettlementsPage.test.tsx` | 5 | 5 | **Pre-existing** |
| `components/workLocations/WorkLocationMapPicker.test.tsx` | 1 | 1 | **Pre-existing** |
| `services/api/apiClient.test.ts` | 2 | **0** | **Concurrent auth changes** - resolved |
| `auth/authStore.test.ts` | 1 | **0** | **Concurrent auth changes** - resolved |
| `pages/shared/AttendancePreviewPage.ceo.test.tsx` | 0 | 1 | **Environment / test-harness** |
| **Total** | **48** | **46** | **0 caused by this integration** |

**Pre-existing (45).** Every count is identical to the baseline. The symptoms are
unrelated to this task: `JobOfferDetailPage` fails on "Found multiple elements with the
text: Nora Khalid"; the three annual-leave suites fail on "Unable to find an element with
the text: ..." for settlement and eligibility copy; `WorkLocationMapPicker` fails because
a leaflet bounds object gained a `toBBoxString` property. All were present in an earlier
baseline taken at 19:07, before any edit of mine existed on disk.

Three of these suites - `AnnualLeaveSettlementsPage`, `CEOAnnualLeaveSettlementsPage`
and `MyLeaveBalancePage` - import `utils/formErrors`, the one shared module this task
edited. Their counts are unchanged at 7 / 5 / 6, which is the direct evidence that the
additive `collectApiErrorMessages` export changed nothing for existing consumers.

**Concurrent auth changes (3 -> 0).** `getLoginRedirectPath is not a function` and one
`authStore` assertion failed in the 19:25 baseline because those files were being written
at 19:30 and 19:35, mid-edit. Both suites pass in the final run: that worker finished.
Neither failure was ever attributable to this task.

**Environment / test-harness (1).** `AttendancePreviewPage.ceo > requires a reason before
rejecting` failed with `Error: Test timed out in 20000ms` at 25500 ms. That is a timeout,
not an assertion. Three consecutive isolated runs of unchanged code on an otherwise idle
machine produced:

| Run | Duration | Outcome |
|---|---|---|
| 1 | 24806 ms | FAIL |
| 2 | 14951 ms | PASS |
| 3 | 19061 ms | PASS |

The test straddles the 20 s per-test ceiling, so its result is decided by machine load
rather than by code. It cannot be affected by this task: the suite replaces the whole
`attendanceApi` module with `vi.mock`, so none of the edit to that file executes, and the
other touched modules are either type-only (`types/attendance.ts`, erased at compile
time) or purely additive (`formErrors.ts`, `translations.ts`).

**Root cause of the harness fragility, and why the run took 32 minutes.**
`vitest.config.ts` sets `fileParallelism: false`, so 77 antd/jsdom suites execute strictly
one file at a time under a 20 s per-test ceiling, with no headroom. Two aggravating
factors were found, one of them self-inflicted:

1. An earlier cancelled full run had left an **orphaned `vitest` process** still executing
   all 71 suites - `TaskStop` ended the wrapper shell but not the child. It was located by
   PID and terminated. Throughput went straight from ~0.7 to ~3 suites per minute.
2. A third party was concurrently running its own `vitest` against
   `AnnualLeaveSettlementsPage`, `CEOAnnualLeaveSettlementsPage` and
   `MyLeaveBalancePage` - three of the five pre-existing failing suites, so someone is
   already working on them. That run was left alone.

Recommended follow-up, outside this task: raise `testTimeout` for the attendance-preview
suites or split that file, and add a `test:ci` script.

### 7d. Concurrent auth/login work in this working tree — ownership

This branch's working tree contains an **auth/login-redirect change that is not mine**.
It appeared during this session: the branch snapshot at session start showed no modified
file under `FrontEnd/`, and these files were written to disk at 19:30 and 19:35 while my
work was already in progress.

| File | Written | Owner |
|---|---|---|
| `FrontEnd/src/routes/HomeRedirect.tsx` *(new)* | 19:25:54 | concurrent auth work |
| `FrontEnd/src/routes/homeRoute.ts` *(new)* | 19:30:02 | concurrent auth work |
| `FrontEnd/src/routes/homeRoute.test.ts` *(new)* | 19:30:02 | concurrent auth work |
| `FrontEnd/src/routes/routes.tsx` | 19:30:02 | concurrent auth work |
| `FrontEnd/src/pages/LoginPage.tsx` | 19:30:02 | concurrent auth work |
| `FrontEnd/src/pages/LoginPage.test.tsx` | 19:30:02 | concurrent auth work |
| `FrontEnd/src/pages/NotFound404Page.tsx` | 19:30:02 | concurrent auth work |
| `FrontEnd/src/auth/authStore.ts` | 19:35:31 | concurrent auth work |
| `FrontEnd/src/auth/authStore.test.ts` | 19:35:31 | concurrent auth work |
| `FrontEnd/src/services/api/apiClient.ts` | 19:35:31 | concurrent auth work |
| `FrontEnd/src/services/api/apiClient.test.ts` | 19:35:31 | concurrent auth work |

Its visible content is a `getLoginRedirectPath` export on `apiClient` plus a
`HomeRedirect` route, i.e. preserving the intended destination across an expired session.

**I did not modify, revert or stash any of it.** There is no overlap with my files.

**On separating it:** I cannot do this safely and have not attempted it. The changes are
uncommitted and belong to another worker who may still be editing them; stashing or
committing another agent's in-flight work risks destroying it. Separation needs one of:

1. the other worker commits their change on its own branch, after which this task's files
   can be committed cleanly; or
2. a manager instruction to commit this task's files by explicit path
   (`git add` limited to the section 2a and 2b list), leaving theirs untracked; or
3. this task's work being re-applied on a clean worktree.

Option 2 is available immediately and needs no coordination. The exact path list is in
section 2.

### 7e. Required backend changes

**None.** No backend defect was found during integration.

### 7f. Required manager decisions

1. **Keep or drop the new loan PDF surface** (section 7b) — it is an addition, not a
   preservation.
2. **Which separation option** in section 7d to take.
3. **Whether the contract reject/leave reject comment asymmetry** in section 7a is
   intended.
4. **Whether to authorise a frontend container rebuild plus a human browser walkthrough**
   with a non-production test account, to close section 6.
5. **Whether the 45 pre-existing test failures** (section 7c) are already tracked; they
   are outside this task's scope but they do mean the suite is not green on this branch.

---

## 8. Reliability score

| Dimension | Score | Evidence |
|---|---|---|
| **Correctness** | 4 / 5 | Every behaviour was read out of the backend source before being coded: the status set `submit_decision` accepts, the 200-with-`MANUAL_RESOLUTION_REQUIRED` path in `approve`, `IsLoanOwnerOrHR`, and the salary total policy. 47 tests assert them. Not 5/5 because none of it has been exercised against a live backend. |
| **Completeness** | 4 / 5 | All five task areas are covered and all eight statuses handled. Two gaps: browser verification (section 6), and company switching, which was not re-verified because nothing on that path changed. |
| **API compatibility** | 5 / 5 | No route, field, envelope or header behaviour was added or altered, and `git diff` touches no `Backend/` file. Payloads match the documented contract, including decimal strings and the omitted derived total. |
| **Error handling** | 5 / 5 | 401, 403, 404, 422 and 500 each have a distinct, tested path; both 422 shapes render every message; 5xx is masked so no `psql` or stack text reaches the user; a stale 403 reloads instead of stranding the view. |
| **Accessibility / usability** | 3 / 5 | Existing Ant Design patterns and responsive column rules are followed, the comment field and status filter carry `aria-label`s, and the late flag stays visible on the phone layout. But no screen-reader or keyboard pass was made and no contrast check was run. This is the weakest dimension. |
| **Test coverage** | 4 / 5 | 47 new tests spanning list, detail, submission, approval, rejection, manual resolution, repeated history, salary validation, notification states, loan PDF 401/403/404, attendance display and refresh, both 422 shapes, and English plus Arabic. Not 5/5: no test drives a real network layer, and the CEO and HR flows are covered at component level only. |
| **Production readiness** | 3 / 5 | Type-check, lint, format and build all pass, and no integration-caused test failure exists. Held down by three things outside the code: no browser verification, a working tree mixed with another worker's change, and a suite that is not green on this branch for pre-existing reasons. |

## 9. Remaining risks

1. **No browser verification.** Every flow named in the task sits behind authentication.
   The deployed container predates this change, and signing in is not something I do.
   Until a person walks these screens against a rebuilt container, the evidence stays
   component-level.
2. **Blank versus omitted salary component is a UI interpretation.** Prefilling from
   `original_terms` means an untouched component is re-sent rather than omitted. The
   result matches the backend's documented behaviour, but it is the frontend deciding
   what an empty box means. Worth a product confirmation.
3. **The loan PDF surface is new, not preserved.** Nothing in the web client called that
   route before. If a new surface should not appear under an integration task, it is
   cleanly removable: one component plus four call-site lines.
4. **The branch's test suite is not green.** 45 pre-existing failures remain across five
   suites. They are demonstrably not this task's, and someone is already working on three
   of them, but they do mean this branch cannot be judged by a green suite.
5. **The working tree mixes two changes.** Committing by explicit path is possible today,
   but until that happens the branch has no clean integration boundary.
6. **The test harness is load-sensitive.** With `fileParallelism: false` and a 20 s
   ceiling, the attendance-preview suite flips between pass and fail on machine load
   alone. CI on a shared runner will see intermittent red that is not a code defect.
7. **Bundle size.** The build emits a single 2,988 kB JS chunk. Pre-existing and not made
   worse here, but it sits on the critical path for first load.

## 10. Final recommendation

**READY_FOR_MANAGER_REVIEW.**

Chosen against the stated bar: type-check passes, the build passes, all 47 new tests
pass, and the full-suite comparison shows **zero failures caused by this integration** -
every pre-existing count is unchanged, and the single new failure is a load-dependent
timeout reproduced as flaky on unmodified code.

This is a recommendation to review, not a claim of integration readiness. Two of the
seven items required are **not** closed, and neither can be closed by writing more
frontend code:

- **Browser verification (item 7)** needs a rebuilt container plus a human with a
  non-production test account.
- **Separating the concurrent auth work (item 6)** needs either that worker to commit
  first, or an instruction to commit this task by explicit path. Stashing or committing
  another agent's in-flight, uncommitted work is not something to do unilaterally.

Integration approval and deployment should wait on those two items and on the manager
decisions listed in section 7f.
