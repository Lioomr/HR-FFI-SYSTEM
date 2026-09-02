# Attendance Late and Absence Workflow - Production Audit

**Audit date:** 2026-09-02  
**Scope:** late-arrival classification, automatic absence detection, BioTime reconciliation, approval APIs, scheduler/deployment evidence, and frontend handoff.  
**Assessment type:** engineering production-readiness review; not a legal or compliance certification.

## Executive result

**Updated production audit: 82/100 - launchable with caveats; the four High backend blockers are remediated, but staging and integration gates remain open.**

The local Docker deployment is healthy and the focused backend suites pass. The feature is not a schema-only change: the scheduler creates attendance records and the approval endpoints mutate workflow state. The four original High findings were fixed and retested; confidence remains below a strong production score because staging delivery, true concurrent-request testing, and end-to-end reconciliation/UI checks are still pending.

## Original blockers - resolved

### 1. Absence detection can mark non-active workers absent - High

`_active_employee_profiles()` filters out archived profiles and inactive companies, but does not filter `employment_status=ACTIVE` or `user__is_active=True`. Suspended, terminated-but-not-archived, or disabled-user profiles can therefore receive automatic `ABSENT` records.

**Evidence:** [Backend/attendance/absence.py](../Backend/attendance/absence.py), lines 26-32.  
**Resolution:** eligibility now requires active employment status and either no linked user or an active linked user. A regression test covers exclusion of non-active employees.

### 2. Scheduler order contradicts the reconciliation contract - High

The Celery comment says absence detection runs after both BioTime syncs, but the default schedule is 05:30 while the morning BioTime sync is scheduled for 09:00. This creates a period where yesterday's late or overnight punch can be represented as `ABSENT` before synchronization. BioTime may later correct the row, but downstream reports, approvals, notifications, or exports can observe the false interim state.

**Evidence:** [Backend/config/celery.py](../Backend/config/celery.py), lines 35-62.  
**Resolution:** the default schedule is now 10:00, after the 09:00 morning sync; environment overrides remain operationally configurable. Beat output was verified as `0 10 * * *`.

### 3. Manager and CEO decisions are vulnerable to concurrent requests - High

Manager and CEO `approve`/`reject` actions read the current status, then save without an atomic transaction or row lock. Two requests can both pass the `PENDING_*` check, overwrite each other's decision metadata, create duplicate workflow/audit effects, and send conflicting notifications.

**Evidence:** [Backend/attendance/views.py](../Backend/attendance/views.py), manager actions at lines 976-1060 and CEO actions at lines 1132-1203.  
**Resolution:** all four actions now lock and re-fetch the row with `select_for_update(of=("self",))` inside `transaction.atomic()`, re-check status, and notify after the transition. The `of` clause avoids the PostgreSQL nullable-join lock error.

### 4. System-created absence records do not explicitly initialize workflow or audit state - High if attendance history is auditable

The absence path uses `bulk_create()` to insert `ABSENT` records, but does not call the normal `sync_workflow()` or `audit()` integration used by API-created and approved records. If workflow projections or audit history are required for every attendance decision, automatic absences currently have an incomplete trail.

**Evidence:** [Backend/attendance/absence.py](../Backend/attendance/absence.py), lines 68-95, compared with the workflow/audit calls in [Backend/attendance/views.py](../Backend/attendance/views.py).  
**Resolution:** system absences are explicitly terminal, non-approver records. Each run writes a summary `AuditLog`, and rows identify themselves as `SYSTEM` with explanatory notes. A regression test covers the summary audit entry.

## High-value fixes

- Replace the per-employee approved-leave query with a date-scoped query or precomputed set. The current loop is an N+1 query pattern and will become expensive for a large workforce.
- Make the `created` metric accurate when `bulk_create(ignore_conflicts=True)` loses a race; currently it reports the number prepared, not necessarily the number inserted.
- Add task overlap protection and retry/alert behavior for `mark_daily_absentees`. The database uniqueness constraint prevents duplicate rows but does not prevent duplicate work or guarantee operational visibility.
- Add API tests for tenant isolation, role authorization, active/inactive employee eligibility, and concurrent approval/rejection attempts.
- Add an integration test covering BioTime sync followed by absence detection, including a late punch arriving after an automatically-created absence.
- Complete the manual running-backend UI check for a `LATE` row with minutes and an `ABSENT` row. The frontend handoff still marks this check incomplete.
- Resolve or formally approve the unrelated full-suite failures and frontend timeouts before treating the release as fully green. Keep the workspace clean for a clean-checkout verification.

## What passed / strengths

- The local Docker backend, Celery beat, notification worker, databases, and frontend were reported healthy; `docker compose ps` confirms the core containers are currently healthy/up.
- The reported attendance and admin portal suites passed: 75 tests, including 10 new schedule/absence tests.
- The new tests cover grace-window classification, late BioTime classification, non-working days, absence detection, leave exclusion, idempotency, and the disabled-setting guard.
- Settings validation constrains grace minutes and weekday values and preserves optional PUT semantics.
- The attendance querysets use company scoping and role-specific access paths; this should still be retained in the expanded API/tenant test matrix.
- The schema migration and deployment runbook are present, and the feature has a rollback/deployment procedure documented.

## Evidence checked

- [Backend/attendance/schedule.py](../Backend/attendance/schedule.py)
- [Backend/attendance/absence.py](../Backend/attendance/absence.py)
- [Backend/attendance/tasks.py](../Backend/attendance/tasks.py)
- [Backend/config/celery.py](../Backend/config/celery.py)
- [Backend/attendance/services.py](../Backend/attendance/services.py)
- [Backend/attendance/models.py](../Backend/attendance/models.py)
- [Backend/attendance/views.py](../Backend/attendance/views.py)
- [Backend/attendance/test_schedule_absence.py](../Backend/attendance/test_schedule_absence.py)
- [Backend/admin_portal/serializers_settings.py](../Backend/admin_portal/serializers_settings.py)
- [Backend/admin_portal/migrations/0003_systemsettings_attendance_schedule.py](../Backend/admin_portal/migrations/0003_systemsettings_attendance_schedule.py)
- [Backend/attendance/migrations/0011_attendancerecord_is_late_flagged.py](../Backend/attendance/migrations/0011_attendancerecord_is_late_flagged.py)
- [plans/Attendance Late + Absence — Frontend Handoff.md](Attendance Late + Absence — Frontend Handoff.md)
- Local `docker compose ps` output on 2026-09-02.
- User-provided verification: 75 attendance/admin tests passed; Django checks, migration checks, targeted Ruff, frontend type-check, lint, and production build passed; full backend had 10 unrelated failures; staging provider delivery was not executed.

## Scorecard

| Area | Score | Assessment |
|---|---:|---|
| Late classification correctness | 18/20 | Core cutoff and non-working-day behavior is clear and tested. |
| Absence data correctness | 14/15 | Eligibility and default scheduler ordering are corrected; reconciliation integration remains open. |
| Workflow and concurrency | 13/15 | Locked/rechecked transitions are implemented; true parallel-request testing remains open. |
| Tenant security and authorization | 10/15 | Existing scoping is positive; expanded new-path coverage is still needed. |
| Auditability and recovery | 9/10 | Batch audit policy and summary logging are implemented. |
| Scheduler/operations | 8/10 | Healthy services, corrected ordering, and overlap lock are verified; provider staging is open. |
| Test confidence | 6/10 | Focused tests pass, but API matrix, true race, and reconciliation tests are missing. |
| Frontend/release integration | 4/5 | Frontend checks are reported green; manual backend-connected validation remains unchecked. |

**Total: 82/100.** This is launchable with caveats, not a strong score, because staging/provider delivery, true parallel-request testing, BioTime reconciliation integration, manual UI validation, and full-repository cleanup remain open.

## Release recommendation

**Proceed to controlled staging/canary only.** The four original backend blockers are fixed. Broad production rollout should wait for a staging run with active, inactive, archived, on-leave, late-punch, and no-show cases, two simultaneous approval requests, BioTime reconciliation, provider delivery, and manual UI verification.

**Owner action:** complete the remaining staging and integration gates, then repeat the focused and full release checks from a clean checkout.

---

## Remediation log — 2026-09-02

All four High blockers plus the named high-value fixes were addressed in the backend. Focused suites re-run green in Docker: `attendance/` 64 passed, `admin_portal/` 5 passed, `manage.py check` clean, `migrate --check` clean (no schema change this round). Images rebuilt; `backend` / `celery-beat` / `notification-worker` recreated and healthy.

| # | Blocker | Fix | Evidence |
|---|---|---|---|
| 1 | Non-active workers markable absent | `_active_employee_profiles()` now also requires `employment_status=ACTIVE` and (`user IS NULL` OR `user.is_active`). Prehire/suspended/terminated/disabled-login excluded. | [attendance/absence.py](../Backend/attendance/absence.py) `_active_employee_profiles`; test `test_non_active_employees_are_not_marked_absent` |
| 2 | Absence job ran before morning BioTime sync | Default cron moved `05:30 → 10:00` (env `ABSENCE_DETECTION_HOUR/MINUTE` still override), i.e. after the 22:00 evening + 09:00 morning syncs for the target day. Comment corrected. | [config/celery.py](../Backend/config/celery.py) `mark-daily-absentees`; verified `crontab: 0 10 * * *` in running beat |
| 3 | Manager/CEO approve+reject not concurrency-safe | All four actions now: unlocked scope/permission check → `transaction.atomic()` → `select_for_update(of=("self",))` re-fetch → re-check `PENDING_*` while locked → single transition → notifications after commit. | [attendance/views.py](../Backend/attendance/views.py) `ManagerAttendanceViewSet._locked_manager_record` / `approve` / `reject`; `CEOAttendanceViewSet.approve` / `reject` |
| 4 | System absences lacked workflow/audit trail | Explicit policy documented in the module docstring (system rows are terminal, no approver). Each run writes one `AuditLog` summary (`attendance.absence_detection_run`, `actor=NULL`, counts in metadata). Rows are self-describing (`source=SYSTEM`, `created_by=NULL`, `notes`). | [attendance/absence.py](../Backend/attendance/absence.py) docstring + `audit(...)` call; test `test_run_writes_a_summary_audit_log` |

High-value fixes also applied:

- **N+1 leave query** → replaced with a single date-scoped `LeaveRequest` query (`_profiles_on_leave`).
- **`created` metric accuracy** → now counts rows actually present after `bulk_create(ignore_conflicts=True)`, not the number prepared (`prepared` reported separately).
- **Task overlap protection** → `mark_daily_absentees` takes a per-date `cache.add()` lock (600 s TTL, released in `finally`); a second overlapping run returns `{"skipped_locked": True}`.

Still open (not blockers, tracked for the staging gate):

- Genuine parallel-request integration test (needs `TransactionTestCase` + threads + Postgres). Sequential state-recheck is covered; true concurrency to be exercised on staging with two simultaneous approve calls.
- Expanded API matrix for tenant isolation / role authz on the new absence + settings paths.
- Integration test: BioTime sync → absence detection → late punch arriving after an auto-absence.
- Manual staging UI check for a `LATE` row (with minutes) and an `ABSENT` row — owned by the frontend/staging task.
- Unrelated full-repository failures + a clean-checkout verification.
