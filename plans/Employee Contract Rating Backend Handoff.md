# Employee Contract Rating backend

Implementation follows `C:/Users/Asus/.claude/plans/new-feature-employee-soft-sparkle.md`, sections 1–29, excluding frontend work. The 18 bilingual criterion codes, labels, and order were supplied by the product owner during implementation and are defined only in `Backend/contract_ratings/criteria.py`.

## API contract

All routes require authentication and use the existing response/error envelope. Rating records are restricted to the active authorized company. List pagination uses the existing `StandardPagination` envelope (`data.items`, `page`, `page_size`, `count`, `total_pages`).

| Method | Route | Payload / behavior |
|---|---|---|
| GET | `/contract-ratings/criteria/` | Authoritative criteria with `code`, `label_en`, `label_ar`, `display_order`, and `grade_ranges`. |
| GET | `/contract-ratings/` | Role-shaped list; optional `status` filter. |
| GET | `/contract-ratings/{id}/` | Role-shaped detail. |
| POST | `/contract-ratings/{id}/manager-response/` | `criterion_ratings`, `overall_remark`, `recommendation`, `recommended_change_types`, relevant proposal fields, optional `salary_effective_date`. |
| POST | `/contract-ratings/{id}/employee-response/` | `criterion_ratings`, optional `overall_remark`. Manager-only fields are rejected. |
| POST | `/contract-ratings/{id}/hr-review/` | `action`: `approve`, `return-manager`, `return-employee`, `return-both`; `comment` required for returns. Also supports `return` with `targets: ["MANAGER", "EMPLOYEE"]`. |
| POST | `/contract-ratings/{id}/ceo-decision/` | `action`: plan's uppercase four actions; `comment`, `ceo_selected_option`, `ceo_approved_terms`, `ceo_salary_override_reason` as applicable. |
| POST | `/contract-ratings/{id}/acknowledge-termination-notice/` | Empty body; HR only; idempotent. |

Each criterion value is exactly `{grade, score, remark}`. Remark may be empty. Integer scores must match the selected grade's inclusive range. Client averages and grades are ignored. Both responses are recalculated on resubmission. HR cannot edit response fields through HR review.

Employee and manager payloads are built from a restricted allowlist: safe header, status, and the caller's response only. No other response, comparison, approval comments, salary snapshots, termination decision, notification metadata, or workflow history is serialized. Privileged users who are also a rater retain this restriction on that employee's rating. HR/CEO views include the full package and recorded workflow history. CEO visibility is pending CEO plus their own decided ratings.

## Decisions and clarification of plan ambiguities

- Individual scores keep the specified integer ranges. Fractional averages use lower-bound thresholds, avoiding gaps in the sample formula: 89.50 is VERY_GOOD, 79.50 GOOD, 69.50 ACCEPTABLE, and 59.50 POOR. The product owner should confirm this interpretation.
- Sections 17/19 and the service specification govern notice acknowledgment: HR/SystemAdmin (including valid HR delegates), despite section 22's contradictory manager-only row.
- Sections 3/6/8 govern salary proposals: the current manager or valid manager delegate may propose salary changes. Section 22's SystemAdmin-only proposal row conflicts with that workflow and is not followed.
- Existing `is_department_ceo_approver_user` and workflow authorization admit SystemAdmin as a CEO approver; preserved as explicitly requested rather than replacing the shared permission rules. Self-approval is blocked for the rated employee and the manager-response author.
- `salary_effective_date` is captured from the manager payload and defaults to day after expiry. It is descriptive metadata; salary applies immediately on CEO approval, as specified. No minimum increase is imposed; existing nonnegative money validation remains in effect. Non-salary proposals are informational only.
- `section_snapshot` uses `task_group_ref`; `EmployeeProfile` has no section field. Evaluation period uses the contract's start and expiry. These snapshots additionally detect contract-cycle changes even if the linked decision's original dates are edited.
- Termination rechecks the original cycle and archive status before deciding whether it is due. A changed expiry is flagged for manual resolution rather than terminating a renewed contract later. Missing acknowledgment never blocks execution. A late acknowledgment after this rating's completed termination remains allowed as record-keeping.
- The plan's statement that `finalize_decision` was the sole existing salary writer is not literally true: `auto_renew_decision` and profile editing already write salary data. Those independent existing paths remain unchanged. Every new rating salary write uses the extracted helper.
- Existing standalone auto-renewal and snapshot checks are preserved. An independent renewal can invalidate a scheduled rating termination; an applied rating salary change can cause an older standalone decision's salary snapshot to need manual resolution. No cross-workflow decision or original snapshot is silently rewritten.
- Notifications persist dispatch attempts and retry unsent events through the same hourly task. CEO reminders begin ten hours after HR approval. No extra termination scheduler or deadline was added.
- Notification helpers are consolidated as `notify_event`/`_dispatch` rather than separate per-event functions such as the plan's schematic `notify_termination_finalized`; the specified recipient behavior is tested for each event.
- A small `workflow.py` holds the adapter projection, in addition to the files named in the plan. A criteria endpoint is added per the product owner's clarification. Admin registrations are read-only to prevent bypassing service transitions and deleting rating history.

## Validation and environment

- Phase 1.5 full employee run: `1 failed, 374 passed, 3 warnings, 16 subtests passed in 326.58s (0:05:26)`. The single failure was reproduced against unchanged HEAD (`1 failed in 3.58s`): its archive rollback test patched `EmployeeProfile.save`, although the existing archive helper uses `QuerySet.update`. Corrected the failure injection; focused rerun: `1 passed in 2.86s`. No production archive behavior changed.
- Tests run inside an isolated `/tmp/contract-rating-review` source copy in the existing development backend container, using its configured PostgreSQL connection and `SECURE_SSL_REDIRECT=false`. Local system Python lacked Django; local venv lacked database credentials. No credentials were read or emitted.
- `contract_ratings.0001_initial` was generated and applied successfully to `test_ffi_hr_db`. The local development database migration attempt first applied existing dependency `organization.0005`, then stopped at existing `employees.0026` because `ocr_reviewed_at` already exists. No migration history was faked, and the unrelated schema mismatch was not repaired. The rating migration is not applied to that development database.
- The existing container lacks `django_redis` for non-test management commands. Migration commands used `--skip-checks`; separate system checks use the existing test cache configuration. Application settings were not weakened.

Final verification (no failing or skipped tests):

```text
pytest contract_ratings -q --tb=short
109 passed in 34.71s

pytest employees -q --tb=short
375 passed, 3 warnings, 16 subtests passed in 297.91s (0:04:57)

pytest core/test_route_contract.py -q --tb=short
2 passed in 1.03s
```

The three employee warnings are third-party deprecations (`google._upb` and `astor`). Django check: `System check identified no issues (0 silenced).` Migration consistency: `No changes detected in app 'contract_ratings'`. Ruff lint and formatting checks and `git diff --check` pass. Notifications are mocked in the rating suite. PostgreSQL transaction tests exercise simultaneous cycle creation and scheduled termination. No real notifications were sent by the rating tests.

## Complete source file inventory

| File | Change |
|---|---|
| `Backend/contract_ratings/__init__.py` | New app package. |
| `Backend/contract_ratings/apps.py` | Django app configuration. |
| `Backend/contract_ratings/models.py` | Exact rating/response model fields, relationships, enums, index and uniqueness constraint. |
| `Backend/contract_ratings/criteria.py` | Single authoritative bilingual criterion list, grade ranges, recommendation/change enums. |
| `Backend/contract_ratings/scoring.py` | Strict grade/score validation, Decimal averages and comparison builder. |
| `Backend/contract_ratings/permissions.py` | Company access and role-shaped visibility resolution. |
| `Backend/contract_ratings/services.py` | Locked transitions, audit/history, response/review/CEO services, shared-helper salary application and acknowledgment. |
| `Backend/contract_ratings/workflow.py` | Workflow status projection and recorded-history adapter support. |
| `Backend/contract_ratings/serializers.py` | Input validation and privacy-preserving read representations. |
| `Backend/contract_ratings/views.py` | Company-scoped read/actions and criteria endpoint with existing envelopes. |
| `Backend/contract_ratings/urls.py` | Single-prefix DRF router. |
| `Backend/contract_ratings/tasks.py` | Notification dispatch/retry, 90/65-day processing, CEO reminders and scheduled termination. |
| `Backend/contract_ratings/admin.py` | Read-only historical admin registrations. |
| `Backend/contract_ratings/migrations/__init__.py` | Migration package. |
| `Backend/contract_ratings/migrations/0001_initial.py` | Creates the two models and required constraints/index. |
| `Backend/contract_ratings/tests/__init__.py` | Test package. |
| `Backend/contract_ratings/tests/conftest.py` | Company/user fixtures, criterion answer builder and notification mock. |
| `Backend/contract_ratings/tests/test_ratings.py` | Main scoring, workflow, privacy, salary, termination, API and milestone regression tests. |
| `Backend/contract_ratings/tests/test_edges.py` | Delegation, role overlap, invalid changes, rollback, concurrency and per-event recipient tests. |
| `Backend/config/settings.py` | Registers the app. |
| `Backend/config/urls.py` | Mounts its router. |
| `Backend/config/celery.py` | Adds the hourly rating task. |
| `Backend/core/services/workflow_engine.py` | Registers template/adapter and approval-inbox label/link. |
| `Backend/employees/contract_expiry.py` | Extracts `apply_contract_terms` and routes existing renewal finalization through it. |
| `Backend/employees/serializers.py` | Adds optional authorized contract-rating summary. |
| `Backend/employees/test_contract_fixes.py` | Repairs the pre-existing archive rollback failure injection. |
| `plans/API Route Status Matrix.md` | Documents the new prefix and links this contract. |
| `plans/Employee Contract Rating Backend Handoff.md` | This API contract, decisions, environment/test evidence and file inventory. |

`graphify update .` refreshed ignored generated graph outputs (`graphify-out/graph.json`, `graph.html`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root`) and tool-managed cache/backups. Graphify reported pre-existing parsing issues in five MobileApp barrel files; no mobile or frontend source was edited.

All requested backend phases are implemented. Frontend Phase 4 and frontend Phase 4.5 were deliberately excluded. No commits or pushes were made. `Backend/employees/services/archiving.py` was not changed. Unrelated existing PDF artifacts and concurrent PDF work were left untouched. Applying the rating migration to the local development database remains blocked by the pre-existing employees migration mismatch described above; the migration itself was successfully executed on the test database.

### Catch-up creation follow-up

The hourly task now creates missing ratings for active, unarchived employees in active companies whose current contract expires between today and 90 days ahead, inclusive. This recovers missed creation days and contracts imported or activated within the window. Existing ratings are checked against the current contract cycle, so historical ratings do not prevent a new cycle. Expired contracts are excluded. The service rechecks eligibility after locking the decision and profile, excluding finalized, closed or mismatched decisions and profiles that became ineligible after selection. Reminder timing is unchanged.

Validation: `python -m pytest contract_ratings -q --tb=short` passed **129 tests in 43.22s**, including 20 new regression cases for catch-up boundaries, idempotency, historical cycles, closed/finalized decisions and stale candidate eligibility. Ruff lint and format checks passed. No schema migration is needed for this follow-up.

### Manager form follow-ups

The shared frontend `collectApiErrorMessages` now displays `non_field_errors` and `__all__` as form-level messages without exposing those internal keys. The configured backend exception handler already converts service-raised DRF validation errors to the standard 422 envelope; its existing normalizer intentionally retains the top-level field key. The frontend supports both that envelope and bare DRF form-error objects, while preserving genuine field labels. The backend error contract is unchanged.

`GET /contract-ratings/{id}/positions/` provides the current manager or delegate with active positions from the rating's company, returning only `{id, name}` entries inside the standard success envelope. Rating visibility and active-company scope are enforced before lookup. General HR reference CRUD permissions remain unchanged. The manager form uses a searchable name picker and sends the selected numeric ID; load failures show a retry action instead of accepting a raw ID. No migration is required.

Validation: `pytest contract_ratings core/test_responses.py -q --tb=short` passed **144 tests in 50.98s**. Focused Vitest coverage for form errors, the rating API, rating components, and employee/shared rating pages passed **33 tests across 6 files**. TypeScript project compilation, targeted ESLint, Ruff lint/format and whitespace checks passed. New regression files are `Backend/contract_ratings/tests/test_form_api.py` and `FrontEnd/src/components/ratings/RatingPositionPicker.test.tsx`; existing form-error and API tests were extended.
