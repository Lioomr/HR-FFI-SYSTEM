# Frontend agent prompt: Employee cancel, Phase 1

> Task-specific prompt for the original frontend/backend coordination session. Its role assignment, surface ownership, and scope limits apply only when this prompt is explicitly adopted for a task. For later work, follow the current user request and repository guidance; verify the technical contract against current source.

Paste everything below the line into a new Opus 5.5 (medium effort) session opened in `D:\FFI HR SYSTEM\HR-FFI-SYSTEM`.

---

You are the **frontend** agent for "Employee cancel, Phase 1". A separate backend agent is implementing the API at the same time. Do not edit anything under `Backend/`.

## Read first
1. `AGENTS.md` and `.agents/rules/frontend_quality_baseline.md` (mandatory before touching `FrontEnd/`: one `<h1>`, aria-labels, 44 px targets, no extra fetching, server-side permission is the source of truth).
2. `plans/Employee Request Edit and Cancel Plan.md` (approved decisions).
3. `.agents/context/workflow_engine.md` (request/approval-trail section).
4. The `i18n-frontend` skill conventions; every new string needs EN and AR in `FrontEnd/src/i18n/translations.en.ts` and `translations.ar.ts`.

## Goal
Employees can cancel their own **pending** requests from the UI for four kinds that have no cancel today, with the loan and permission pages left as the reference pattern:

| Kind | Endpoint (backend agent is adding/changing) | Where the button goes |
|---|---|---|
| Leave | `POST /api/leaves/leave-requests/{id}/cancel/` (existing route; was always 403, now works for pending) | `pages/employee/leave/MyLeaveRequestsPage.tsx` and `EmployeeLeaveRequestDetailsPage.tsx` |
| Annual leave settlement | `POST /api/leaves/annual-leave-payments/{id}/cancel/` (new) | the employee leave-balance page settlement section (find via `pages/hr/leave/AnnualLeaveSettlementsPage*` and the employee balance page that lists the employee's settlements) |
| Asset return request | `POST /api/assets/return-requests/{id}/cancel/` (new) | `pages/employee/assets/MyAssetsPage.tsx` → Return Requests tab |
| Asset damage report | `POST /api/assets/damage-reports/{id}/cancel/` (new) | `MyAssetsPage.tsx` → Damage Reports tab |

### API contract (agreed with backend agent)
- Request: `POST`, no body (leave/settlement/asset may accept an optional `{ "comment": string }`; do not send one).
- Success: standard envelope, `data` = the updated request object with its status now `cancelled` (leave/settlement lower-case, asset enums upper-case `CANCELLED`).
- Errors: 403 not the owner / not allowed, 404 unknown, 422 not cancellable in its current status. Show the server `message` via the existing error helper; do not hard-code English.
- Visibility flag: each employee-facing item exposes `workflow.can_cancel` (leave: already in the workflow snapshot; settlement/return/damage: backend adds it, with a top-level `can_cancel: boolean` fallback where there is no `workflow` object). Render the button only when `workflow?.can_cancel ?? can_cancel` is true. Never decide from status strings alone.

## Implement
- Add typed API client functions beside the existing ones (`leaveApi.ts`, `annualLeavePaymentsApi.ts`, `assetsApi.ts`), and add `can_cancel` to the relevant TypeScript types (`types/workflow.ts` already has it).
- Reuse the loan cancel pattern in `pages/employee/loan/MyLoanRequestsPage.tsx` (confirm modal, loading state, success/error notification, list refresh) and the permission page pattern. Extract a small shared hook/component only if it removes real duplication across the four screens.
- Cancelling must refresh the list/detail so status and the approval trail (`LeaveApprovalMap`, `ApprovalTimeline`, `PendingActionBanner`) update; the recorded history will show a cancel action.
- Remove any leave UI/copy that tells employees "Contact HR to cancel" for pending requests (search translations for the contact-HR cancel message), but keep HR-only cancel UI untouched. Approved requests are NOT cancellable by the employee in this phase; do not show a button for them (the flag will be false).
- Keep accessibility baseline: button has an aria-label, 44 px target, confirm dialog is keyboard-operable.

## Tests and checks
- Add/extend Vitest tests next to the touched pages/clients (API path + method, button visibility by flag, confirm then call then refresh, error display).
- Run from `FrontEnd/`: `npm run lint`, `npm run type-check`, `npm run test -- <touched test files>`, `npm run build`. Report the results truthfully.

## Rules
- Other sessions have many uncommitted changes in this working tree (including `translations.*.ts`, `BaseLayout.tsx`, `AnnualLeaveSettlementsPage.tsx`, `LeaveInboxPage.tsx`). Edit only what you need, never revert or reformat others' changes, and re-read a file right before editing it.
- Do not commit, do not run Docker/compose, do not touch the backend. Do not add AI attribution anywhere.
- Finish with: files changed, the exact API calls you rely on, test/lint/build output, and anything the backend must still provide.
