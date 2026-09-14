# Invite Search and Pending History - TDD Evidence

## Source and user journeys

No plan file was supplied. The journeys were derived from the reported Invite History issue:

1. As an HR manager, I can search invitation history by an invitee's phone number, so WhatsApp invitations are discoverable.
2. As an HR manager, I can see the true count of pending invitations for the active company, regardless of pagination, search, or status filters.
3. As an HR manager, I cannot see invite records from a different company through either search results or pending totals.

## RED and GREEN evidence

| Stage | Command | Result | What it proved |
|---|---|---|---|
| RED | `docker compose exec -T backend pytest invites/tests.py::InvitePermissionTests::test_hr_manager_can_search_invites_by_phone_and_receives_company_pending_total -q` | Failed with `AssertionError: 0 != 1` | The existing API did not search `phone_number`. |
| GREEN | Same focused backend command after the implementation | `1 passed in 3.05s` | Phone search finds the company-scoped WhatsApp invite and returns the company pending total. |
| UI | `npm run test -- --run src/pages/admin/AdminInvitesPage.test.tsx -t "uses the company total"` | `1 passed, 13 skipped` | The page displays the API total rather than counting only the current page. |

## Test specification

| # | Guaranteed behavior | Test | Type | Result |
|---|---|---|---|---|
| 1 | Phone search returns the matching invite in the selected company. | `InvitePermissionTests.test_hr_manager_can_search_invites_by_phone_and_receives_company_pending_total` | Backend integration | PASS |
| 2 | Pending total includes all active-company `sent` invites, even when the response is filtered to one phone result. | Same backend test | Backend integration | PASS |
| 3 | An invite with the same phone number in an inaccessible company is excluded from results and totals. | Same backend test | Tenant-isolation integration | PASS |
| 4 | The Invite page header displays `pending_count` supplied by the API. | `AdminInvitesPage.test.tsx` pending-total test | Frontend component | PASS |

## Additional verification

- `docker compose exec -T backend pytest invites/tests.py -q` completed successfully.
- `docker compose exec -T backend python manage.py check` reported no issues.
- `Backend/.venv/Scripts/ruff.exe check Backend/invites` completed successfully.
- `npm run type-check` and `npm run build` completed successfully.

## Coverage and known gaps

Targeted backend and frontend regression coverage was run. A whole-repository coverage report was not run because the workspace contains unrelated in-progress changes; this change has no migration, new environment variable, or background task.

## Commits

- RED test checkpoint: `0a8b8a73 test: cover invite phone search and pending totals`
- GREEN implementation checkpoint: `2e0ac80b fix: correct invite search and pending history`
