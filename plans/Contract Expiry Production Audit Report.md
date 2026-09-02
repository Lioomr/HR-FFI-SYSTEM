# Contract Expiry Notification and Renewal Workflow

## Production Audit Report

**Date:** 2026-09-02  
**Scope:** Backend contract-expiry workflow, Celery scheduler, notifications, approval APIs, workflow projection, migration, and frontend contract-decision pages.  
**Assessment:** Pre-deployment engineering audit; not a formal compliance certification.

## Executive decision

**Current production readiness score: 78/100 — LAUNCHABLE WITH CAVEATS; staging/provider verification and a green full-suite result remain before production.**

The third audit confirms that the original stale-state, scheduler-isolation, date-validation, token-invalidation, list-scaling, and final-notification recovery findings were addressed. The workflow should still not be enabled in production until staging/provider verification and the full-suite release gate are complete.

The remaining release risk is operational evidence: provider behavior, Celery topology, alerting, and the complete backend suite still require staging or clean-environment verification.

## What was reviewed

- `Backend/employees/contract_expiry.py`
- `Backend/employees/models.py`
- `Backend/employees/serializers.py`
- `Backend/employees/views.py`
- `Backend/employees/tasks.py`
- `Backend/employees/migrations/0017_contractdecision.py`
- `Backend/employees/migrations/0018_contractdecision_manual_resolution.py`
- `Backend/employees/migrations/0019_contractdecision_automatic_renewal_metadata.py`
- `Backend/employees/migrations/0020_contractdecision_final_notification_state.py`
- `Backend/config/celery.py`
- `Backend/in_app_notifications/dispatcher.py`
- `Backend/core/services/workflow_engine.py`
- `FrontEnd/src/pages/shared/ContractDecisionsPage.tsx`
- `FrontEnd/src/services/api/contractDecisionsApi.ts`
- `FrontEnd/src/routes/routes.tsx`
- `Backend/employees/test_contract_expiry.py`
- `plans/Contract Expiry Deployment Runbook.md`

## Score breakdown

| Area | Score | Assessment |
|---|---:|---|
| Core functional coverage | 78 | Main renewal, termination, auto-renewal, manual-resolution, and notification paths exist. |
| Data integrity | 72 | Locked snapshot comparison and date validation address the principal mutation risks. |
| Background-job reliability | 70 | Per-record isolation, structured attention logs, and database retry/backoff are present. |
| Notification reliability | 78 | Milestones, reminders, and final/manual-resolution notifications have durable retry state and deduplication. |
| Security and tenant scope | 78 | API scope and CEO workflow gates are present; staging and broader integration evidence remain. |
| Observability and recovery | 70 | Runbook, structured attention logs, and notification retry state exist; alert execution and provider recovery are not yet demonstrated. |
| Test confidence | 65 | Fourteen focused contract/API tests pass; the full backend suite and staging tests are incomplete. |
| Deployment readiness | 71 | Migration, pause, rollback, monitoring, and restart procedures are documented; execution remains outstanding. |

The headline score is a weighted release-readiness score, not the arithmetic average of the category rows. Operational evidence and the unverified provider/full-suite gates receive higher weighting because this workflow can change contractual state automatically.

## Release status and remaining gates before production

### Closed: make final and manual-resolution notifications recoverable

Final and manual-resolution notifications now persist attempt state on the decision. Notification delivery is claimed after the contract transaction commits, and the hourly scheduler revisits terminal decisions whose notification has not been recorded as sent.

Evidence: [contract_expiry.py:178](../Backend/employees/contract_expiry.py:178), [contract_expiry.py:202](../Backend/employees/contract_expiry.py:202), [contract_expiry.py:242](../Backend/employees/contract_expiry.py:242), and the retry scan in [contract_expiry.py:673](../Backend/employees/contract_expiry.py:673).

**Disposition:** Fixed with durable attempt/sent timestamps, guarded post-commit delivery, one-hour retry eligibility, per-recipient persistence checks, stable deduplication keys, and failure-injection coverage. Existing email/WhatsApp delivery tasks retain their own retry behavior.

The implementation uses decision-level delivery state rather than a separate outbox table because the existing dispatcher already persists the in-app notification and queues the external channels. The scheduler repair scan keeps notification recovery independent of the terminal contract status.

### Remaining: complete staging/provider verification

The runbook exists, but the external notification providers and production-like Celery topology have not yet been verified in staging.

**Required evidence:** Run the controlled staging invocation, confirm WhatsApp/Bird fallback delivery and retry behavior, verify worker/beat health, and confirm the attention alerts fire for simulated failures.

### Remaining: close the full-suite release gate

The full backend suite currently stops at an unrelated assets failure caused by local `ALLOWED_HOSTS` configuration. This is not a contract defect, but the release is not yet backed by a green full-suite result.

**Required fix:** Correct the test environment configuration or document an approved, isolated exception, then complete the backend suite and record the result.

## Initial audit findings and disposition

The following findings from the first audit are now considered addressed, subject to the tests and staging evidence listed below.

### Closed: stale approvals and concurrent profile changes

`finalize_decision()` locks the decision and employee profile, but it does not verify that the employee still matches `original_contract_date`, `original_contract_expiry`, and the original terms captured when the decision was created.

Evidence: [contract_expiry.py:280](../Backend/employees/contract_expiry.py:280).

**Failure:** HR or another integration changes the employee contract after submission; CEO approval later overwrites that change or applies termination to an outdated record.

**Disposition:** Fixed with locked snapshot comparison and `MANUAL_RESOLUTION_REQUIRED` handling.

### Closed: milestone and CEO-reminder state updates

Milestones are marked in `notification_milestones` before notification dispatch. CEO reminders update `last_ceo_reminder_at` before dispatch.

Evidence: [contract_expiry.py:412](../Backend/employees/contract_expiry.py:412) and [contract_expiry.py:430](../Backend/employees/contract_expiry.py:430).

**Failure:** A temporary database, queue, email, WhatsApp, or provider failure results in a permanently skipped notification.

**Disposition:** Fixed for milestone, CEO-reminder, and final/manual-resolution notification persistence and retry state.

### Closed: per-employee scheduler isolation

`ensure_contract_decision()` calls `sync_workflow()` without local error isolation. The profile loop does not wrap decision creation and workflow synchronization per employee.

Evidence: [contract_expiry.py:41](../Backend/employees/contract_expiry.py:41).

**Failure:** One malformed record, workflow error, or transient database error stops processing for all later employees in that task invocation.

**Disposition:** Fixed with per-record isolation, structured attention logs, and database retry/backoff configuration.

### Closed: renewal date validation

The serializer only rejects an invalid range when both proposed dates are supplied. A proposed expiry without a proposed start can be earlier than the calculated renewal start.

Evidence: [serializers.py:94](../Backend/employees/serializers.py:94) and [contract_expiry.py:227](../Backend/employees/contract_expiry.py:227).

**Disposition:** Fixed and covered by the proposed-expiry/implicit-start test.

### Improved: backend test coverage

The original focused suite contained six service-level tests and lacked contract API, authorization, tenant-isolation, scheduler, provider-delivery, and concurrency tests.

The current verification environment can run Django tests directly; the focused contract/API suite passes. The full backend suite still stops at an unrelated local `ALLOWED_HOSTS` failure in the assets tests.

**Disposition:** Expanded to 14 contract/API tests covering roles, tenants, stale state, reminders, renewal, API behavior, and post-commit notification retry. Full-suite and staging evidence remain outstanding.

## Closed findings and remaining improvements

### Closed: notification-status query scaling

`ContractDecisionReadSerializer.get_notification_status()` queries notifications and deliveries for each serialized decision. It also calls workflow snapshot logic per record, which can perform synchronization work during GET requests.

Evidence: [serializers.py:65](../Backend/employees/serializers.py:65).

**Disposition:** The list endpoint now batches workflow and notification reads. Validate query counts and latency with a production-sized dataset.

**Recommendation:** Keep the read-only workflow snapshot path and measure query count/latency with a production-sized dataset.

### Closed: token invalidation edge case

Termination increments `auth_token_version` only when the user is currently active.

Evidence: [contract_expiry.py:301](../Backend/employees/contract_expiry.py:301).

**Disposition:** Fixed by incrementing the token version whenever a linked user exists during termination, including already-inactive users.

### Remaining test improvements

Retain or add coverage for:

- HR from another company cannot submit or list the decision.
- CEO from another company cannot approve it.
- Non-CEO cannot approve or reject.
- Duplicate HR submission and double CEO clicks.
- CEO approval racing with employee-profile update.
- Auto-approval of renewal and termination after 48 hours.
- Automatic renewal preserving all terms.
- Invalid dates and invalid numeric terms.
- Notification persistence failure and provider failure.
- Final/manual-resolution notification failure after the contract state has committed.
- Celery task reruns and overlapping scheduler invocations.
- Migration from a production-like database snapshot.

## Strengths

- The contract decision has a unique cycle constraint by employee and original expiry.
- Domain transitions use `transaction.atomic()` and `select_for_update()` for the decision path.
- CEO actions pass through the shared workflow authorization gate.
- Termination archives the employee, disables the account, and records an audit event.
- Notification delivery uses recipient/deduplication keys.
- The scheduler is configured hourly in [celery.py:13](../Backend/config/celery.py:13).
- The frontend exposes status, approval history, and delivery information.

## Verification evidence

Observed during audit:

- Frontend TypeScript type-check: passed.
- Full frontend Vitest run: the current dirty workspace has unrelated failures/timeouts in job-offer, annual-leave settlement, work-location map, and BioTime settings tests; the run was stopped after those failures became repetitive.
- Contract/API tests: 14 passed with Django's test runner and the existing test database.
- Backend Django checks, migration check, targeted Ruff, frontend type-check/lint/build, and graph refresh: passed.
- Full backend suite with explicit local test hosts: 572 passed and 10 unrelated tests failed in cross-company manager scope, job-offer notification compatibility, and historical admin/job-offer migration coverage.
- Frontend lint: passed with 27 pre-existing warnings and no errors. Frontend build completed successfully.
- Working tree: contains the contract feature plus many unrelated modified files and generated artifacts. Release should be made from a clean, isolated commit.

## Release-gate verification - 2026-09-02

- Local Docker topology verified: PostgreSQL, Redis, backend, notification worker, Celery beat, and Evolution API were running; backend, notification worker, Celery beat, and Evolution API health checks were healthy after adding the beat liveness check to [docker-compose.yml](../docker-compose.yml) and [docker-compose.dev.yml](../docker-compose.dev.yml).
- `docker compose config --quiet` passed for both `docker-compose.yml` and `docker-compose.dev.yml`.
- Celery worker responded to `inspect ping`, and `employees.tasks.process_contract_expiry_notifications` was registered. Beat configuration uses a separate worker and an hourly `crontab(minute=0)` schedule.
- Provider-focused tests passed: 54 tests plus 12 subtests covering Evolution/WhatsApp security, worker readiness, notification persistence, delivery, and retry behavior. The local Evolution authenticated instance endpoint also returned HTTP 200.
- Real Bird/Evolution staging delivery was not verified: the available local environment has WhatsApp delivery disabled and no staging provider test account or staging deployment target is configured. No external messages were sent.
- Full backend suite with `DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver` and `SECURE_SSL_REDIRECT=false`: 572 passed, 10 failed. The failures are unrelated to contract expiry and are in cross-company manager scope behavior, job-offer notification test compatibility, and historical admin/job-offer migration tests.
- Full frontend Vitest run was started and identified unrelated failures/timeouts in job-offer pages, annual-leave settlement pages, the work-location map picker, and BioTime settings before being stopped to avoid repeated long timeout waits. Contract-expiry type-check, lint, and production build remain green.
- Clean-checkout verification remains outstanding because the current workspace contains uncommitted feature changes and unrelated dirty files/artifacts.

## Deployment gate

Do not enable the hourly task in production until all blockers are closed and the following evidence is attached to the release:

1. Clean checkout with migration applied successfully.
2. Full backend test suite passing in the project environment.
3. Contract API, tenant, concurrency, Celery, and notification-failure tests passing.
4. Frontend type-check, lint, build, and tests passing or documented with approved unrelated failures.
5. Celery worker and beat health checks confirmed after restart.
6. Notification provider failure and retry behavior verified in staging.
7. Rollback procedure tested, including how to pause the scheduled task safely.
8. Monitoring alert for scheduler failure, renewal failure, and notification delivery failure.

## Recommended implementation order

1. Complete staging/provider and Celery topology verification.
2. Close the full backend-suite release gate in an approved test environment.
3. Add production-sized query/latency evidence and execute the deployment rollback drill.
