# Employee cancel, Phase 1 — frontend handoff

Implemented 2026-10-13. Frontend only; no backend edits, commits, or Docker commands.

## Behavior

- Leave list and detail, the balance page's annual settlement card, and both My Assets request tabs offer cancellation only when `(workflow?.can_cancel ?? can_cancel) === true`.
- A shared `EmployeeCancelButton` provides compact cancellation icons with localized tooltips, bilingual confirmation, 44 px mobile/touch targets, loading feedback, duplicate-submit protection, success/error notifications, and refresh after success. Modal clicks do not trigger leave-row navigation. Failed cancellation keeps the dialog open.
- The server remains responsible for ownership and current-state permission. No status-derived cancellation permission or additional initial fetching was introduced.
- Leave detail renders recorded history; asset rows can expand to show workflow history/current actor when supplied. Settlement cards render workflow history/current actor when supplied. Existing frozen-document panels remain gated by final document status.
- Cancelled settlements have a translated status tag and a terminal approval-map stage, including `cancelled_at` when supplied. HR cancellation remains unchanged. Removed the obsolete HR-only leave cancellation comment and map fallback; no employee-facing contact-HR cancellation string was found.

## API calls

Every call is `POST`, without a request body; clients return the standard envelope untouched.

| Client | Endpoint |
|---|---|
| `cancelLeaveRequest` | `/api/leaves/leave-requests/{id}/cancel/` |
| `cancelAnnualLeavePaymentRequest` | `/api/leaves/annual-leave-payments/{id}/cancel/` |
| `cancelAssetReturnRequest` | `/api/assets/return-requests/{id}/cancel/` |
| `cancelAssetDamageReport` | `/api/assets/damage-reports/{id}/cancel/` |

Leave and settlement status is `cancelled`; asset status is `CANCELLED`. The control uses existing error helpers, preserving server error wording for 403/404/422 and falling back to localized HTTP messages otherwise.

Success refreshes the leave list/detail; settlements refresh their list, eligibility, and parent balance; asset cancellation refreshes both existing request-history lists. No dashboard feed or identity fetching was added.

## Files changed by this task

All paths below are relative to `FrontEnd/src/`:

- `components/requests/EmployeeCancelButton.tsx` (new)
- `components/requests/EmployeeCancelButton.test.tsx` (new)
- `components/leaves/AnnualLeavePaymentStatusTag.tsx`
- `components/leaves/AnnualLeaveSettlementApprovalMap.tsx`
- `components/leaves/LeaveApprovalMap.tsx`
- `pages/employee/leave/MyLeaveRequestsPage.tsx`
- `pages/employee/leave/MyLeaveRequestsPage.test.tsx` (new)
- `pages/employee/leave/EmployeeLeaveRequestDetailsPage.tsx`
- `pages/employee/leave/EmployeeLeaveRequestDetailsPage.test.tsx`
- `pages/employee/leave/AnnualLeavePaymentCard.tsx`
- `pages/employee/leave/MyLeaveBalancePage.test.tsx`
- `pages/employee/assets/MyAssetsPage.tsx`
- `pages/employee/assets/MyAssetsPage.integrity.test.tsx`
- `services/api/leaveApi.ts`
- `services/api/annualLeavePaymentsApi.ts`
- `services/api/assetsApi.ts`
- `services/api/employeeCancellation.test.ts` (new)
- `i18n/translations.en.ts` (eight new keys only)
- `i18n/translations.ar.ts` (matching eight keys only)

This handoff is also new. Other sessions' existing changes were preserved.

## Verification

Run from `FrontEnd/`:

```text
npm run lint
  0 errors, 23 warnings (existing hook-dependency/unused-variable warnings)
npm run type-check
  passed
npm run build
  passed; final Vite build 13.62 seconds; large-chunk advisory remains
```

```text
npm run test -- --run src/components/requests/EmployeeCancelButton.test.tsx src/services/api/employeeCancellation.test.ts src/pages/employee/leave/MyLeaveRequestsPage.test.tsx src/pages/employee/leave/EmployeeLeaveRequestDetailsPage.test.tsx src/pages/employee/leave/MyLeaveBalancePage.test.tsx src/pages/employee/assets/MyAssetsPage.integrity.test.tsx src/services/api/annualLeavePaymentsApi.test.ts src/i18n/translationParity.test.ts src/components/requests/ApprovalFlowMap.test.tsx
  9 files passed, 66 tests passed
```

After the final HTTP error handling improvement, reran `EmployeeCancelButton.test.tsx`: 12 tests passed, including 403/404/422 server messages. This replaces its previous 10-test result, for 68 passing tests across the checked files. Type check, production build, and targeted ESLint were rerun for the final control change.

Prettier check passed on all 19 touched frontend files. `git diff --check` passed on the scoped changes. Tests emit existing jsdom CSS/computed-style and Ant Design deprecation warnings. The first settlement cancellation test run failed on an ambiguous `Cancelled` text query; the assertion was corrected and its full suite passed.

Entry JS + preloaded React/router + CSS total approximately 369 KiB gzip, below the approximately 430 KB baseline. No bundling configuration, security headers, layout, or dependencies changed. Live browser/backend integration and Docker refresh were not run; Docker was explicitly prohibited by the task prompt.

## Backend handoff

At final source inspection, all four routes are present in the concurrent backend work. Leave and asset return serializers expose workflow snapshots; annual settlements and damage reports expose top-level `can_cancel` fallbacks. This frontend supports both shapes.

Annual settlement and damage report serializers still do not expose `workflow.history`. Their cancellation works with the fallback flag, and the UI refreshes status, but displaying recorded cancellation actors/history requires the backend to supply a workflow snapshot with recorded history. The UI deliberately does not invent that history from status labels.

The backend owner still needs to verify its tests/migrations and deploy the pending-only, owner/company-scoped services and actor-specific flags. No live endpoint behavior was verified by this frontend task.

## Icon adjustment

Replaced the cancellation text button with a small outlined cancel icon matching neighboring row actions; restored the leave actions column to 112 px. Existing global CSS preserves 44 px mobile/touch targets. Confirmation and permission behavior are unchanged. The 14 shared-control and leave-list tests passed; targeted ESLint, Prettier and type checking passed.
