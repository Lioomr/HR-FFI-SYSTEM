# Employee attendance self-scope - TDD evidence

Source plan: none. Derived from the employee attendance page displaying other employees' late violations and notices when the signed-in user also had the HR Manager role.

| Guarantee | Test | Result |
|---|---|---|
| An HR Manager can explicitly request only their own violations and notices. | `AttendancePolicyApiTests.test_hr_can_explicitly_request_only_their_own_violations_and_notices` | PASS |
| The employee notice component sends the self-only query. | `MyAttendanceNotices.test.tsx` | PASS |
| API query serialization remains valid and frontend types compile. | `attendanceApi.test.ts`, `npm run type-check` | PASS |

RED: `docker compose -f docker-compose.dev.yml run --rm backend python manage.py test attendance.test_policy_api.AttendancePolicyApiTests.test_hr_can_explicitly_request_only_their_own_violations_and_notices --keepdb` failed because the HR user received a coworker's violation.

GREEN: the same backend test passed after adding `mine=true` server-side scoping; frontend tests passed 21/21. Coverage was not measured because the backend container does not include the `coverage` executable.

Checkpoints: `3f085b0f` (RED), this fix commit (GREEN).
