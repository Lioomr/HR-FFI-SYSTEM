# Account-link candidate lookup TDD evidence

Source: user-reported slow account-link dialog and accounts disappearing from the dialog after unlinking. No plan file was supplied.

## User journeys

1. As an HR manager, I can open the employee account-link dialog and receive a small, searchable list from my selected company.
2. As an HR manager, I can unlink an account and later select that same account again in the same company.

## RED and GREEN evidence

| Guarantee | Test | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| Only active, unlinked accounts from the selected company are candidates | `admin_portal.tests.OrganizationAccessScopeTests.test_link_candidates_are_fast_company_scoped_unlinked_accounts` | `404` for `/users/link-candidates/` | `docker compose -f docker-compose.dev.yml run --rm backend python manage.py test admin_portal.tests.OrganizationAccessScopeTests --keepdb` - 9 passing |
| Unlinking retains the user's company access | `admin_portal.tests.OrganizationAccessScopeTests.test_unlink_keeps_account_available_to_its_company` | missing `UserOrganizationAccess` row | same backend command - 9 passing |
| The dialog requests a capped server-side candidate list | `ViewEmployeePage.archive.test.tsx` | the legacy page never called `listLinkCandidates` | `npm test -- --run src/pages/hr/employees/ViewEmployeePage.archive.test.tsx --reporter=dot` - 13 passing |

## Additional validation

- `npm run type-check` completed successfully.
- The frontend test emits existing jsdom/Ant Design CSS and deprecated-property warnings; none are test failures.
- Full coverage was not run because this repository does not define a coverage script. The targeted integration and component regression tests cover the changed behavior.
