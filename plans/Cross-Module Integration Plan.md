# Cross-module integration plan

Reviewed against local code on 2026-09-10. This is an implementation-backed gap assessment, not a production audit. Existing unrelated working-tree changes, including `Backend/permission_requests/`, were inspected but not modified.

## Attendance and leave: first implementation

An existing SYSTEM absence with no punches is displayed as **Excused absence** when an active, finally approved leave covers the same employee, company and date. The attendance API adds `effective_status` and `excused_by_leave_id`; original `status`, notes and device evidence stay unchanged. HR/CEO lists add `effective_summary`, and attendance lists accept `effective_status` filtering. Existing raw status filters and summaries remain compatible.

The resolution is computed from current approved leave on each read. Retroactive approval, HR manual leave, edited dates, soft deletion and a transition away from approved therefore take effect without a backfill job or duplicated state. Linked profile identity takes precedence over the legacy user link. An active approval from another company does not explain the record. Pending approval, actual punches, present/late records and non-SYSTEM records are not converted. Leave identifiers are returned only for excused records; private leave reasons and medical attachments are not exposed.

All approved leave types, including business trips and unpaid leave, explain full-day absence. **Excused does not mean paid.** This change does not calculate salary or entitlements. Web HR/CEO, manager and employee attendance displays consume the effective result; HR/CEO filters, totals and CSV exports use it. Older consumers can continue reading the original status.

Existing behavior remains: absence detection skips active approved leave when no attendance record exists. It now excludes soft-deleted or mismatched-company leave. A unified day calendar showing leave-only days is a follow-up; this first change classifies existing attendance records.

## Integration priorities

| Priority | Integration | Observed implementation | Required behavior |
|---|---|---|---|
| P1 | Leave + attendance + payroll | `payroll/views.py::_generate_payroll_items` calculates salary/allowances and a due loan; it does not consume attendance or leave pay segments. `leaves/utils.py` already computes pay segments. | Calculate payable days from a shared daily result. Keep explained unpaid leave separate from unexcused absence. Apply sick/annual pay segments once and prevent duplicate deductions. Review company pay rules before enabling calculations. |
| P1 | Exit permission + attendance | The untracked `permission_requests` module has approval and time intervals; attendance resolution does not consume it. Treat this as work in progress, not a released feature. | Excuse only the approved interval for late arrival/early departure, never the entire day. Preserve punches; account for overlap, cancellation and partial coverage. |
| P1 | Work schedules + holidays + leave | `attendance/schedule.py` uses singleton weekly settings. `leaves/utils.py` maintains separate holiday/day-count logic. | Introduce one company calendar with effective dates, holidays, shifts and timezone. Use it for absence detection, leave duration, late calculations and payroll. Historical results must not silently change when today's settings change. |
| P1 | Termination + assets + clearance | `assets/signals.py` currently closes assignments and makes assets AVAILABLE automatically on termination. | Open clearance obligations. Require confirmed physical return/condition before marking equipment available; track outstanding assets, loans and final settlement separately. This policy change requires business agreement. |
| P1 | Payroll run + payslip + loan lifecycle | Payroll generation marks the selected loan DEDUCTED and creates payslips with status PAID; separate completion/payment actions exist. | Align generated, completed and paid states. Define reversal/rebuild rules and use a deduction ledger to prevent duplicates. Keep paid periods fixed; issue an explicit adjustment for later approvals. |
| P2 | Business trip + delegation + assets | `core/services/request_obligations.py` already checks travel asset returns and pending approvals, and creates delegation rules. | Retain existing gates; verify cleanup when trip dates, delegate or approval state changes. Link delegation to its source request, deactivate obsolete rules, and define whether the rejoin date is included. |
| P2 | Leave changes + balances + settlements | Leave utilities compute balances and payment breakdowns; manual approved leave can be edited or soft-deleted. | Verify all mutation paths refresh affected balance snapshots and draft settlements for both old and new date ranges. Preserve approved/paid settlement history with adjustments. |
| P2 | Hiring/termination/transfer + attendance + payroll | Absence eligibility uses current active status, hire date, company and BioTime mapping. Payroll selects currently active profiles. | Model effective-dated employment/company history, exclude prehire/post-exit days, and prorate entry/exit periods. Current status cannot reconstruct a historical pay period reliably. |
| P2 | Attendance + late-arriving BioTime punches | `attendance/services.py` already promotes eligible system absences when punches arrive. | Test every downstream consumer against late imports. A punch during approved full-day leave should become an HR review conflict, not silently cancel leave or alter leave balance. |
| P2 | Shared reporting + mobile | Web attendance uses the new effective classification; legacy API fields remain available. | Adopt the same result in mobile, dashboards, employee calendars and future payroll reports. Add a leave-only calendar entry where absence detection deliberately created no row. |

## Shared design

Use one employee-day calculation that returns attendance evidence, applicable schedule, approved full-day leave, approved permission intervals, conflicts, and separate payable components. Domain requests remain the authority for approval. Derived reporting can be computed on read; financial results must be versioned and stored when a payroll period is finalized.

For persisted effects, use transactional domain services and an idempotent event/outbox with retries. Events should carry company, employee profile, source request, old/new date ranges, actor and revision. Approval, edit, cancellation, deletion and late device import must all have reconciliation paths. Do not build a second approval engine or hide integration failures inside notification handlers.

Never infer a physical asset return from employee status. Never infer pay eligibility from an attendance label. Avoid a universal precedence rule that erases real evidence: conflicting punches and approved leave need review.

## Acceptance scenarios

1. Absence first, approved leave later: effective EXCUSED, source absence retained, leave reference visible.
2. Approved leave first: absence detection skips it; deleted approval no longer suppresses detection.
3. Pending/rejected/cancelled/deleted leave: no excuse. Date edits re-evaluate both old and new days.
4. Unpaid leave: explained absence; pay treatment is a separate payroll rule.
5. Wrong employee/company: no match. Legacy user-only rows match only when there is no profile link.
6. Actual punch: present/late/raw punched status preserved; future conflict review can flag leave overlap.
7. Multiple covering approvals: one deterministic explanation; removing it retains any other valid coverage.
8. HR/CEO filters, counts and CSV agree on effective classification; legacy raw API fields remain unchanged.
9. Future financial integration: replaying events cannot double-deduct; paid payroll changes require an adjustment.

## Validation

Focused backend regression tests cover resolution, reversals, dates, company/profile boundaries, raw evidence, API counts/filtering, legacy identity, absence detection and query count. Frontend tests cover attendance screens and effective classification/filtering.

- PostgreSQL with migrations, isolated source copy inside the local Docker backend: `python -m pytest attendance/test_leave_resolution.py attendance/test_schedule_absence.py attendance/test_absence_eligibility.py attendance/test_biotime_only_policy.py::AttendanceReadAccessTests -q --tb=short --maxfail=1 -o addopts=`: **31 passed, 3 role subtests passed**. The test database was separate from the running application's database.
- `npx vitest run src/pages/shared/AttendancePreviewPage.test.tsx src/pages/shared/AttendancePreviewPage.ceo.test.tsx src/pages/employee/AttendancePage.test.tsx src/pages/manager/ManagerAttendancePage.test.tsx`: **30 passed**.
- `npx tsc -b --pretty false`: passed. The repository's `tsc --noEmit` script alone does not build its referenced TypeScript projects.
- `npx vite build`: passed (existing bundle-size warning).
- Ruff on changed Python files, targeted ESLint on changed application TypeScript files, Django system checks, and whitespace checks passed.
- SQLite was insufficient for full acceptance: migrations use PostgreSQL SQL, and manager scoping uses a JSON containment lookup. Final backend acceptance above used PostgreSQL.

Live BioTime device synchronization and deployment acceptance remain outstanding. No deployment, salary rule change or migration was performed against application data.
