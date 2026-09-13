# Starting Work Acknowledgment Remediation - TDD Evidence

Source: user-reported production incident for an existing employee whose BioTime mapping changed.

## Guarantees

| # | Guarantee | Test | Result |
|---|---|---|---|
| 1 | A remapped BioTime code cannot make an employee with historical system attendance appear to be a new starter. | `test_existing_employee_with_remapped_biotime_code_does_not_generate_an_acknowledgment` | PASS |
| 2 | A profile without an accepted job offer cannot create a starting-work acknowledgment. | `test_employee_without_an_accepted_job_offer_does_not_generate_an_acknowledgment` | PASS |
| 3 | HR can void an erroneous pending acknowledgment, cancel its workflow, and release its attendance hold with an audit record. | `test_voiding_an_erroneous_acknowledgment_releases_the_verification_hold` | PASS |

## Evidence

- RED: `docker compose -f docker-compose.dev.yml exec -T backend pytest job_offers/tests/test_starting_work_automation.py -q` failed in both new regression cases before the guard was implemented.
- GREEN: the three targeted tests passed after the fix (`3 passed`).
- `python manage.py makemigrations --check --dry-run` reported no model changes pending.
- `python manage.py check` reported no issues.

Known scope: the new void action is exposed through the authenticated HR API. A frontend control can be added separately if HR should perform future exceptional remediations from the detail page rather than through the API.
