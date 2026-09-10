# Employee Document Permanent Deletion

`DELETE /api/employees/{employee_id}/documents/{document_id}/` destroys a private
file and its archive record. A filesystem delete cannot be rolled back by a
database transaction, so this is a two-phase operation, not one atomic block.

## The invariant

> **No `EmployeeDocument` is ever visible while its source file is missing.**

`deletion_started_at` is the visibility boundary. It is committed *before* the
file is touched, and every read path filters `deletion_started_at__isnull=True`:

- `EmployeeProfileViewSet._documents_for_profile` - list, download, patch, delete,
  extract and expiry-notification all resolve documents through it
- `leaves.views` leave-request document prefetch
- `employees.tasks.extract_employee_document` - a document being destroyed is
  never re-OCR'd

## Phases

| Phase | Action | If it fails |
|---|---|---|
| 0 | Reject system-generated documents and PROTECT-linked rows | Nothing has changed; 403 / 409 |
| 1 | Commit `deletion_started_at` (row becomes invisible) | Nothing has changed; 409 if already in flight |
| 2 | Delete the private file | **File still present** -> clear the flag, restore full visibility, return 500, write **no** deletion audit event |
| 3 | Delete the row | **File already gone** -> row stays flagged and invisible, return 500 with `cleanup_pending`, write the deletion audit event, sweep finishes it |

Phase 2 also treats "storage reported success but the file is still there" as a
failure, so a silently broken backend cannot orphan a record.

## Reconciliation

`employees.tasks.reconcile_employee_document_deletions` runs hourly (Celery beat,
`DOCUMENT_DELETION_RECONCILE_MINUTE`) and resolves anything flagged for longer
than `EMPLOYEE_DOCUMENT_DELETION_RECONCILE_GRACE_SECONDS` (default 300s):

- **File gone** -> finish the delete and emit `employee_document_deleted` with
  `actor=None` and `reconciled: true`
- **File still present** -> the process died before phase 2; clear the flag and
  restore the record

This is the compensation for a crash between phases, which no transaction can
cover. Both branches are covered by `test_document_deletion_invariant.py`.

## Audit

`employee_document_deleted` carries actor, employee profile id, document id,
document type, original filename and company id. It never carries file contents
or OCR text. A deletion that failed in phase 2 writes no event at all, because
nothing was destroyed.
