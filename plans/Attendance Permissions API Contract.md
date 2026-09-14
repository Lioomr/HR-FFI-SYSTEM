# Attendance Permissions API Contract

This document is the attendance-permissions contract. The **Final attendance
policy API contract** section is authoritative for the today summary, HR
recalculation, violation history, violation lifecycle, and attendance payroll
deductions. It supersedes the earlier proposed Agent 1 endpoint sections and the
first Agent 3 enforcement summary, both of which have been removed.

## Global policy settings

Existing `GET /settings` and `PUT /settings` retain the `attendance` object and add
these global fields:

```json
{
  "default_shift_end_time": "18:00",
  "grace_window_minutes": 15,
  "grace_use_limit_per_month": 3,
  "post_grace_tolerance_minutes": 5,
  "approved_late_permission_limit_per_month": 3,
  "during_shift_permission_max_minutes": 120,
  "permission_request_advance_limit_days": 7
}
```

`grace_window_minutes` is canonical. `late_grace_minutes` remains a supported
legacy request/response alias: callers may send either field, but if both are
sent they must match, and responses always return both synchronized. Existing
legacy schedule code also reads the canonical value. The migration initializes
the canonical value from the previous `late_grace_minutes` value.

System Admin may update the existing full settings payload. HR Manager and
System Admin may update attendance policy through the existing endpoint with an
attendance-only body, for example:

```json
{"attendance": {"grace_window_minutes": 15}}
```

HR Manager cannot update password, session, security, or invite settings. The
policy is a global singleton, so `x-active-company-id` does not create or select
a company-specific policy. Setting updates are audited as `settings_updated`.

## Final attendance policy API contract

### Common rules

- Attendance routes use the `/api/` prefix. Payroll routes keep the existing
  unprefixed `/payroll-runs/` module prefix.
- Every endpoint requires authentication (`401` otherwise).
- Success envelope: `{"status": "success", "data": ...}`.
- Error envelopes:
  - Permission/company-context failure `403`:
    `{"status": "error", "message": "<reason>", "detail": "<reason>"}`.
  - Not found `404`: `{"status": "error", "message": "Not found."}` (view
    lookups) or `"Not found"` (router detail lookups). Clients must branch on
    the status code, not the message text.
  - Validation `422`:
    `{"status": "error", "message": "<first error>", "errors": [{"field": "...", "message": "..."}]}`.
    Nested serializer errors use dotted field paths. For example, an
    out-of-range attendance-only settings update returns
    `{"field": "attendance.grace_window_minutes", "message": "Ensure this value is less than or equal to 240."}`.
- **Active company.** Clients must send `X-Active-Company-Id: <company id>` (or
  the matching `company_id` query parameter; if both are sent they must match).
  The server resolves it with the repository organization helpers:
  - A company the caller cannot access returns `403` "You do not have access to
    the requested company."
  - A head-office context returns `403` "Select an active company for this
    request." (HR recalculation: "Select an active company to perform write
    actions.")
  - If no selector is sent, the caller's default accessible company is used;
    clients should not rely on this.
  - Every object outside the selected company is a `404`, identical to an
    unknown id, so another company's data is never disclosed.
- An `EmployeeProfile` belongs to exactly one user and one company. A user
  granted several companies therefore sees their own attendance only while their
  profile's company is selected.
- Decimal values are strings (`"5.00"`); `penalty_percent` is a fraction with
  four decimals (`"0.0500"` is 5%). Times are ISO-8601 with offsets, or `null`.
- Raw BioTime payloads and punch rows are never exposed.

### Daily result object

Returned by the today summary and HR recalculation:

```json
{
  "date": "2026-09-13",
  "shift": {"start_at": "2026-09-13T09:00:00+03:00", "end_at": "2026-09-13T18:00:00+03:00", "scheduled_minutes": 540},
  "shift_start_at": "2026-09-13T09:00:00+03:00",
  "shift_end_at": "2026-09-13T18:00:00+03:00",
  "scheduled_minutes": 540,
  "first_check_in_at": "2026-09-13T09:30:00+03:00",
  "final_check_out_at": "2026-09-13T18:00:00+03:00",
  "physical_work_minutes": 510,
  "unpaid_break_minutes": 0,
  "approved_permission_minutes": 0,
  "accounted_attendance_minutes": 510,
  "missing_minutes": 30,
  "status_input": "LATE",
  "is_attendance_exempt": false,
  "grace": {"consumed": false, "reason": "outside_grace"},
  "violation": { "...": "violation object, or null" }
}
```

`status_input` is `PRESENT` or `LATE` after policy enforcement.
`grace.reason` is one of:

| Reason | Meaning |
| --- | --- |
| `attendance_exempt` | Explicit or CEO exemption; never late, no grace use. |
| `late_permission` | A final-approved Late Permission marker excuses the day; no grace use. |
| `no_check_in` | No check-in evidence for the day (absence is handled separately). |
| `on_time` | Check-in at or before shift start. |
| `monthly_grace` | Within the grace window and a monthly grace use remains; consumes one use. |
| `outside_grace` | After the grace window while grace uses remain; late. |
| `post_grace_tolerance` | Grace exhausted, arrival within `post_grace_tolerance_minutes`; not late. |
| `post_grace_late` | Grace exhausted, arrival from tolerance + 1 minute (09:06 for a 09:00 shift); late. |

`grace.reason` may be `null` only for a result calculated before policy
enforcement existed; the next recalculation fills it.

### Violation object

```json
{
  "id": 41,
  "employee_profile_id": 123,
  "employee_code": "FFI-000123",
  "employee_name": "Jane Doe",
  "employee_name_en": "Jane Doe",
  "employee_name_ar": null,
  "date": "2026-09-13",
  "occurrence_number": 2,
  "daily_rate": "100.00",
  "penalty_percent": "0.0500",
  "penalty_amount": "5.00",
  "lifecycle": "active",
  "reason": "outside_grace",
  "void_reason": "",
  "payroll_status": "pending",
  "created_at": "2026-09-13T09:31:02+03:00",
  "updated_at": "2026-09-13T09:31:02+03:00"
}
```

### `GET /api/attendance/me/today-summary/`

- **Permission:** any authenticated user whose non-archived employee profile
  belongs to the selected active company and has an active BioTime mapping.
- **Response `200`:** `{"status": "success", "data": <daily result object>}`
  for today. If today has no result yet, it is calculated from raw punches and
  month policy before responding.
- **Errors:**
  - `404` when the user has no profile, or the selected company is not the
    profile's company.
  - `403` for a head-office context or an inaccessible company selector.
  - `403` with message "Attendance is unavailable until your BioTime mapping is
    completed. Contact HR to be registered on a BioTime device." when the
    profile has no active BioTime mapping. This is the same response as
    `GET /api/attendance/me/`, and nothing is calculated. The company check runs
    first, so a wrong company is still a `404`.

### `POST /api/attendance/hr/recalculate/`

- **Permission:** HR Manager or System Admin (`403` otherwise), with a selected
  active company (`403` for head office or an inaccessible company).
- **Request:** `{"employee_profile_id": 123, "date": "2026-09-13"}` or
  `{"employee_profile_id": 123, "date_from": "2026-09-01", "date_to": "2026-09-13"}`.
  The range is inclusive, and `date_to - date_from` must be 0 to 31 days.
- **Response `200`:**
  `{"status": "success", "data": {"results": [<daily result object>, ...]}}`,
  one per date in order.
- **Behavior:** under the employee row lock, the endpoint rebuilds normalized
  events from immutable raw punches, recalculates each day, and reconciles the
  month policy. It is idempotent and never edits raw punches or legacy
  `AttendanceRecord` rows. Audited as `attendance_policy_recalculated`.
- **Errors:**
  - `422` for a missing/invalid `employee_profile_id`, invalid dates, or a
    reversed or over-31-day range.
  - `404` for an unknown, archived, or other-company profile. Nothing is
    calculated.
  - `422` with
    `errors: [{"field": "employee_profile_id", "message": "This employee has no active BioTime mapping."}]`
    for an in-company profile without an active BioTime mapping. Nothing is
    calculated. The company check runs first, so an other-company profile is
    still a `404`.

### `GET /api/attendance/violations/` and `GET /api/attendance/violations/{id}/`

- **Permission:** HR Manager and System Admin see every violation in the
  selected company. Every other role sees only their own violations in the
  selected company.
- **List `200`:**
  `{"status": "success", "data": {"items": [<violation object>], "page": 1, "page_size": 25, "count": 1, "total_pages": 1}}`,
  newest date first. Supports the standard `page` and `page_size` parameters
  (default page size 25).
- **List filters:** all optional and combinable. They only narrow the role and
  company scope above; an employee filtering by another employee's id gets an
  empty list.

  | Parameter | Format | Matches |
  | --- | --- | --- |
  | `lifecycle` | Comma-separated `active`, `void`, `applied`, `manual_review` | Any listed lifecycle |
  | `payroll_status` | Comma-separated `pending`, `claimed`, `applied`, `manual_review`, `void` | Any listed deduction status |
  | `employee_profile_id` | Positive integer | That employee |
  | `date_from`, `date_to` | `YYYY-MM-DD`, inclusive | Violation date range |
  | `search` | Text | Case-insensitive match on employee name (default, English, Arabic) or employee code |

- **Detail `200`:** `{"status": "success", "data": <violation object>}`.
- **Errors:**
  - Detail `404` for another company's or, for non-HR roles, another employee's
    violation.
  - `403` for a head-office context or an inaccessible company selector.
  - `422` field errors for an unknown or empty `lifecycle`/`payroll_status`
    value, a non-integer `employee_profile_id`, a malformed date, or
    `date_to` before `date_from`.

### Violation lifecycle and lifetime sequencing

| `lifecycle` | Meaning | Counts toward later occurrences |
| --- | --- | --- |
| `active` | Recorded and not locked in payroll. A monetary penalty may be provisionally claimed by a DRAFT run. A first-occurrence warning is never claimed and stays `active` until voided. Re-rated automatically when earlier history changes. | Yes |
| `void` | Invalidated before any payroll lock (corrected punches, Late Permission, exemption). Never charged; reactivated if the day becomes late again. | No |
| `applied` | Charged in a COMPLETED/PAID payroll run. Occurrence, rate, and amount are a permanent snapshot. | Yes |
| `manual_review` | A monetary penalty that was `applied`, then invalidated (for example a Late Permission approved afterwards). Snapshot preserved; never reactivated or credited automatically; HR resolves it outside this API. An excused warning is never `manual_review`; it becomes `void`. | Yes |

- Occurrence numbers are lifetime-based, not monthly.
- Penalty by occurrence: occurrence 1 is a warning only, with no payroll
  deduction. 2 is 5%, 3 is 10%, and 4 or more is 50% of the daily rate.
- The daily rate is the monthly total salary divided by 30, snapshotted when the
  violation is recorded or reactivated.
- Reconciliation processes a month in date order, then renumbers later `active`
  violations, so delayed punch ingestion stays deterministic.
- `void_reason` holds the grace reason that invalidated a `void` or
  `manual_review` violation.

### Attendance payroll deductions

Only monetary penalties (occurrence 2 onward) have a deduction, one per
violation. A warning, or a violation renumbered down to a warning, has none, and
its `payroll_status` is `null`. For a monetary penalty, `payroll_status` is:

| `payroll_status` | Meaning |
| --- | --- |
| `pending` | Due but not yet claimed. |
| `claimed` | Included in a DRAFT run. |
| `applied` | Locked in a COMPLETED/PAID run. |
| `manual_review` | Applied, then invalidated. |
| `void` | Invalidated before a lock. |

- **Draft creation** (`POST /payroll-runs/`) claims every pending deduction whose
  intended period is on or before the run period, for employees included in
  that run.
- **Finalization** (`POST /payroll-runs/{id}/finalize/`) does the following in
  one transaction, under the run, employee, and deduction row locks:
  - Claims deductions that became pending after draft creation.
  - Applies amount changes to claims it holds.
  - Releases voided claims.
  - Marks every remaining claim and its violation `applied` and completes the
    run.
- Run item, payslip, and run totals change by exactly the difference from the
  previously included amount, so repeated syncs and repeated finalize calls
  never double-count. A second finalize returns
  `{"message": "Payroll run already finalized."}` without changes.
- A draft's displayed totals reflect penalty changes made after creation only
  once it is finalized.
- COMPLETED and PAID runs, their items, and their payslips are never modified.
- A penalty discovered for an already locked period stays `pending` and is
  claimed by the next eligible draft.
- An `applied` deduction later invalidated becomes `manual_review`. Locked
  totals are unchanged and no automatic credit is created.

## Backend Agent 1 report

The global settings fields described above are implemented in the existing
`SystemSettings` model and settings serializer. At Agent 1 delivery the two
attendance endpoints were proposed only; they are now specified by the final
contract above. Their source data is `AttendanceDailyResult`; they scope it
through the employee's company and expose no raw provider payload.

### Correction report

The grace alias/deprecation contract and attendance-only HR Manager
authorization are implemented and covered by focused regression tests. The
configured PostgreSQL test command could not run locally because
`localhost:5432` has no password; the SQLite fallback is blocked by the
pre-existing `employees.0015_database_tenant_integrity` migration near `DO`.
The database-backed tests are therefore unverified locally. The Agent 2
contract is ready; this document does not initiate a handoff.

## Backend Agent 2 implementation contract

`/api/permission-requests/` remains the backward-compatible Exit Permission
resource. Every response retains the standard envelope and adds
`permission_type`, `attachments`, `attachment_count`, and, for Late Permission,
`monthly_late_permission_usage` and `monthly_late_permission_limit`.

### Create payloads

Legacy payloads without `permission_type` are Exit Permissions and keep the
existing same-day-only fields and behavior:

```json
{
  "request_date": "2026-09-13",
  "from_time": "10:00",
  "to_time": "11:00",
  "exit_type": "personal",
  "reason": "Appointment"
}
```

`Late Permission` uses `permission_type: "late"`, `request_date`, `reason`, and
at least one `attachments` multipart file. Times, duration, and `exit_type` are
rejected. `During Shift Permission` uses `permission_type: "during_shift"`,
`request_date`, `from_time`, `to_time`, and `reason`; evidence is optional.
Late and During Shift dates are today through the global
`permission_request_advance_limit_days` (initially seven). Exit remains today
only. Late evidence accepts PDF, JPEG, PNG, WebP, HEIC, or HEIF up to 10 MB;
clients may send an aligned `attachment_metadata` list for camera capture data.
Each entry must be a JSON object; multipart clients send one JSON-text part per
file. An invalid entry returns 422 on `attachment_metadata`, and attachment
`capture_metadata` is always returned as an object.

Active Exit/During Shift requests cannot overlap. Late may coexist with either;
non-overlapping Exit/During Shift requests may coexist. A conflict returns 422
with a `from_time` error. Late returns 422 for attendance-exempt or CEO users,
date-window violations, missing evidence, and an exhausted final-approved
monthly allowance.

### Private evidence

`POST /api/permission-requests/{id}/attachments/` appends multipart evidence
while the owner request is pending. `GET
/api/permission-requests/{id}/attachments/{attachment_id}/download/` is
authenticated, forced-download only, and returns `Cache-Control: private,
no-store` and `X-Content-Type-Options: nosniff`. Attachment objects expose no
storage URL, only this route. The owner plus company-scoped current or recorded
historical approvers who can view the parent request can download; guessed,
cross-company, and unauthorized identifiers return 404 without file data.

### Approval and attendance integration

The existing Direct Manager → HR flow, delegation behavior, self-approval ban,
and Exit PDF route are unchanged. Submission, attachment add, cancellation,
manager/HR decision, final approval, and attachment download are audited. The
existing in-app/email/WhatsApp notification helpers and attendance recalculation
are registered via `transaction.on_commit` and failures do not roll back an
approval.

On final approval an idempotent `AttendanceAdjustment` is upserted by adjustment
kind plus permission-request source key. During Shift contributes approved
interval minutes; Late is a durable zero-minute arrival-excusal marker without a
physical-punch claim. Final enforcement applies that marker against the current
normalized check-in. Only During Shift intervals are unioned, shift-clamped, and
discounted for overlapping physical work. Exit stores source metadata with zero
contributed minutes so its legacy policy behavior remains unchanged. Raw BioTime
evidence is never modified.

### Late-attendance notices (fixed frontend contract)

This section replaces the earlier `GET /api/attendance/violations/{id}/notice/`
route, which has been removed. Route and field names below are fixed for the
frontend; rename them only together with a coordination-note update.

#### Issuance

- The policy issues exactly one `AttendanceLateNotice` when it creates a new
  active late violation. Recalculation reuses the notice; it never renders a
  second PDF, sends a second notification, or writes a second audit event.
- Level by lifetime occurrence:

  | Occurrence | `notice_level` | Approved template pair (version 3, active) | Policy |
  | --- | --- | --- | --- |
  | 1 | 1 | `late_attendance_level_1_blank_v3.pdf` + `late_attendance_level_1_field_map_v3.json` | Warning only, no payroll deduction |
  | 2 | 2 | `late_attendance_level_2_blank_v3.pdf` + `late_attendance_level_2_field_map_v3.json` | 5% daily-rate deduction |
  | 3 | 3 | `late_attendance_level_3_blank_v3.pdf` + `late_attendance_level_3_field_map_v3.json` | 10% daily-rate deduction |
  | 4 and every later | 4 | `late_attendance_level_4_blank_v3.pdf` + `late_attendance_level_4_field_map_v3.json` | 50% daily-rate deduction |

  Occurrences 4 and 5 therefore each receive their own level-4 notice.
- Never issued for:
  - legacy `AttendanceRecord` rows
  - violations that predate this workflow (no backfill)
  - voided violations
  - attendance-exempt employees
  - Late Permission-excused days, which produce no violation
- The notice stores policy snapshots taken at issuance: occurrence, level,
  penalty, template name, and template version. It never changes raw BioTime
  punches or payroll totals.
- **Template versions.** Version 3 is the active version.
  - Only genuinely new active late violations get a PDF, rendered on the
    approved version 3 pairs. The notice stores `template_name` (the actual
    `_v3` filename) and `template_version = 3`.
  - The loader requires map `version: 3`, `asset_revision: 3`, and a matching
    template name and level.
  - Versions 1 and 2 are retained historical versions. Notices already issued on
    them keep their stored PDF, snapshot, notification, and delivery status.
    They are never re-rendered, replaced, backfilled, or redelivered, and their
    pairs stay deployed unchanged.
  - v3's logo area is a neutral, opaque `#F8FAFC` surface with no visible or
    extractable `Company logo` or `شعار الشركة` text.
- The PDF is rendered only through the map-driven overlay (`core.pdf_forms`).
  It fills only the version 2 map's declared fields, from real system data:

  | Field | Value |
  | --- | --- |
  | `company_name` | `OrganizationNode.name` |
  | `company_name_ar` | `OrganizationNode.name` (fallback: no authoritative Arabic company name exists) |
  | `notice_reference`, `issue_timestamp` | Notice reference; local issue time `YYYY-MM-DD HH:MM` |
  | `employee_name`, `employee_code`, `department`, `position` | Employee profile |
  | `violation_date`, `scheduled_shift_start`, `actual_first_check_in`, `minutes_late` | Calculated daily result |
  | `occurrence_number` | Lifetime occurrence snapshot |
  | `penalty_percentage` | `0%`, `5%`, `10%`, `50%` from the penalty snapshot |
  | `policy_result` | Level copy identical to the template: `Warning only - no payroll deduction.`, `Formal caution - 5% daily-rate deduction.`, `Serious warning - 10% daily-rate deduction.`, `Critical final warning - 50% daily-rate deduction.` |
  | `penalty_amount` | `SAR 0.00` for level 1; the actual snapshot amount otherwise (for example `SAR 42.50`) |
  | `reason` | Human-readable text for the policy's classification (`outside_grace`, `post_grace_late`); never the internal code |
  | `company_phone`, `company_address`, `company_website`, `company_email` | Empty: no authoritative company contact data exists |

  Values are drawn with the backend's Arabic-capable fonts.
- **Company logo.** The configured `OrganizationNode.logo` is read from private
  storage in memory and drawn into the map's `company_logo` image slot.
  - Transparent and opaque PNG/JPEG logos both render on the neutral v3 slot.
  - A missing, unreadable, non-PNG/JPEG, or oversized (over 2 MB) logo leaves
    the plain approved slot and never blocks the notice or attendance.
  - The outcome is recorded only as a safe value.
- **HR signature.** `hr_signature_image` is manual-only (`auto_sign: false`). It
  is never passed to the renderer and always stays blank.
- **Delivery.** Each notice creates an in-app notification (event
  `attendance.late_notice`, `action_url` `/employee/attendance`) using the
  bilingual catalog text of its level, plus the existing configured
  WhatsApp/email delivery. WhatsApp uses the dedicated
  `late_attendance_notice_v1` template (Arabic first, English second, FFI HR
  footer). Its variables, in order, are `employee_name`, `notice_level`,
  `notice_level_ar`, `violation_date`, `occurrence_number`,
  `reference_number`, `policy_result`, `policy_result_ar`, and `action_url`.
  The private PDF is uploaded directly as the WhatsApp document
  (`{"attendance_late_notice_id": <id>}`); no PDF URL is sent. A rendering or
  delivery failure never blocks attendance calculation.
- **Audit events** (no storage paths, URLs, tokens, or punch payloads):
  - `attendance_late_notice_generated` (includes `template_version` and
    `company_logo_state`: `placed`, `not_configured`, `unreadable`,
    `oversized`, `invalid`, or `unplaceable`)
  - `attendance_late_notice_delivery_scheduled`
  - `attendance_late_notice_delivery_failed`
  - `attendance_late_notice_delivery_skipped`
  - `attendance_late_notice_generation_failed`
  - `attendance_late_notice_downloaded`

#### `GET /api/attendance/notices/`

- **Permission:** Employee (and any non-HR role) sees their own notices only.
  HR Manager and System Admin see notices for the selected active company only.
  The common active-company rules apply: head office and inaccessible companies
  return `403`.
- **Response `200`:**
  `{"status": "success", "data": {"items": [<notice>], "count": 1, "page": 1, "page_size": 25, "total_pages": 1}}`,
  newest first.
- **Optional filters.** These are validated, return `422` field errors when
  invalid, and never widen scope:
  - `notice_level`: comma-separated `1`-`4`
  - `employee_profile_id`
  - `date_from` / `date_to`: inclusive `YYYY-MM-DD` on the violation date
  - `search`: employee name or code

#### `GET /api/attendance/notices/{id}/`

- **Response `200`:** `{"status": "success", "data": <notice>}`.
- **Errors:** `404` for another company's notice or, for non-HR roles, another
  employee's notice.

#### `GET /api/attendance/notices/{id}/download/`

- **Response `200`:** an authorization-checked `FileResponse` streaming the
  private PDF.
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="<filename>"`
  - `Cache-Control: private, no-store`
  - `X-Content-Type-Options: nosniff`
- The scope rules match the detail endpoint. There is no public media URL.
  Every download is audited.

#### Notice object

```json
{
  "id": 7,
  "violation_id": 41,
  "employee_profile_id": 123,
  "employee_name": "Jane Doe",
  "employee_code": "FFI-000123",
  "violation_date": "2026-09-14",
  "occurrence_number": 2,
  "notice_level": 2,
  "reference_number": "LAN-FFI-000041",
  "issued_at": "2026-09-14T09:35:12+03:00",
  "delivery_status": "scheduled",
  "delivery_message": "In-app notification created; external delivery is scheduled.",
  "filename": "late_attendance_notice_LAN-FFI-000041.pdf"
}
```

- Exactly these fields are returned. No storage path, signed URL, raw-punch
  payload, or cross-company data is ever exposed.
- `delivery_status` reflects the in-app notification and configured external
  channels:

  | Value | Meaning |
  | --- | --- |
  | `scheduled` | In-app notification created; external delivery pending |
  | `sent` | Delivered through a configured external channel |
  | `failed` | The in-app notification could not be created, or external delivery failed |
  | `skipped` | No active user account, or no configured external channel |

- `delivery_message` is a human-readable explanation of that status.
- `filename` is `null` only if no document is stored.
