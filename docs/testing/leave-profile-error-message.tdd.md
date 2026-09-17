# Leave profile error message TDD evidence

Source: user request to show the real reason when the Request Leave page cannot load an employee balance. No plan file was provided.

| Guarantee | Test | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| A signed-in employee account without a profile receives an actionable API message | `leaves.tests.test_employee_leave_balance_scope.EmployeeLeaveBalanceScopeTests.test_employee_without_profile_gets_actionable_balance_error` | API returned `Not found` | `docker compose -f docker-compose.dev.yml run --rm backend python manage.py test leaves.tests.test_employee_leave_balance_scope --keepdb` - 2 passing |
| Request Leave preserves the API message instead of showing only a generic retry prompt | `RequestLeavePage.test.tsx` | `getLeavePageLoadErrorMessage is not a function` | `npm test -- --run src/pages/employee/leave/RequestLeavePage.test.tsx --reporter=dot` - 7 passing |

`npm run type-check` completed successfully. No coverage command exists in the frontend package, so targeted regression coverage was used.
