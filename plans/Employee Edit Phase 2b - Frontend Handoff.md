# Employee edit, Phase 2b (loan and asset return) - frontend handoff

Frontend only; no backend edits, commits or Docker commands. No live API testing was possible: behavior is covered by mocks of the agreed contract.

## Behavior

- Edit appears only when `workflow?.can_edit === true` (shared `EmployeeEditButton`). Status strings are never used. Cancel and cancellation-request behavior is unchanged.
- Loan: Edit icon on `MyLoanRequestsPage` rows (actions column 110 to 144 px) and an Edit button in the `LoanRequestDetailsPage` header. Opens `RequestLoanPage mode="edit"`, prefilled from `GET /api/loans/employee/loan-requests/{id}/`. Same client-side limits as create; the server stays the authority. Save disabled while loading or when `can_edit` is not true. Success: notification then navigate to `/employee/loans/{id}` (loads fresh, shows the "Edited" row).
- Asset return: Edit icon in the Return Requests tab actions column of `MyAssetsPage` opens a modal with a prefilled textarea (required, whitespace rejected, trimmed on send), Save/Cancel 44 px buttons with aria-labels, loading plus ref guard against duplicate submit. Success refreshes both request-history lists (`loadRequestHistory`), like the Phase 1 cancel.
- `EmployeeEditButton` gained an optional `onEdit` callback (used by the modal); `to` is now optional.
- Errors: 422 with `errors: [{field, message}]` for known fields maps onto the form (loan: amount, loan_type, installment_months, reason; asset: note). 422 without field errors is "not editable": server `message` shown (banner/notification), data re-fetched, Save disabled when `can_edit` becomes false. 404 shows the localized "can no longer be edited" message (asset modal also refreshes).
- Banner: "You can edit this request until it reaches HR." (existing `requests.edit.hint`).

## Routes

| Route | Element |
|---|---|
| `/employee/loans/:id/edit` | `RequestLoanPage mode="edit"` (existing lazy page, no new chunk) |

Asset return edit has no route (modal).

## API calls relied on

| Client | Call |
|---|---|
| `editLoanRequest(id, payload)` | `PATCH /api/loans/loan-requests/{id}/edit/`, JSON body `{amount, loan_type, installment_months (null unless installment), reason}` |
| `editAssetReturnRequest(id, {note})` | `PATCH /api/assets/return-requests/{id}/edit/`, JSON `{note}` |
| prefill / refresh | `GET /api/loans/employee/loan-requests/{id}/`; asset list `GET /api/assets/my-return-requests/` |

Both return the standard envelope untouched.

## Files changed (relative to `FrontEnd/src/`)

- `services/api/loanApi.ts`, `services/api/assetsApi.ts` (clients; `LoanRequest` and `AssetReturnRequest` already expose `workflow`)
- `components/requests/EmployeeEditButton.tsx` (`onEdit`)
- `pages/employee/loan/RequestLoanPage.tsx`, `LoanRequestDetailsPage.tsx`, `MyLoanRequestsPage.tsx` (note: prettier also reflowed one pre-existing long title line in LoanRequestDetailsPage)
- `pages/employee/assets/MyAssetsPage.tsx`
- `routes/routes.tsx` (one route)
- `i18n/translations.en.ts`, `translations.ar.ts` (one new key each: `loans.edit.title`; everything else reuses `requests.edit.*`)
- New tests: `services/api/employeeEditLoanAsset.test.ts`, `pages/employee/loan/RequestLoanPage.edit.test.tsx`, `pages/employee/assets/MyAssetsPage.edit.test.tsx`

## Verification (from `FrontEnd/`)

```text
npm run lint        0 errors, 23 warnings (pre-existing hook-dependency warnings)
npm run type-check  passed
npm run build       passed
npx prettier --check <touched files>  passed
npx vitest run services/api/employeeEdit, i18n, components/requests, pages/employee/loan,
  pages/employee/assets, pages/employee/leave, routes
  37 files, 224 passed, 0 failed
```

## Backend must provide / confirm

- `workflow.can_edit` on loan and asset-return employee list and detail objects, true only for the owner while pending at the manager stage.
- Field validation errors as `errors: [{field, message}]` with field names `amount`, `loan_type`, `installment_months`, `reason` (loan) and `note` (asset); the "not editable" 422 must carry no field-keyed errors and a readable `message`.
- 404 for not found / not owner.
- `workflow.history` rows with `action: "edit"` (already rendered as "Edited by <actor>").
