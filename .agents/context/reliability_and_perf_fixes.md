# Reliability & Performance Fixes (2026-08-26)

> **TL;DR:** A round of fixes addressed 5 issue classes system-wide: uncompressed
> HTTP responses, unlocked concurrent DB writes on approval workflows, a split
> Celery worker/beat topology, per-recipient N+1 notification writes, and
> pessimistic (wait-for-server) approval-queue UIs. Read this before touching any
> file listed below — several fixes rely on non-obvious invariants that are easy
> to silently undo.

## 1. HTTP compression — do not remove

- `Backend/config/settings.py` — `django.middleware.gzip.GZipMiddleware` is
  **first** in `MIDDLEWARE`. Keep it first (Django docs: it must sit before
  other response-mutating middleware so it compresses last).
- `FrontEnd/nginx.conf` and `CinematicSite/nginx.conf` — both have `gzip on;`
  plus a `location /assets/` block with `Cache-Control: immutable` for
  Vite's content-hashed build output. If you change Vite's `assetsDir` or
  `base`, update this block to match or static assets silently lose caching.

## 2. Locked, atomic writes on approval/decision workflows

Every one of these previously read a row, checked its status in Python, then
wrote — with no `select_for_update()` and no `transaction.atomic()`. Two
concurrent requests (a slow UI double-click, a retried request) could both
pass the status check and double-process the same request. **The fix pattern
is now the standard for this codebase** — follow it for any new
approve/reject/cancel action:

```python
with transaction.atomic():
    instance = Model.objects.select_for_update().get(pk=instance.pk)
    if instance.status != EXPECTED_STATUS:
        return error(...)  # re-check inside the lock, not just before it
    instance.status = NEW_STATUS
    ...
    instance.save(update_fields=[...])
    sync_workflow(instance, actor=request.user)  # if applicable
# audit()/notify_*() calls stay OUTSIDE the atomic block, unchanged
```

Fixed call sites:
- `Backend/accounts/security.py::record_login_failure` — login-lockout counter race.
- `Backend/attendance/services.py::SyncBioTimeService.ingest_transactions` +
  `Backend/attendance/biotime_views.py::BioTimeAgentIngestView` — BioTime sync,
  entire ingest loop wrapped so a mid-sync failure doesn't leave
  `BioTimeConfig.last_sync_time` advanced past a partial write.
  **Gotcha already hit once:** this function's transaction loop variable must
  NOT be named `transaction` — it shadows the `django.db.transaction` import
  for the rest of the function (a real `AttributeError`/`UnboundLocalError`
  this exact rename was needed to fix). It's named `raw_transaction` now — keep it that way.
- `Backend/loans/views.py` — **all nine** approve/reject/cancel/refer-to-ceo
  actions across `HRLoanRequestViewSet`, `ManagerLoanRequestViewSet`,
  `CFOLoanRequestViewSet`, `CEOLoanRequestViewSet`. This mirrors the pattern
  already used correctly in `Backend/employees/views.py::EmployeeDeletionRequestViewSet.approve`
  — that one was the reference implementation.
- `Backend/core/services/request_obligations.py::_upsert_obligation` — added
  `select_for_update()` to the existing-obligation lookup. Safe because every
  caller (`sync_leave_obligations`) is already `@transaction.atomic`; don't
  call `_upsert_obligation` from a non-atomic context without wrapping it.

## 3. Batched writes instead of per-row loops

- `Backend/employees/services/importer.py` — the manager-linking pass (second
  loop in `EmployeeImporter.execute`) no longer calls `profile.save(...)` per
  row. It appends changed profiles to `changed_manager_profiles` and does one
  `EmployeeProfile.objects.bulk_update(changed_manager_profiles, ["manager_profile", "manager", "updated_at"])`
  after the loop. **Do not** re-add a per-row `.save()` here — for a
  `MAX_IMPORT_ROWS` (5000) import that was 5000 individual UPDATE statements.

  **`bulk_update()` bypasses `Model.save()`, signals, and `full_clean()`/`clean()`
  entirely — this bit us once already, caught by
  `employees.tests.EmployeeProfileTests.test_excel_import_raw_dates_saudi_foreign_and_manager_profile_linking`.**
  `EmployeeProfile.save()` (`Backend/employees/models.py` ~line 205) derives the
  legacy `manager` (User FK) field from `manager_profile` whenever the latter
  changes, and a Postgres trigger (`ffi_validate_employee_profile_tenant()`)
  rejects any UPDATE where `manager`/`manager_profile` disagree. `bulk_update`
  skips that derivation, so the importer now sets `profile.manager_id`
  explicitly (`= manager_profile.user_id` or `None`) alongside
  `profile.manager_profile` before appending to the batch, and includes
  `"manager"` in the bulk_update field list. `save()` also implicitly ran
  `self.clean()` (which calls `validate_manager_assignment`) — that's still
  covered here because the importer already calls `validate_manager_assignment()`
  explicitly earlier in the same loop before accepting the assignment, so
  nothing is silently unvalidated. **If you extend this loop to set any other
  `EmployeeProfile` field, check `EmployeeProfile.save()` first for
  denormalization logic (name/nationality/department/job-title EN↔AR
  fallbacks, `total_salary` computation) and either replicate it manually or
  don't put that field through `bulk_update`.**
- `Backend/announcements/utils.py::send_announcement_in_app` +
  `Backend/in_app_notifications/services.py::create_notification` +
  `Backend/in_app_notifications/dispatcher.py::dispatch_notification_channels` —
  added a `known_new: bool = False` parameter threaded through all three.
  `send_announcement_in_app` now does ONE batch query
  (`Notification.objects.filter(deduplication_key=..., recipient_id__in=[...])`)
  before the per-recipient dispatch loop, instead of one dedup SELECT per
  recipient inside `get_or_create`. `known_new=True` tells `create_notification`
  to skip straight to `.create()` for recipients already confirmed new.
  **`known_new` defaults to `False`** everywhere else in the codebase — every
  other caller of `dispatch_notification_channels`/`create_notification`
  (leave/loan/document-expiry notifications, etc.) is unaffected. Do not flip
  this default; do not pass `known_new=True` unless you've actually
  batch-checked the recipient set first, or you'll create duplicate
  notifications on a redelivery.
- `Backend/announcements/views.py` — the two per-recipient attachment-upload
  loops (HR selected-employee path, and the manager/CEO team-with-attachment
  path) are now wrapped in `transaction.atomic()`. They still loop
  per-recipient (a `FileField.save()` per `Announcement` isn't easily
  batchable into `bulk_create`) — this fix is atomicity, not batching. The
  sibling no-attachment path already used `bulk_create()` before this change.

**Known, not yet fixed** (found in the same sweep, lower priority / bigger
lift — do not assume these are already safe):
- No connection pooler (PgBouncer) in front of Postgres; no `CONN_MAX_AGE` set.
- The single Redis instance still backs Celery broker + result backend +
  Django Channels — a Redis outage takes down all three at once.
- `Backend/accounts/security.py::blacklist_outstanding_refresh_tokens` still
  does one `get_or_create()` per outstanding token instead of `bulk_create`.

## 4. Celery worker/beat topology — do not recombine

`docker-compose.yml` and `docker-compose.dev.yml` both now run `celery beat`
in its **own** `celery-beat` service, separate from `notification-worker`
(which runs `celery worker` only, no `-B` flag). Previously one container ran
`celery -A config worker -B`, so a worker crash also killed every scheduled
job (leave reminders, BioTime sync, notification cleanup). **Do not merge
`-B` back into the worker command** — if you need a reason to point to,
it's this file.

`docker-compose.dev.yml`'s `notification-worker` service now has
`evolution-api: { condition: service_healthy, required: false }` on its
`depends_on`, matching what `docker-compose.yml` already had. Without
`required: false`, an unhealthy WhatsApp gateway blocks the worker from
starting at all in dev — including BioTime sync and every other scheduled job
that has nothing to do with WhatsApp.

## 5. CinematicSite static hosting

`CinematicSite/Dockerfile` + `CinematicSite/nginx.conf` are new — this
separate marketing site (`ffi-line-of-certainty`, not part of the main HR
app) previously had no containerized hosting path at all. It's wired into
both compose files as `cinematic-site` under `profiles: ["marketing"]`, so
`docker compose up` for the core HR stack does not build/start it by default.
Run it explicitly with `docker compose --profile marketing up cinematic-site`.

## 6. Frontend: optimistic approval-queue updates

Pattern now used across every list-view approval/decision screen: on
approve/reject, remove the row from local state **before** the API call
resolves (and decrement any `total` count), then restore it (re-insert +
increment) only if the request fails. The action's `notification.success(...)`
no longer triggers a `load()`/`loadData()` re-fetch on the happy path — the
optimistic removal already reflects the outcome.

```tsx
const approve = async (row) => {
  setProcessingId(row.id);
  setData((current) => current.filter((item) => item.id !== row.id));
  try {
    const res = await approveX(row.id);
    if (isApiError(res)) {
      setData((current) => (current.some((item) => item.id === row.id) ? current : [...current, row]));
      notification.error(...);
      return;
    }
    notification.success(...);
  } catch {
    setData((current) => (current.some((item) => item.id === row.id) ? current : [...current, row]));
    notification.error(...);
  } finally {
    setProcessingId(null);
  }
};
```

Fixed screens (all list-views): `FrontEnd/src/pages/manager/ManagerTeamRequestsPage.tsx`
(leave tab + asset-return tab), `FrontEnd/src/pages/ceo/CEOLeaveInboxPage.tsx`,
`FrontEnd/src/components/ceo/CeoAssetApprovalPage.tsx` (shared by
`CEOAssetReturnRequestsPage.tsx` and `CEOAssetDamageReportsPage.tsx`),
`FrontEnd/src/components/attendance/AttendanceCorrectionsApproverTable.tsx`
(shared by HR and manager attendance-correction inboxes),
`FrontEnd/src/pages/ceo/CEOAnnualLeaveSettlementsPage.tsx`,
`FrontEnd/src/pages/hr/assets/HRAssetsPage.tsx::handleHRReturnRequestAction`,
`FrontEnd/src/pages/admin/AdminInvitesPage.tsx::revokeInviteRow` (status-flip
variant, not a removal — see file).

**Deliberately NOT fixed** (single-record detail pages, not list queues):
`FrontEnd/src/components/loan/LoanRequestDetailsPage.tsx`,
`FrontEnd/src/pages/ceo/CEOEmployeeDeletionDetailPage.tsx`. On a detail page
there's no "next status" that's safe to guess client-side without risking a
visibly wrong state before the server responds — don't force the pattern
here without a bigger design pass (e.g. adopting a query library with
`onMutate`/`onError`). `AdminInvitesPage.tsx::resendInviteRow` was also left
alone — resend doesn't change status, so there's nothing to optimistically flip.

No state library (React Query/SWR/RTK Query) is in use — this is a hand-rolled
pattern per component. If one gets adopted later, migrate these call sites to
`onMutate`/`onError` instead of maintaining the manual filter/restore pairs.
