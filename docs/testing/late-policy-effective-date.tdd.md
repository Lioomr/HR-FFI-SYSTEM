# Late-policy effective-date TDD evidence

Source: user-reported production issue; no plan file was used.

## User journey

As HR, I want late-policy actions to begin on a configured effective date so that historical attendance records remain visible without creating new warnings or deductions.

## Evidence

| Guarantee | Test | Result |
| --- | --- | --- |
| Attendance dated before `LATE_POLICY_EFFECTIVE_FROM` cannot create a late violation. | `attendance.test_policy_enforcement.AttendancePolicyEnforcementTests.test_policy_ignores_late_attendance_before_the_effective_date` | PASS |
| Attendance on the effective date still creates a late violation. | Same test | PASS |

RED was captured before the implementation with:

```text
docker compose -f docker-compose.dev.yml run --rm backend python manage.py test attendance.test_policy_enforcement.AttendancePolicyEnforcementTests.test_policy_ignores_late_attendance_before_the_effective_date --keepdb -v 1
FAIL: historical violation existed
```

GREEN was captured after the implementation with the same command:

```text
Ran 1 test in 0.562s
OK
```

Static validation passed with:

```text
.venv\\Scripts\\ruff.exe check attendance/policy.py attendance/test_policy_enforcement.py config/settings.py
All checks passed!
```

The repository has no targeted coverage command configured for this Django test. The regression test exercises the central policy reconciliation path used by both scheduled BioTime synchronization and HR recalculation.
