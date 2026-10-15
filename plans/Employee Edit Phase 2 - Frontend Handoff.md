# Employee edit, Phase 2 (leave and permission) - frontend handoff

Implemented 2026-10-13. Frontend only; no backend edits, commits or Docker commands.

## Behavior

- The Edit action appears only when `workflow?.can_edit === true`. Status strings are never used to decide editability.
- Leave: Edit icon on `MyLeaveRequestsPage` rows and an Edit button on `EmployeeLeaveRequestDetailsPage`, next to Cancel. Cancel rules are unchanged.
- Permission: Edit button beside Cancel in the sticky action bar of `PermissionRequestDetailPage` (shown when `can_edit === true`).
- Both flows reuse the existing create forms in an edit mode (no second form):
  - Leave: `RequestLeavePage` with `mode="edit"`. Prefilled from `GET /api/leaves/leave-requests/{id}/`. `delegated_to` is shown read-only (disabled input plus hint); the delegation candidate list is not fetched in edit mode. A new document is optional; the current attachment satisfies the sick-leave document rule. For annual leave the request's own reserved days are added back to `requestable_days` client-side so the form does not reject an unchanged request. The server stays the authority.
  - Permission: `PermissionRequestFormPage` with `mode="edit"`. Prefilled from `GET /api/permission-requests/{id}/`. Permission type is locked (disabled selector with hint). The evidence picker is hidden in edit mode (evidence keeps its existing add flow on the detail page). Exit keeps its original `request_date`.
- An info banner states "You can edit this request until it reaches HR." (EN/AR).
- Save: duplicate-submit protected (ref guard plus loading state), 44 px targets, success notification, then navigate back to the detail page (which loads fresh, so the trail shows the Edited row).
- Errors:
  - 422 with field errors: mapped onto form fields (leave: `start_date`/`end_date` go to the date range; permission: same helper as create).
  - 422 without field errors (not editable): server message shown (banner plus notification), the request is re-fetched, and Save stays disabled when `can_edit` is no longer true.
  - 404: localized "can no longer be edited" message.
- History: `edit` actions render as "Edited by <actor>" (EN: "Edited by {name}", AR: "عدّله {name}") in `ApprovalTimeline` and the permission history list. Unknown actions still render their raw action text. `buildStagesFromWorkflow` and `LeaveApprovalMap` ignore `edit` rows so an edit never marks a stage as handled or supplies a stage actor.

## Routes (inside the existing lazy pages; no new chunks)

| Route | Element |
|---|---|
| `/employee/leave/requests/:id/edit` | `RequestLeavePage mode="edit"` |
| `/employee/permission-requests/:id/edit` | `PermissionRequestFormPage mode="edit"` |

## API calls relied on

| Client | Call |
|---|---|
| `editLeaveRequest(id, payload)` | `PATCH /api/leaves/leave-requests/{id}/edit/` (multipart `FormData` only when `document` is a File, otherwise JSON; `null` values are sent as `""` in multipart) |
| `editPermissionRequest(id, payload)` | `PATCH /api/permission-requests/{id}/edit/` (JSON) |

Both return the standard envelope untouched. The leave edit payload is the full editable set (leave_type, start_date, end_date, reason, will_travel, will_require_visa when travelling as non-Saudi, other_leave_description, date_of_rejoin (null clears it), po_box, full_address, airplane_ticket_payer, airplane_ticket_address, delegation_note, optional document); `delegated_to` is never sent. The permission edit payload is `permission_type`, `request_date`, `reason`, plus `from_time`/`to_time` (not for late) and `exit_type` + `duration_minutes` (exit), mirroring create.

## Files changed (relative to `FrontEnd/src/`)

- `types/workflow.ts` (`can_edit`)
- `services/api/leaveApi.ts`, `services/api/permissionRequestsApi.ts` (clients, types, `can_edit`)
- `components/requests/EmployeeEditButton.tsx` (new), `components/requests/ApprovalTimeline.tsx`, `components/requests/workflowPresentation.ts`, `components/leaves/LeaveApprovalMap.tsx`
- `pages/employee/leave/RequestLeavePage.tsx`, `EmployeeLeaveRequestDetailsPage.tsx`, `MyLeaveRequestsPage.tsx` (actions column 112 to 144 px)
- `pages/shared/permission/PermissionRequestPages.tsx`
- `routes/routes.tsx`
- `i18n/translations.en.ts`, `i18n/translations.ar.ts` (13 keys each: `requests.edit.*`, `leave.edit.*`, `permissionRequests.edit.*`, `permissionRequests.history.edit`, `workflow.action.edit`, `workflow.action.editedBy`)
- New tests: `services/api/employeeEdit.test.ts`, `components/requests/EmployeeEditButton.test.tsx`, `pages/employee/leave/RequestLeavePage.edit.test.tsx`, `pages/employee/leave/EmployeeLeaveRequestEditEntry.test.tsx`, `pages/shared/permission/PermissionRequestEditForm.test.tsx`; extended `pages/shared/permission/PermissionRequestPages.test.tsx`.

Incidental: the create form's submit icon now has `aria-hidden` so the button's accessible name no longer includes the English icon label.

## Verification (run from `FrontEnd/`)

```text
npm run lint        0 errors, 23 warnings (all pre-existing hook-dependency warnings)
npm run type-check  passed
npm run build       passed (no new chunks; entry chunk unchanged in shape)
npx prettier --check <all touched files, both translation files>  passed
npx vitest run employeeEdit, employeeCancellation, components/requests, pages/shared/permission,
  pages/employee/leave, translationParity, routes
  29 files, 189 passed, 1 failed
```

The one failure, `PermissionRequestPages.test.tsx > permission request approval trail > marks the manager stage skipped when no manager is assigned`, expects a "Skipped" label. It is outside this change (the approval trail code was not touched); it coincides with another session's uncommitted `ApprovalFlowMap.tsx` change, which now excludes skipped stages from the shown trail. Not verified against a clean checkout.

No live API testing was possible; behavior is covered with mocks of the agreed contract.

## Backend must provide / confirm

- `workflow.can_edit` on leave and permission detail, and on the leave list rows (`/api/leaves/employee/leave-requests/`), true only for the owner before HR (leave: submitted / pending_delegate / pending_manager; permission: pending_manager).
- Validation failures on the edit endpoints must carry `errors: [{field, message}]`; a "not editable in this status" 422 must have no field-keyed errors (the UI uses that to tell the two cases apart) and a readable `message`.
- Multipart `date_of_rejoin=""` should clear the date (DRF DateField with `allow_null`).
- `workflow.history` rows with `action: "edit"` and a note listing changed field names.
- The edit endpoint should account for the request's own pending reservation when re-checking annual-leave balance (the client adds it back for its pre-check).
