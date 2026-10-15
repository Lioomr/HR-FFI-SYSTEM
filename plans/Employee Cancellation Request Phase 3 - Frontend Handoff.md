# Employee Cancellation Request Phase 3 - Frontend Handoff

Approved requests can no longer be cancelled directly by the employee. The
employee asks HR to cancel; HR confirms or declines.

## Behavior

Employee (shared component `components/requests/RequestCancellationPanel.tsx`):

- "Request cancellation" button only when `workflow.can_request_cancellation === true`.
  Modal with a required reason textarea (trimmed 5..1000 chars, counter, loading,
  duplicate-submit guard, 44px targets, aria-labels).
- Pending: info alert "Cancellation requested, waiting for HR" with reason and date,
  plus "Withdraw request" (confirm dialog) only when
  `workflow.can_withdraw_cancellation_request === true`.
- Decided: confirmed (success alert) or declined (warning alert with HR note and
  decider). The employee may request again when the server sets the flag again.
- Errors: 422 with a `reason` field error shows under the textarea; any other
  422/404 shows the server message in a notification and refreshes the host data.
  Visibility is never derived from status strings.
- `compact` mode (table rows): button/tag only, no alert block.

HR page `/hr/cancellation-requests` (`pages/hr/cancellation-requests/CancellationRequestsPage.tsx`):

- Status tabs pending / confirmed / declined, kind filter, server pagination
  (page size 20), link to `detail_path`, Confirm (optional comment) and Decline
  (comment required) in a modal. Actions hidden when `can_decide === false`.
- After any action the list is reloaded (also after 404/422).

Timelines: `cancellation_requested`, `cancellation_declined`, `cancellation_withdrawn`
render "<what> by <actor>" (EN/AR) in `ApprovalTimeline` and the permission history
list, and are excluded from stage-completion logic (`isNonStageAction` in
`workflowPresentation.ts`, also used by `LeaveApprovalMap`). Unknown actions still
render raw.

## Routes and navigation

- Route `hr/cancellation-requests` in `routes/routes.tsx` (inside the
  HRManager/SystemAdmin guard), lazy page `CancellationRequestsPage` in
  `routes/lazyPages.tsx`.
- Sidebar item "Cancellation Requests" under HR "Request Queues" in
  `layouts/BaseLayout.tsx`, plus page title and open-key handling. No badge/count
  was added (no new initial fetch).

## API calls relied on

Employee (POST, body `{reason}`; withdraw has no body):

- `/api/leaves/leave-requests/{id}/request-cancellation/`
- `/api/permission-requests/{id}/request-cancellation/`
- `/api/leaves/annual-leave-payments/{id}/request-cancellation/`
- `/api/assets/return-requests/{id}/request-cancellation/`
- `/api/assets/damage-reports/{id}/request-cancellation/`
- `/api/loans/loan-requests/{id}/request-cancellation/`
- the same detail paths with `/withdraw-cancellation-request/`

HR:

- `GET /api/core/cancellation-requests/?status=&kind=&page=&page_size=` (data.items)
- `POST /api/core/cancellation-requests/{id}/confirm/` `{comment?}`
- `POST /api/core/cancellation-requests/{id}/decline/` `{comment}`

Clients: `services/api/cancellationRequestsApi.ts` (one shared helper keyed by
kind, plus the HR inbox). Types in `types/workflow.ts`
(`CancellationRequestSnapshot`, `CancellationWorkflowFlags`).

## Where the panel is placed

- Leave detail: `pages/employee/leave/EmployeeLeaveRequestDetailsPage.tsx` (refresh: `loadRequest`)
- Permission detail: `pages/shared/permission/PermissionRequestPages.tsx` (refresh: `load`)
- Settlement card: `pages/employee/leave/AnnualLeavePaymentCard.tsx` (refresh: `loadData` + `onSubmitted`)
- My Assets return/damage rows (compact): `pages/employee/assets/MyAssetsPage.tsx` (refresh: `loadRequestHistory`)
- Loan details: `pages/employee/loan/LoanRequestDetailsPage.tsx` (reload key) and
  loan list row (compact): `pages/employee/loan/MyLoanRequestsPage.tsx` (refresh: `loadData`)

Not added to the employee leave list page (only the detail page); the server
flags are present there if wanted later.

## Files changed

New: `components/requests/RequestCancellationPanel.tsx` (+ test),
`components/requests/cancellationTimeline.test.tsx`,
`services/api/cancellationRequestsApi.ts` (+ test),
`pages/hr/cancellation-requests/CancellationRequestsPage.tsx` (+ test),
`routes/cancellationRequestsRoute.test.tsx`.

Edited: `types/workflow.ts`, `services/api/permissionRequestsApi.ts` (flags on
workflow type), `components/requests/workflowPresentation.ts`,
`components/requests/ApprovalTimeline.tsx`, `components/leaves/LeaveApprovalMap.tsx`,
the five placement pages above, `routes/routes.tsx`, `routes/lazyPages.tsx`,
`layouts/BaseLayout.tsx`, `i18n/translations.en.ts`, `i18n/translations.ar.ts`.

## Verification

- `npm run type-check`: clean.
- `npm run lint`: 0 errors (24 pre-existing warnings, none in new files).
- Vitest: new tests (panel, API clients, HR page, route guard, timeline) and
  `src/i18n` parity pass. The only failure in touched areas is the known
  pre-existing `PermissionRequestPages.test.tsx > marks the manager stage skipped
  when no manager is assigned`.
- `npm run build` (`tsc -b`) currently fails only on another session's
  `src/pages/hr/payroll/run/PayrollEmployeePage.tsx` (TS2322 string | Element);
  no errors from Phase 3 files.
- `prettier --check` clean on all new files and files touched, except
  `src/pages/employee/loan/LoanRequestDetailsPage.tsx` (already unformatted at HEAD)
  and `src/routes/lazyPages.tsx` (another session's `PayrollEmployeePage` line).

## Backend notes

- Relies on `workflow.cancellation_request` being present on employee list and
  detail payloads for all six kinds, including asset return/damage records
  (the frontend reads `record.workflow`).
- Asset kinds' `detail_path` is `/hr/assets` (no id) and is linked as-is.
