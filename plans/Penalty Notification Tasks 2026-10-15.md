# Penalty notification tasks

Recorded: 15 October 2026.

## Task 1: Suppress employee notifications when penalties are waived

Status: Implemented, verified locally and deployed to production on 15 October 2026.

Do not notify the employee when a penalty is waived or marked excused. Cover HR decisions, automatic withdrawal after attendance evidence changes, and withdrawal of an automatically issued warning. Suppress employee in-app, WhatsApp, email, SMS and push messages for those waiver or withdrawal events wherever supported. This task does not suppress initial warning issuance notifications.

Preserve the waiver itself, audit history, payroll safeguards and HR notifications.

Implement and verify in the local environment first. Update production only after the local work is complete and verified; no production changes are part of recording this task.

Acceptance checks:

- HR waiver or excuse produces no employee notification or external delivery.
- Automatic candidate withdrawal produces no employee notification or external delivery.
- Withdrawal of an issued automatic warning produces no employee notification or external delivery.
- Existing waiver state transitions, audit records and HR notifications continue to work.

## Task 2: Automatically notify late arrivals from 15 October 2026

Status: Implemented, verified locally and deployed to production on 15 October 2026.

Automatically notify employees about late-arrival records without waiting for HR for these codes:

| Code | Late arrival |
|---|---|
| W01 | Up to 15 minutes |
| W03 | Over 15 and up to 30 minutes |
| W05 | Over 30 and up to 60 minutes |
| W07 | More than 60 minutes |

The inclusive start date is 15 October 2026, the user's "today" when requested. Apply the cutoff to the attendance incident date, not the notification creation date or deployment date. Do not notify for incidents before 15 October 2026, including past records that are later recalculated, imported or updated. Do not backfill notifications for the existing historical backlog.

This task requests automatic employee notifications; it does not itself authorize automatic approval or application of monetary deductions, or changes to penalty amounts or escalation rules. During local implementation, distinguish notification generation from penalty issuance so the notification request does not silently change payroll behavior.

Implement and verify locally before updating production. Task 1 continues to apply: waivers, excuses and withdrawals must not notify employees.

Acceptance checks:

- Eligible W01, W03, W05 and W07 incidents dated 15 October 2026 or later notify the employee without HR action.
- Incidents dated 14 October 2026 or earlier never receive a notification through this new behavior, even when processed after the cutoff.
- Repeated synchronization, recalculation and notification retries do not create duplicate notifications for the same event.
- Existing attendance exemptions and accepted excuses remain respected.
- Automatic notifications do not automatically approve or apply monetary deductions.
- Waiver and withdrawal notifications remain suppressed under Task 1.

## Automatic warning behavior observed before these tasks

The penalties module supports automatic issuance for W01, W02 and W07 for the first three monthly occurrences in their configured recurrence group, after the configured settlement delay. Later occurrences return to HR review. Production automatic warning issuance was disabled when inspected on 15 October 2026 because PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM was empty.

The older attendance late-notice flow is separate and must be distinguished from the penalties module during implementation and verification.

## Local implementation and verification

Completed locally on 15 October 2026:

- Employee waiver/excuse notifications are suppressed at the shared penalty notification entry points and HR action routes. The automatic warning-withdrawal sender has been removed. HR messages, audit history and payroll safeguards remain.
- W01/W03/W05/W07 incident notifications run after attendance commits, starting with incident date 15 October 2026 inclusive. They use the shared in-app and WhatsApp-first dispatcher, with configured email fallback, and explicitly state that HR review is pending.
- Notification creation leaves the record pending HR review, creates no PDF warning, and does not rate or apply a monetary penalty. The existing optional automatic PDF warning policy remains separately configured and disabled in the local runtime.
- Current evidence, active user, BioTime enforcement and executive exemption are rechecked before notification creation. A durable timestamp prevents resending after recalculation or inbox cleanup. An hourly retry sweep handles eligible unsent records.
- Added migration `penalties.0008_penaltyrecord_late_arrival_notified_at`, applied to the local development database.
- Penalties and payroll phase 2 regression suite: 162 tests passed, with 28 subtests passed. Tests used the local PostgreSQL test database, in-memory Celery transport and in-memory Channels; external provider delivery was not exercised.
- Rebuilt the local backend, notification worker and Celery Beat. In the rebuilt container, 30 automatic-warning and late-notification tests passed, with 28 subtests passed. Django system checks passed and `makemigrations penalties --check --dry-run` reported no pending changes.
- Production was unchanged at the end of local verification. Deployment requires migration 0008 and matching backend, notification worker and Beat images. The new recorded-arrival cutoff defaults to `2026-10-15`; do not replace it with the later deployment date or move it earlier.

## Production deployment verification

Deployed code commit `f39ecaca` to `/opt/hr-ffi` on 15 October 2026. Only the verified penalty notification commit was transferred; unrelated local payroll work was excluded. A PostgreSQL custom-format backup, prior commit and image references, and Compose backup were saved under `/home/ubuntu/deployment-backups/penalty-f39ecaca-20261015T080613Z` before migration. The dump's table of contents was verified with `pg_restore --list`.

Migration `penalties.0008_penaltyrecord_late_arrival_notified_at` applied successfully before the backend, notification worker and notification Beat were recreated. All three containers serve the same notification/task source hashes. Runtime settings retain the inclusive incident cutoff `2026-10-15`; the separate legacy PDF-warning activation remains empty.

The production worker processed two eligible late-arrival candidates dated 15 October 2026. Two employee notifications were persisted and both WhatsApp deliveries reached `sent`. The two penalty records remain `pending_hr_mark`; the new penalties deduction table remains empty. No incidents before 15 October received the new notification marker.

The public API `/healthz/` returned `{"status":"ok"}`, the worker responded to ping, and the configured Healthchecks monitor accepted a heartbeat. Existing untracked server backup files were preserved. No frontend, database service or messaging-provider service was rebuilt.
