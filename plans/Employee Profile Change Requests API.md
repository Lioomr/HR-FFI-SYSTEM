# Employee Profile Change Requests API

Added 2026-09-30 (v2; replaces the unshipped v1 "Employee Document Change Requests" API, which had one
document per request and `approve`/`reject` endpoints. v1 was never released, so its paths
`/employees/me/document-change-requests/` and `/employees/document-change-requests/` were removed without a
compatibility route).

An employee asks for one or more changes to their own personal details and passport / national ID in one
request. Uploaded passport / ID scans are read by the existing OCR engine and returned as **suggestions** the
employee can edit. Nothing reaches the profile, the login account, or the document archive until HR decides
each item.

- Backend: models `ProfileChangeRequest` and `ProfileChangeAttachment` (`Backend/employees/models.py`),
  service `Backend/employees/services/profile_change_requests.py`, views `MyProfileChangeRequestViewSet` and
  `ProfileChangeRequestReviewViewSet` (`Backend/employees/views.py`), OCR task
  `employees.tasks.extract_profile_change_attachment`, cleanup task
  `employees.tasks.cleanup_unattached_profile_change_attachments`, tests
  `Backend/employees/test_profile_change_requests.py`.
- Workflow key `employee_profile_change`: one `hr` stage, history recorded as each action happens.
- Mounted under both `/api/` and the root (like every `employees` route). Ids are numeric; trailing slashes are
  optional.

## Envelope, pagination, errors

Success: `{"status": "success", "message"?: str, "data": ...}`.

Lists use `StandardPagination` (`?page=`, `?page_size=`):
`{"status": "success", "data": {"items": [...], "page": 1, "page_size": 25, "count": 3, "total_pages": 1}}`.

Validation errors are HTTP 422 with `errors: [{"field": "<key>", "message": "..."}]`. Error `field` keys:

| Key | When |
|---|---|
| a whitelist field key (`email`, `passport_no`, ...) | that item's value is invalid, empty, or (for `email`) already used by another account |
| any other key sent inside `items` (for example `hire_date`, `passport_file`) | not changeable by the employee |
| any unknown top-level body key | not accepted |
| `items` | not an object, or nothing changed (no changed value and no attachment) |
| `attachment_ids` | not a list of ids, unknown / foreign / already-used attachment, or two attachments of the same type |
| `document_type`, `file` | attachment upload validation |
| `status` | unknown `?status=` filter |
| `decisions` | decide body malformed, an item left undecided, a field decided twice, or a field not in the request |
| `decisions.<field>` | that decision is invalid (`decision` not `approve`/`reject`, or reject without `note`); for `decisions.email` also "this email is now used by another account" at approval time |
| `non_field_errors` | refused transition (already pending, no longer pending, company changed, stored file missing) |

403: not allowed (HR routes for non-HR, self-decision, no active employee profile, wrong active company).
404: not found or not yours / not in your active company.

## Field keys (the whitelist)

All item values are strings. Dates are ISO `YYYY-MM-DD`.

| Key | Applied on approval to | Server validation |
|---|---|---|
| `full_name` | `EmployeeProfile.full_name` and `full_name_en` (`full_name_ar` untouched) | 2-255 chars after trimming; inner whitespace collapsed |
| `date_of_birth` | `date_of_birth`; clears `date_of_birth_raw` | ISO date, not in the future |
| `nationality` | `nationality` and `nationality_en` (`nationality_ar` untouched) | 2-100 chars |
| `email` | the login account `User.email` | valid email, max 254; case-insensitive unique among accounts (checked at submit and again under lock at approval) |
| `mobile` | `mobile` | optional leading `+`, then 7-20 digits; spaces, `-`, `(`, `)` allowed |
| `passport_no` | `passport_no` | uppercased, spaces removed, 5-20 letters/digits |
| `passport_issue_date` | `passport_issue_date` (new column) | ISO date, not in the future |
| `passport_expiry` | `passport_expiry`; clears `passport_expiry_raw` | ISO date |
| `national_id` | `national_id` | exactly 10 digits |
| `id_expiry` | `id_expiry`; clears `id_expiry_raw` | ISO date |
| `passport_file` | a new `EmployeeDocument` (`PASSPORT`) from the attachment; OCR queued after commit | derived from `attachment_ids` only |
| `national_id_file` | a new `EmployeeDocument` (`SAUDI_ID`) from the attachment; OCR queued after commit | derived from `attachment_ids` only |

A value equal to the current profile value (after normalization; `email` compared case-insensitively) is
dropped silently. A blank value for a field that currently has a value is 422 (fields cannot be cleared).
`EmployeeProfile.passport_issue_date` is also exposed on the profile read serializer (`GET /api/employees/me/`
and HR employee reads).

## Attachment object (OCR preview)

```json
{
  "id": 7,
  "document_type": "PASSPORT",
  "original_filename": "passport.pdf",
  "extraction_status": "success",
  "suggested": {"passport_no": "X12345678", "passport_expiry": "2030-01-01"},
  "warnings": [],
  "confidence": 0.93
}
```

- `document_type`: `PASSPORT` or `SAUDI_ID` (national ID).
- `extraction_status`: the `EmployeeDocument.ExtractionStatus` values: `pending` (queued or running),
  `success`, `partial` (read, but not every check passed or confidence below the threshold; verify every field),
  `failed` (see `warnings`). Terminal: `success`, `partial`, `failed`. `not_applicable` is never returned
  (both document types are OCR types).
- `suggested`: only whitelist keys whose OCR value differs from the current profile value; empty while
  `pending` or `failed`. Mapping: passport `passport_number -> passport_no`, `full_name`, `nationality`,
  `date_of_birth`, `issue_date -> passport_issue_date`, `expiry_date -> passport_expiry`; national ID
  `iqama_number -> national_id`, `iqama_expiry_date -> id_expiry`. Dates are normalized to ISO; unreadable
  dates are left out.
- `warnings`: OCR/parser warnings (strings). `confidence`: overall OCR confidence 0-1, or `null`.
- The OCR raw text is never returned.

## Request object

```json
{
  "id": 12,
  "employee": {"id": 34, "full_name": "Sara Ali", "employee_number": "1002"},
  "status": "PENDING_HR",
  "items": [
    {"field": "email", "old": "sara@old.example", "new": "sara@new.example", "source": "manual", "decision": "pending", "note": ""},
    {"field": "passport_no", "old": "A1234567", "new": "X12345678", "source": "ocr", "decision": "pending", "note": ""},
    {"field": "passport_file", "old": null, "new": "passport.pdf", "source": "manual", "decision": "pending", "note": ""}
  ],
  "attachments": [{"id": 7, "document_type": "PASSPORT", "original_filename": "passport.pdf", "field": "passport_file"}],
  "decision_note": "",
  "submitted_at": "2026-09-30T10:00:00+03:00",
  "decided_at": null,
  "decided_by_name": "",
  "workflow": {"status": "in_review", "current_stage": "hr", "can_approve": false, "can_reject": false, "can_cancel": true, "history": []},
  "can_act": false
}
```

- `status`: `PENDING_HR`, `APPROVED` (every item approved), `PARTIALLY_APPROVED` (mixed), `REJECTED` (every
  item rejected), `CANCELLED`.
- `items[].old`: the profile value frozen at submit (`null` when it was empty); for file items always `null`.
  `items[].new`: the requested value; for file items the attachment's original filename.
- `items[].source`: `ocr` when the submitted value equals the attachment's OCR suggestion for that field,
  otherwise `manual`. `label_key` is not sent; the frontend maps `field` to its own label.
- `items[].decision`: `pending`, `approved`, `rejected`. `items[].note`: the HR reason (required on reject).
- `decision_note`: the optional overall HR note from the decide body.
- `decided_at` / `decided_by_name`: set on decide **and cancel** (then the employee is the decider).
- `workflow`: shared workflow snapshot for the request user. The engine records `APPROVE` for
  `APPROVED`/`PARTIALLY_APPROVED` and `REJECT` for `REJECTED`. `can_approve`/`can_reject` equal `can_act`;
  `can_cancel` is true only for the owner while `PENDING_HR`.
- `can_act`: the caller may decide now (HR approver, not the requester, status `PENDING_HR`).

## Employee routes

Caller must have a non-archived employee profile whose company is the active company (else 403).

| Method and path | Body | Result |
|---|---|---|
| `POST /api/employees/me/profile-change-requests/attachments/` | multipart `document_type` (`PASSPORT`/`SAUDI_ID`), `file` (PDF/JPG/PNG; extension + content type + magic bytes; `MAX_EMPLOYEE_DOCUMENT_SIZE_BYTES`) | 201 attachment object (`extraction_status` `pending`); OCR queued after commit. At most 10 unused uploads per employee at a time (422 `file`). |
| `GET /api/employees/me/profile-change-requests/attachments/{id}/` | | 200 attachment object; poll until terminal. Owner only (404). |
| `POST /api/employees/me/profile-change-requests/` | JSON `{"items": {"<field>": "<value>"}, "attachment_ids": [7]}` | 201 request object. `items` may be empty/omitted when an attachment is sent. Attachments must be the caller's, unused, and at most one per document type. One `PENDING_HR` request per employee (422 `non_field_errors`). |
| `GET /api/employees/me/profile-change-requests/?status=` | | paginated list of the caller's own requests, newest first |
| `POST /api/employees/me/profile-change-requests/{id}/cancel/` | none | 200 request object; only while `PENDING_HR` (else 422) |
| `GET /api/employees/me/profile-change-requests/{id}/attachments/{attachment_id}/file/` | | file download (owner only; the attachment must belong to that request) |

There is no employee `GET .../me/profile-change-requests/{id}/`; the employee list returns full objects.

## HR routes

HRManager / SystemAdmin group or an active HR workflow delegate (else 403). Strictly the active company (other
companies' requests are 404).

| Method and path | Body | Result |
|---|---|---|
| `GET /api/employees/profile-change-requests/?status=` | `status` one of `PENDING_HR`, `APPROVED`, `PARTIALLY_APPROVED`, `REJECTED`, `CANCELLED` (all when omitted) | paginated list |
| `GET /api/employees/profile-change-requests/{id}/` | | request object |
| `POST /api/employees/profile-change-requests/{id}/decide/` | `{"decisions": [{"field": "email", "decision": "approve"}, {"field": "passport_no", "decision": "reject", "note": "Number does not match the scan"}], "note"?: str}` | 200 request object |
| `GET /api/employees/profile-change-requests/{id}/attachments/{attachment_id}/file/` | | file download |

Decide rules: every item decided exactly once (422 `decisions`); `note` required on reject (422
`decisions.<field>`); the requester can never decide (403); an already decided request is 422. Approved
items are applied in one transaction; rejected items are not applied. If an approved email is now taken by
another account the whole decision is refused (422 `decisions.email`) and nothing is applied.

File downloads: `application/octet-stream` attachment, `X-Content-Type-Options: nosniff`,
`Cache-Control: private, no-store`, audited.

## Inbox, notifications, audit

- Shared pending inbox (`GET /api/core/pending-requests/`): `request_type` `EMPLOYEE_PROFILE_CHANGE`,
  `request_type_label` "Profile Change" / "تحديث البيانات", `review_path` `/hr/employees/profile-change-requests`.
- On submit, HR approvers of the company (never the requester) get an `approval.pending` notification (request
  type "Profile Change Request", deep link `/hr/employees/profile-change-requests`). On decision the employee
  gets a `request.status_changed` notification (deep link `/employee/profile`) listing approved and rejected
  field names; rejected items carry their reasons. Notifications run after commit; failures never undo a
  decision.
- Audit actions (ids, status and field **names** only; never values, OCR text, notes, or file contents):
  `employee_profile_change_submitted`, `_decided` (`approved_fields`, `rejected_fields`), `_cancelled`,
  `_attachment_uploaded`, `_file_downloaded`.
- Unused attachments older than 24 hours are deleted (file and row) by the hourly beat task
  `cleanup-unattached-profile-change-attachments`.
