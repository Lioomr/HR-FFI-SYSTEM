# Document Signing API Handoff (tamper-evident approved documents)

Status: implemented for **Leave requests** (2026-10-07) and **Loan requests**
(2026-10-08), backend. Other request types: see "Rollout inventory".
Code: `Backend/core/document_integrity/` (shared HTTP plumbing in `api.py`),
`Backend/leaves/document_integrity.py`, `Backend/loans/document_integrity.py`.

## What changed

* Approved leave and loan PDFs no longer change after approval. At the **last**
  approval stage the form is rendered once (with a hidden `/FFIDocumentRef`
  metadata tag), stored privately, and SHA-256 hashed. Downloads serve that
  stored copy. In-progress requests still render live. The *Approval Trail*
  page (who approved, role, DB timestamp) is **not** part of the stored file: HR
  gets it on demand as a work paper (`?workpaper=1&tz=<IANA zone>`, see
  endpoint 1).
* Signature fallback (all mapped forms using `signer_signatures`: leave, loan,
  exit permission, annual entitlements, job offer, starting work): a recorded
  signer **without a signature image** gets their **profile name** printed in
  the signature box. A stage nobody completed stays blank. Never the downloading
  user; never an email address. (Contract ratings call `signature_for_user`
  directly and are unchanged.)
* Depending on `DOCUMENT_SIGNING_MODE` the frozen PDF is also sealed with an
  organization certificate (PAdES, RFC 3161 timestamp) and/or signed by each
  approver with a personal certificate from an internal CA.
* Requests approved before this release are **not backfilled**: they report
  `not_frozen` and keep rendering live.

## Modes (`DOCUMENT_SIGNING_MODE`)

| Mode | Behaviour |
|---|---|
| `off` | Legacy: render on every download, nothing stored. |
| `freeze` (**default**) | Freeze + SHA-256 + audit events. No certificates. |
| `seal` | Freeze, then one organization seal (PAdES-B-T when a TSA is set; B-B if `DOCUMENT_SIGNING_TSA_URL=""`). |
| `personal` | As `seal`, plus one incremental PAdES signature per approver (stage order), seal last. |

Default is `freeze` because seal/personal need key material and an outbound
TSA call; the dev environment is configurable in one line (see "Dev setup").

---

## API contract (verified against the Django router)

The requested `/api/leaves/<id>/...` paths do not exist in this project: leave
requests live under `/api/leaves/leave-requests/<id>/`. Final paths:

### 1. Download — unchanged path
```
GET /api/leaves/leave-requests/{id}/pdf/            (also manager/ and ceo/ variants, unchanged)
Auth: JWT; owner, alternative employee, HR/SystemAdmin (unchanged IsOwnerOrHR)
200  application/octet-stream  — frozen/sealed file when it exists, else live render
409  {"status":"error","message":"Document unavailable",...}
     — a frozen copy exists but is missing or fails its hash; it is never served
       and never silently replaced by a live render
?packet=1 still appends the supporting document, but merging rewrites the file:
a packet is NOT the verifiable original (signatures/hash won't match).
?workpaper=1&tz=<IANA>  HRManager/SystemAdmin only, frozen documents only: the frozen
     form + an Approval Trail page with times in that zone (no UTC/offset suffix;
     unknown or missing tz = system timezone). Filename <name>_workpaper.pdf. Not the
     verifiable original, never stored. Anyone else gets the plain frozen copy.
```
Side effects: `DocumentIntegrityEvent downloaded` + AuditLog `document_downloaded`
(only when a frozen copy is served); AuditLog `document_download_blocked` on 409.

### 1b. Loan endpoints (same payloads, same rules)

Loans live under `/api/loans/`; `LoanRequestViewSet` is mounted at two prefixes
(`loan-requests` and the compatibility alias `hr/loan-requests`), both with and
without a trailing slash. Every alias behaves identically:

```
GET  /api/loans/loan-requests/{id}/pdf/                   (alias /api/loans/hr/loan-requests/{id}/pdf/)
     Auth unchanged: owner or HRManager/SystemAdmin (IsLoanOwnerOrHR), company-scoped
     (same-company non-owner 403, other company 404). Frozen copy once disbursed;
     409 if altered/missing; ?workpaper=1&tz= for HR. Filename loan_request_{id}.pdf.
     AuditLog loan_request_exported_pdf on every 200 (as before), not on 409.
GET  /api/loans/loan-requests/{id}/integrity/             (alias /api/loans/hr/loan-requests/{id}/integrity/)
POST /api/loans/loan-requests/{id}/integrity/verify/      (alias .../hr/loan-requests/{id}/integrity/verify/)
POST /api/loans/loan-requests/{id}/integrity/retry-seal/  (alias .../hr/loan-requests/{id}/integrity/retry-seal/)
     Access: owner, recorded approvers (manager, HR recommender, CFO, CEO, disbursing
     accountant) or HRManager/SystemAdmin within accessible companies; 404 for anyone
     else; 401 unauthenticated; retry-seal HRManager/SystemAdmin only (403).
     Payloads identical to leave (IntegrityPayload below).
POST /api/documents/verify-upload/   ->  matched_record.type = "loan"
```
The loan PDF itself stays owner/HR-only (unchanged): CFO/CEO/manager/accountant can
read the integrity status of loans they decided but cannot download the PDF, exactly
as before. The integrity actions are not added to the manager/CFO/CEO/disbursement
loan viewsets (they have no `pdf` route either); the frontend should call the
`loan-requests` paths above for every viewer.

### 1c. Permission requests (incl. exit permission) — implemented 2026-10-08

Code: `Backend/permission_requests/document_integrity.py` (registered in
`PermissionRequestsConfig.ready()`), hooks in `permission_requests/services.py`,
routes on `PermissionRequestViewSet` (router `trailing_slash="/?"`: every path works
with and without the trailing slash). One model for all permission types
(exit / late / during shift); they share the same form and the same freeze.

```
GET  /api/permission-requests/{id}/pdf/                    unchanged path + auth (_get_visible: owner, the
     requester's manager scope / the deciding manager, HR approvers incl. HR delegates, company-scoped; 404 otherwise).
     Still Content-Type: application/pdf, filename permission_request_{reference_no}.pdf.
     Frozen copy once approved; 409 if altered/missing; ?workpaper=1&tz= for HRManager/SystemAdmin
     (permission_request_{reference_no}_workpaper.pdf). AuditLog permission_request_pdf_downloaded
     only on 200 (not on 409).
GET  /api/permission-requests/{id}/integrity/
POST /api/permission-requests/{id}/integrity/verify/
POST /api/permission-requests/{id}/integrity/retry-seal/   HRManager/SystemAdmin only (403), 422 when not sealing
     Access: owner, recorded approvers (manager_decision_by, hr_decision_by — also an HR
     delegate who decided) or HRManager/SystemAdmin within accessible companies; 404 for
     anyone else (incl. a manager who did not decide it); 401 unauthenticated.
POST /api/documents/verify-upload/   ->  matched_record.type = "permission"
```
Freeze point: the transition to `approved` — `services.apply_hr_decision` (approve), or
`services.apply_manager_decision` when it already ends at `approved` (an HR approver's
own request has no HR stage; an HR-manager manager covers HR). Frozen once even when the
manager covers HR (two attestations, one freeze). Rejections never freeze; only pending
requests can be cancelled, so an approved request never changes again.
Stage roles (in order): `employee` (created_at, "Submitted"), `line_manager`
(`manager_decision_by/_at`), `hr` (`hr_decision_by/_at`; same person and time as the
manager when covered). No new role keys. `DOCUMENT_TYPE = "permission_request"`
(AuditLog entity of `document_*`). Visible reference = native `reference_no`
(`PERM-<employee_id><seq>`), matched by verify-upload for metadata-stripped copies.

### 1d. Annual entitlements (annual-leave settlements) — implemented 2026-10-08

Code: `Backend/leaves/annual_document_integrity.py` (registered in `LeavesConfig.ready()`),
hooks in `leaves/annual_payment_services.py`, routes on `AnnualLeavePaymentRequestViewSet`
(DefaultRouter: trailing slash required).

```
GET  /api/leaves/annual-leave-payments/{id}/pdf/           unchanged path + auth (get_queryset: employee own;
     HR/SystemAdmin/CEO company-scoped). Still application/octet-stream, annual_entitlements_{id}.pdf.
     Frozen copy once the CEO approved it; 409 if altered/missing; ?workpaper=1&tz= for HR.
     AuditLog annual_leave_payment_exported_pdf only on 200.
GET  /api/leaves/annual-leave-payments/{id}/integrity/
POST /api/leaves/annual-leave-payments/{id}/integrity/verify/
POST /api/leaves/annual-leave-payments/{id}/integrity/retry-seal/   HRManager/SystemAdmin only (403)
     Access: the employee, recorded actors (submitted_by, hr_reviewed_by, ceo_decided_by) or
     HRManager/SystemAdmin within accessible companies; 404 for anyone else (incl. a CEO
     who did not decide it, although any CEO in the company may download the PDF).
POST /api/documents/verify-upload/   ->  matched_record.type = "annual_entitlement"
```
Freeze point: `leaves.annual_payment_services.apply_annual_payment_ceo_approval`, both
final statuses `approved` (pay) and `carried_forward`; after commit, so the frozen form
reflects `refresh_settlement_salary`. CEO rejection never freezes.
Stage roles: `employee` (applicant, `submitted_at`, "Submitted") **or** `hr_manual`
(label "HR (for employee)") when HR opened the settlement on the employee's behalf
(`submitted_by` != employee), then `hr` (`hr_reviewed_by/_at`, "Reviewed"; set at
creation when HR filed with a decision), then `ceo` (`ceo_decided_by/_at`; trail +
personal signature only — the form has no CEO box). No new role keys (`hr_manual`
reused from leave). `DOCUMENT_TYPE = "annual_leave_payment_request"`. Reference =
`public_reference_for` (`AED-<employee_id><seq>`) or the legacy `AED-{id:05d}`, as printed.
Caveats: `freeze_approved_document` accepts both `approved` and `carried_forward` (adapter
`final_statuses`, 2026-10-08); the form's applicant box
still prints the employee's signature image even when HR filed it (pre-existing form
behaviour; the trail/personal signature names the HR filer). There is no employee-facing
detail page for settlements (the dashboard links to the balance page).

### 2. Integrity status
```
GET /api/leaves/leave-requests/{id}/integrity/
Auth: JWT. Access: owner, alternative employee, recorded approvers
      (delegate / manager / HR reviewer / CEO / HR completion / manual-entry HR),
      or HRManager/SystemAdmin within accessible companies.
404 for anyone else (no existence leak). 401 unauthenticated.
200 {"status":"success","data": IntegrityPayload}
```
Re-hashes the stored file on every call; reuses the last pyHanko validation
(computed at seal time / last verify). No audit event.

```
IntegrityPayload = {
  "status": "not_frozen"|"frozen_valid"|"sealed_valid"|"signed_valid"
            |"tampered"|"missing_file"|"seal_pending"|"seal_failed",
  "frozen_at": iso8601|null,
  "sha256": string|null,          // hash of the bytes currently served
  "signing_mode": "off"|"freeze"|"seal"|"personal",  // mode the doc was frozen in (current mode if not frozen)
  "seal": {
    "present": bool, "valid": bool|null, "timestamped": bool,
    "timestamp": iso8601|null, "signer": string|null,
    "trust": "trusted"|"untrusted_root"|"unknown"
  },
  "signatures": [                 // personal signatures only (seal is in "seal")
    { "role": string,             // employee | alternative_employee | line_manager | hr | ceo | hr_completion | hr_manual
      "signer_name": string, "signed_at": iso8601|null, "valid": bool|null,
      "certificate_serial": string|null,
      "revoked": bool,            // ADDITIVE: certificate revoked (after signing => still valid)
      "trust": "trusted"|"untrusted_root"|"unknown" }   // ADDITIVE
  ],
  "events": [ { "event": "frozen"|"downloaded"|"verified"|"sealed"|"seal_retry",
                "at": iso8601, "by": string|null } ]    // newest first, max 100
}
```
Status precedence: `missing_file` > `tampered` (hash mismatch, or a signature
that no longer validates) > `seal_pending` > `seal_failed` > `signed_valid` /
`sealed_valid` > `frozen_valid`. `seal_pending`/`seal_failed` mean the frozen
(unsealed) copy is intact and is what downloads serve.

Additive deviations from the requested contract: `signatures[].revoked`,
`signatures[].trust`. Seal failures are recorded as events `seal_failed` in the
DB/AuditLog but are not returned in `events` (kept to the agreed enum).

### 3. Verify now
```
POST /api/leaves/leave-requests/{id}/integrity/verify/     (no body)
Access: same as GET integrity. 404 otherwise.
200 {"status":"success","data": IntegrityPayload}
```
Re-hashes + full pyHanko re-validation; records event `verified` + AuditLog
`document_verified` (metadata: result). For `not_frozen` returns the payload
without logging.

### 4. Retry seal (HR)
```
POST /api/leaves/leave-requests/{id}/integrity/retry-seal/   (no body)
Role gate: HRManager | SystemAdmin (403 otherwise; 404 if not in accessible companies)
200 {"status":"success","data": IntegrityPayload}   // after the retry attempt (may still be seal_pending)
422 "This document has not been frozen." | "Only documents whose seal is pending or failed can be retried."
```
Side effects: events `seal_retry` then `sealed` (or `seal_failed`); AuditLog `document_seal_retry`, `document_sealed`.

### 5. Verify an uploaded PDF (independent check)
```
POST /api/documents/verify-upload/        multipart field "file" (PDF, max MAX_DOCUMENT_VERIFY_UPLOAD_BYTES = 20 MB)
Role gate: HRManager | SystemAdmin (403 otherwise)
Company scope: a record is only matched if it is in the caller's accessible companies
               (x-active-company-id narrows it); otherwise matched_record = null.
200 {"status":"success","data": {
      "matched_record": {"type":"leave","id":int,"reference":string} | null,
      "integrity": IntegrityPayload without "events"   // "sha256" = hash of the UPLOADED file
      "summary": string                                  // English sentence for display
}}
422 file missing / too large / not a PDF ({"errors":[{"field":"file","message":...}]})
```
Matching: exact hash of the stored (sealed) copy or of the pre-seal frozen copy;
otherwise the embedded `/FFIDocumentRef` metadata identifies the record and the
result is `tampered`. Unknown files: validated by pyHanko alone
(`sealed_valid`/`signed_valid`/`tampered`, or `not_frozen` if unsigned).
The upload is never stored. Side effects: AuditLog `document_upload_verified`
(hash + result only), plus event `verified` on a matched record.
Warning/late notices (hash on the notice row, no `FrozenDocument`) are matched after
the frozen types: `matched_record.type` `warning_notice` / `late_notice`,
`integrity.signing_mode = "hash_only"`, no `verified` event (see "Warning notices: stored hash").

### i18n keys suggested for the frontend
`documentIntegrity.status.{not_frozen,frozen_valid,sealed_valid,signed_valid,tampered,missing_file,seal_pending,seal_failed}`,
`documentIntegrity.trust.{trusted,untrusted_root,unknown}`,
`documentIntegrity.events.{frozen,downloaded,verified,sealed,seal_retry}`,
`documentIntegrity.roles.{employee,alternative_employee,line_manager,hr,ceo,hr_completion,hr_manual,cfo,disbursement}`
(`cfo`, `disbursement` are new with loans),
`documentIntegrity.actions.{verify,retrySeal,uploadVerify}`, `documentIntegrity.errors.downloadBlocked`.
The backend `summary` is English only; prefer mapping `integrity.status` to i18n.

---

## When things are frozen

| Path | Trigger |
|---|---|
| CEO approval that makes the request `approved` | `leaves.services.apply_ceo_approval` |
| HR completion (non-Saudi travellers) | `apply_hr_completion` |
| HR manual record create | `HRManualLeaveRequestViewSet.create` |
| HR manual record edit | `partial_update` → **re-freeze** as a new version (`version` +1; old hash kept in event/audit metadata) |
| **Loan**: accountant marks it disbursed (`pending_disbursement` → `approved`) | `loans.services.apply_disbursement` |

Loans are frozen at disbursement, not at the CFO/CEO approval: the loan form has
five decision columns (manager, HR, CFO, CEO, disbursement) and only disbursement
completes it; `approved` is also the only status payroll deducts from. A loan in
`pending_disbursement` still renders live (its disbursement box says *Pending*).
Payroll deduction afterwards (`deducted`, "Payroll #N" on a live render) does not
change the frozen copy. Personal-mode attestations are recorded at submission,
manager recommendation, HR recommendation (also when the manager covered HR), CFO
approval or CEO referral, CEO approval and disbursement; rejections never freeze.
Loan stage roles: `employee`, `line_manager`, `hr`, `cfo`, `ceo`, `disbursement`
(decision labels on the HR work paper: Submitted / Approved / Rejected (a reject
*recommendation* that still moved the loan on) / Referred / Disbursed). There is no
HR-manual or auto-approved loan path: an HR manager's own loan goes to the CEO, and
a manager who is also HR covers the HR column; both still end at disbursement.

Freezing runs after the DB transaction commits; any failure is logged
(`document_integrity.finalize_failed`) and never undoes the approval.
Recovery for one record: `python manage.py freeze_approved_document --type <key> --id N`; the
statuses it accepts come from the adapter (`DocumentType.final_statuses`, see "Recovery command"
below; a loan is accepted as `approved` or `deducted`).
HR cancelling an approved leave keeps the frozen copy (it is the document that was approved).

In `personal` mode every approval (`submit`, alternative employee, manager, HR
review/referral, CEO, HR completion) also records a `DocumentApprovalSignature`:
the approver's certificate is issued lazily on their first approval and a
detached RSA signature over the canonical approval payload is stored at that
moment. The PDF signatures themselves are applied at finalization, one
incremental revision per approver in stage order, then the seal — because the
visible form only becomes final at the end and changing page content after an
earlier PDF signature would invalidate it.

## Models / migration

`core/migrations/0015_document_integrity.py` (new tables only, no data migration):
`FrozenDocument`, `DocumentIntegrityEvent`, `SigningCertificate`, `DocumentApprovalSignature`.
Foreign keys to users / companies / content types are `DO_NOTHING` with a real
DB constraint: a user who froze, approved or holds a certificate cannot be hard-
deleted (deactivate instead). This also keeps Django's delete collector from
querying these tables in historical-schema migration tests.
Files: `PrivateUploadStorage` → `private_uploads/frozen_documents/<type>/<id>/v<N>[_sealed]_<hash>.pdf`.

## Settings / env vars (`Backend/config/settings.py`)

| Env var | Default | Purpose |
|---|---|---|
| `DOCUMENT_SIGNING_MODE` | `freeze` | off / freeze / seal / personal |
| `DOCUMENT_SIGNING_BACKEND` | `local` | `local` or `aws_kms` |
| `DOCUMENT_SIGNING_KEY_DIR` | `private_uploads/signing` | dev CA + seal (on the private uploads volume, outside git) |
| `DOCUMENT_SIGNING_DEV_AUTOGENERATE` | `DJANGO_DEBUG` | generate dev root CA + seal on first use |
| `DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY` | "" | **Fernet key** encrypting personal private keys and dev key files. Required when DEBUG is off; in DEBUG it is derived from `SECRET_KEY` (dev only). Generate: `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`. Changing it makes stored keys unreadable. |
| `DOCUMENT_SIGNING_SEAL_PKCS12_PATH` / `_PASSWORD` | "" | real organization seal (PKCS#12) |
| `DOCUMENT_SIGNING_SEAL_KEY_PATH` / `_CERT_PATH` / `_CHAIN_PATH` | "" | seal as PEM key + cert (+ chain) |
| `DOCUMENT_SIGNING_CA_CERT_PATH` / `_KEY_PATH` / `_KEY_PASSWORD` | "" | internal CA for personal certs (else the dev CA) |
| `DOCUMENT_SIGNING_SEAL_NAME` | `FFI HR Document Seal` | dev seal CN |
| `DOCUMENT_SIGNING_ORGANIZATION` | `FFI` | O= in generated certs |
| `DOCUMENT_SIGNING_KMS_KEY_ID` / `_KMS_REGION` | "" | `aws_kms`: asymmetric RSA SIGN_VERIFY key + `SEAL_CERT_PATH` for its certificate; needs `pip install boto3` (not in requirements) |
| `DOCUMENT_SIGNING_TSA_URL` | `http://timestamp.digicert.com` | RFC 3161 TSA; `""` disables timestamps (B-B) |
| `DOCUMENT_SIGNING_TSA_TIMEOUT_SECONDS` | `10` | |
| `DOCUMENT_SIGNING_SEAL_ASYNC` | `false` | seal in Celery instead of inline after commit (see limitations) |
| `DOCUMENT_SIGNING_TRUSTED_ROOTS_PATH` | "" | PEM roots reported as `trusted` |
| `DOCUMENT_SIGNING_PERSONAL_CERT_DAYS` | `730` | personal certificate validity |
| `MAX_DOCUMENT_VERIFY_UPLOAD_BYTES` | 20 MB | verify-upload limit |

New dependencies (pinned in `Backend/requirements.txt`): `pyHanko==0.37.0`,
`pyhanko-certvalidator==0.32.1`, `cryptography==50.0.2` (pulls aiohttp, lxml, oscrypto).
`.gitignore`/`.dockerignore`: `Backend/signing_keys/`, `*.p12`, `*.pfx`
(`private_uploads/` was already ignored).

## Dev setup

```
# Backend/.env.docker (local only)
DOCUMENT_SIGNING_MODE=personal        # or seal
# optional: DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY=<fernet key>

tools/dev-compose.sh up -d --build backend notification-worker celery-beat
docker exec ffi_hr_backend python manage.py init_document_signing --check-tsa --export-root /app/private_uploads/signing/ffi_dev_root.pem
docker cp ffi_hr_backend:/app/private_uploads/signing/ffi_dev_root.pem .   # import into Adobe "Trusted Certificates" to stop "unknown signer"
```

Management commands:
* `init_document_signing [--check-tsa] [--export-root PATH]` — create/inspect keys, test the TSA.
* `retry_document_seals [--include-failed] [--document-id N]` — retry pending seals (run from cron; e.g. hourly).
* `revoke_signing_certificate --email X [--reason ...]` — revoke a person's certificates.
* `freeze_approved_document --type <key> --id N [--force]` — single-record recovery (not a backfill); refuses
  any status outside the type's `final_statuses` (table under "Recovery command").

Offboarding: deactivating a user (`is_active=False`, any code path) revokes
their signing certificates automatically (post_save signal). Revoked/inactive
approvers are skipped when a document is signed later; signatures made before
revocation are reported `valid: true, revoked: true`.

Independent check with the pyHanko CLI:
`pyhanko sign validate --pretty-print --trust ffi_dev_root.pem approved.pdf`.

## Security notes / known limitations

* **Key custody (local backend) is dev-grade**: personal keys are stored in the DB
  encrypted with a Fernet key from settings; whoever has the DB *and* that key
  can sign as anyone. Use `aws_kms` (seal) / an HSM for production; per-person
  keys in KMS are not implemented (cost: one KMS key per person).
* **Internal CA is not publicly trusted**: Adobe shows "signature validity
  unknown / unknown signer" until the root (`ffi_dev_root.pem` or your CA) is
  trusted. The API reports this as `trust: "untrusted_root"` with `valid: true`.
  For green ticks in Adobe use an AATL/eIDAS seal certificate.
* The internal CA publishes no CRL/OCSP; revocation is only known to this
  system's verifier (by serial).
* LTV (PAdES-B-LT/LTA) is **not** implemented: the internal CA has no
  revocation endpoints to embed. Seal is PAdES-B-T.
* Personal PDF signatures are applied at finalization (signing time = final
  approval); the per-stage moment is evidenced by the signed attestation rows
  and the approval-trail timestamps.
* `DOCUMENT_SIGNING_SEAL_ASYNC=true` requires the Celery worker to be able to
  write `private_uploads/frozen_documents` and read the 0600 key files; in the
  current compose the worker runs as `app` and those are root-owned, so it is
  off by default (sealing runs inline after commit in the backend process; the
  TSA call adds up to `TSA_TIMEOUT` seconds to the final approval request).
* `retry_document_seals` is not scheduled in Celery Beat; add it to cron.
* `?packet=1` downloads are not verifiable originals (see endpoint 1).
* Penalty warning notices and attendance late notices are stored at issuance but not
  frozen or sealed: only an issuance hash on the notice row (see "Warning notices: stored
  hash"). The contract-rating employee/manager copies still render live (only the HR/CEO decision copy is frozen; see
  "Rollout inventory").
* Visible-reference matching for edited uploads (Canva drops the hidden tag)
  now also matches real public references such as `LV-FFI-000101` /
  `LN-EDL-900201` (2026-10-08 fix; the old pattern only matched `LR-00012`
  style fallbacks, so such edited copies came back `not_frozen` instead of
  `tampered`).

## Shared HTTP plumbing (`Backend/core/document_integrity/api.py`)

Every type uses the same helpers, so the JSON and the download rules are
identical everywhere (leave and loans use them; nothing here is type-specific):

| Name | Signature | What it does |
|---|---|---|
| `frozen_pdf_response` | `(instance, request, *, render_live: () -> bytes, filename: str, packet_pages: (() -> bytes \| None) \| None = None, content_type="application/octet-stream") -> HttpResponse` | Frozen copy + `DocumentIntegrityEvent downloaded`; `render_live()` only when nothing is frozen; 409 + AuditLog `document_download_blocked` (entity = the type key) when the stored copy is missing/altered; HR-only `?workpaper=1&tz=` (`<stem>_workpaper.pdf`); `?packet=1` appends `packet_pages()` (`<stem>_packet.pdf`). Sets `Content-Disposition: attachment`, `nosniff`, `Cache-Control: private, no-store`. Callers keep their own module audit (e.g. loans log `loan_request_exported_pdf` when `response.status_code == 200`). |
| `DocumentIntegrityActionsMixin` | mixin for a DRF `ViewSet`; implement `get_integrity_object(self) -> instance \| None` | Adds `GET {id}/integrity/`, `POST {id}/integrity/verify/`, `POST {id}/integrity/retry-seal/` (action names `integrity`, `integrity_verify`, `integrity_retry_seal`). `None` → 404. retry-seal also re-checks `IsHRManagerOrAdmin` inside the action (403), so a `get_permissions()` that falls back to `IsAuthenticated` cannot open it. Payload passes through `services.for_viewer` (profile ids for HR/SystemAdmin only). |
| `resolve_integrity_object` | `(request, pk, *, hr_queryset, involved_queryset: () -> QuerySet, can_access: (user, instance) -> bool)` | HR/SystemAdmin search `hr_queryset` (already limited to accessible companies); everyone else searches `involved_queryset()`; `can_access` has the final say. |
| `involved_q` | `(user, fields: Iterable[str]) -> Q` | `Q(f1=user) \| Q(f2=user) \| ...` for the recorded actor fields. |
| `request_timezone` | `(request) -> ZoneInfo \| None` | `?tz=` as an IANA zone; `None` (system zone) when missing/unknown. |
| `sensitive_download` | `(pdf_bytes, filename, *, content_type=...) -> HttpResponse` | The attachment headers above. |

## How to add a new document type

Follow these steps in order; `leaves/` and `loans/` are the two reference
implementations (`loans/document_integrity.py` is the smaller one to copy).

1. **Pick the freeze point.** Find the service function where the request reaches
   the state after which nothing printed on the form changes any more (usually the
   last signature column, not merely "approved"). Read the PDF builder: every
   value that can still change after that point (dates of later steps,
   "Pending" boxes, payroll references) means the freeze point is too early. If
   the transition happens inside a view instead of a service, move it into a
   service first (or hook it in the view, inside the same `transaction.atomic()`).
2. **Create `<app>/document_integrity.py`** with:
   * `DOCUMENT_TYPE = "<model_snake_case>"` (the registry key, also stored on
     `FrozenDocument.document_type`, used in the hidden `/FFIDocumentRef` token and
     as the AuditLog entity of `document_*` events) and `FINAL_STATUS(ES)`; pass them to
     `DocumentType(final_statuses=...)` (default `("approved",)`; optional `final_check(instance)`
     for an extra condition) - the recovery command reads them from there.
   * `_render(instance) -> bytes`: the module's existing builder, imported lazily
     from the views/pdf module (the same function the download renders live, so a
     test can patch it). Never call it with a request/user: the frozen bytes must
     not depend on who triggered the freeze.
   * `_reference(instance) -> str`: the reference printed on the form
     (`core.services.request_references.public_reference_for(instance)` plus the
     module's legacy fallback, e.g. `f"LN-{pk:05d}"`). Keep it identical to the
     printed one: verify-upload matches edited copies by this visible text.
   * `_subject(instance) -> str`: `"<profile name> - <employee_id>"`.
   * `<type>_stage_signers(instance) -> list[StageSigner]`: completed stages in
     workflow order from the **recorded** decision fields only (`*_by` + `*_at`
     both set). `StageSigner(role, role_label, actor, at, action_label)`;
     `role` is a short stable key (reused: `employee`, `line_manager`, `hr`, `ceo`;
     add new ones to the i18n list above), `action_label` must fit the work-paper
     column (~11 characters: Submitted / Approved / Rejected / Referred /
     Disbursed / Completed / Recorded). External people (candidates) can be listed
     with `actor=None`: they appear on the trail and are skipped for personal
     signatures.
   * `can_access_<type>_document(user, instance) -> bool`: HRManager/SystemAdmin →
     True (the company limit is applied by the view's queryset); otherwise the
     owner, delegate/alternative, and every recorded approver id.
   * `_accessible_queryset(request)`: `filter_queryset_by_accessible_companies(
     Model.objects.filter(is_active=True), request)` — verify-upload only names a
     record the caller can reach through this.
   * `register()` calling `register_document_type(DocumentType(key, label,
     api_type, model, render, reference, subject, company, stage_signers,
     can_access, accessible_queryset))`. `label` is printed on the work paper
     ("Loan Request"); `api_type` is `matched_record.type` (`leave`, `loan`, ...).
   * `on_<type>_stage_approved(instance, *, role, actor, at=None)`:
     `record_stage_approval(...)`, then `schedule_finalize(instance, actor=actor)`
     when `instance.status in FINAL_STATUSES and instance.is_active`.
3. **Register** in the app's `AppConfig.ready()` (`from .document_integrity import
   register; register()`), as in `loans/apps.py`.
4. **Hook the workflow** in the service layer, inside the existing
   `transaction.atomic()` right after `record_workflow_transition(...)`: call
   `on_<type>_stage_approved(locked, role=..., actor=actor, at=locked.<x>_at)` at
   submission (`role="employee"`, `at=created_at`), every approval/recommendation/
   referral, and the final transition. Both helpers defer to
   `transaction.on_commit` and swallow/log every error
   (`document_integrity.finalize_failed`), so a storage or signing failure can never
   undo or block the approval. Do not hook rejections or cancellations.
5. **Download view**: replace the body after the existing object lookup and
   permission check with
   `return frozen_pdf_response(instance, request, render_live=lambda: _build_x_pdf(instance), filename=...)`
   (pass `content_type="application/pdf"` if the module used it, and
   `packet_pages=` if it supported `?packet=1`). Keep the module's own audit,
   gated on `response.status_code == 200`. Apply it to **every** PDF alias/route of
   the type (check `urls.py` for routers registered twice and for
   `trailing_slash = "/?"`).
6. **Integrity endpoints**: add `DocumentIntegrityActionsMixin` as the first base
   of the viewset that owns the main PDF route, then
   ```python
   def get_integrity_object(self):
       from .document_integrity import INVOLVED_FIELDS, can_access_x_document
       user = self.request.user
       base = Model.objects.filter(is_active=True)
       return resolve_integrity_object(
           self.request, self.kwargs.get(self.lookup_field),
           hr_queryset=filter_queryset_by_accessible_companies(base, self.request),
           involved_queryset=lambda: base.filter(involved_q(user, INVOLVED_FIELDS)),
           can_access=can_access_x_document,
       )
   ```
   If the viewset overrides `get_permissions()`, map `integrity`/`integrity_verify`
   to `[IsAuthenticated()]` and `integrity_retry_seal` to
   `[IsAuthenticated(), IsHRManagerOrAdmin()]` before any role gate that would
   block approvers. For a module built on `APIView`s (job offers, starting work),
   add three small views calling `services.integrity_payload` /
   `verify_instance` / `retry_seal` through `for_viewer`, with the same 404/403/422
   rules as the mixin (or convert the routes to a `ViewSet`).
7. **Do not backfill.** Existing approved rows stay `not_frozen` and render live;
   single-record recovery is `manage.py freeze_approved_document --type <key> --id N`
   (the status must be one of the adapter's `final_statuses`; never edit the command
   per type).
8. **Docs**: add the routes to `plans/API Route Status Matrix.md` (document
   integrity section) and a section to this handoff (paths, freeze point, roles,
   `matched_record.type`).
9. **Tests** (`<app>/test_document_integrity.py`; copy
   `loans/test_document_integrity.py`, which needs no shared fixtures; the root
   `conftest.py` already keeps frozen files out of the real volume). Use
   `django_capture_on_commit_callbacks(execute=True)` around each transition and
   `settings.DOCUMENT_SIGNING_*` like the `signing` fixture. Cover:
   frozen only at the final transition (and not one step before); every
   alternative route to the final state; finalize failure (patch
   `core.document_integrity.services.finalize_document` to raise) leaves the
   approval intact; mode `off`; every PDF alias serves the stored bytes without
   calling the builder (patch it with `side_effect=AssertionError`); signature
   image / profile name change after approval leaves the download unchanged;
   in-progress renders live; HR work paper with `tz=Pacific/Auckland` contains the
   approver names and no `+13`/`UTC`, owner gets the plain copy; tamper
   (`/Producer` → `/Producar`) → `tampered` + 409 on every alias +
   `document_download_blocked`; deleted file → `missing_file`; pre-rollout row →
   `not_frozen` with the exact payload keys; permissions (owner, each approver,
   HR 200; uninvolved 404; anonymous 401; retry-seal 403 for non-HR, 422 when not
   sealing; other-company HR 404); verify-upload (`matched_record.type`, tampered
   copy, metadata-stripped copy matched by visible reference); seal mode and
   personal mode with the in-process `DummyTimeStamper` (roles in order). Then run
   the app's full suite plus `core` and `leaves`.

## Rollout inventory

Approval-workflow "request" documents generated by the system, as of 2026-10-08.
"Final" = the service/view where the form stops changing. Paths verified against
`config/urls.py` and each app's `urls.py`.

| # | Type (module) | Builder | Download endpoint(s) | Freeze point | Stage signers (recorded fields) | Status |
|---|---|---|---|---|---|---|
| 1 | Leave request (`leaves`) | `leaves.pdf_leave_request.build_leave_request_pdf` via `leaves.views._build_leave_request_pdf` | `GET /api/leaves/leave-requests/{id}/pdf/`, `.../manager/leave-requests/{id}/pdf/`, `.../ceo/leave-requests/{id}/pdf/` | CEO approval / HR completion / HR manual create+edit | see `leaves/document_integrity.py` | **Done** |
| 2 | Loan request (`loans`) | `loans.pdf_loan_request.build_loan_request_pdf` via `loans.views._build_loan_request_pdf` | `GET /api/loans/loan-requests/{id}/pdf/`, alias `/api/loans/hr/loan-requests/{id}/pdf/` | `loans.services.apply_disbursement` (→ `approved`) | employee, manager (`manager_decision_*`), HR (`finance_decision_*`), CFO (`cfo_decision_*`), CEO (`ceo_decision_*`), accountant (`disbursed_*`) | **Done** |
| 3 | Permission / exit permission request (`permission_requests`; `exit_type` on the same model) | `permission_requests.pdf_permission_request.build_permission_request_pdf` | `GET /api/permission-requests/{id}/pdf/` (`/?` trailing slash; visibility `_get_visible`: owner, manager scope, HR) | `permission_requests.services.apply_manager_decision` when it returns `approved` (no HR stage, or manager covers HR) and `apply_hr_decision` (→ `approved`) | employee (`created_at`), manager (`manager_decision_by/_at`), HR (`hr_decision_by/_at`, also set when the manager covered HR) | **Done** |
| 4 | Annual entitlements / annual-leave settlement (`leaves`, `AnnualLeavePaymentRequest`) | `leaves.pdf_annual_entitlements.build_annual_entitlements_pdf` via `leaves.views._build_annual_entitlements_pdf` | `GET /api/leaves/annual-leave-payments/{id}/pdf/` | `leaves.annual_payment_services.apply_annual_payment_ceo_approval` (→ `approved` **or** `carried_forward`) | applicant (`employee`), HR reviewer (`hr_reviewed_by/_at`), CEO (`ceo_decided_by/_at`; trail only, the form has no CEO box); the form's financial-management and accounts-officer boxes have no recorded actor (always blank) | **Done** |
| 5 | Asset return request (`assets`) | `assets.views._build_return_request_pdf` (generic `core.pdf.render_request_pdf`, not a mapped form) | `GET /api/assets/return-requests/{id}/pdf/` (`AssetViewSet` action) | `assets.services.return_requests.mark_return_request_processed` (→ `PROCESSED`; the PDF has a "Processed" row) | requester, manager (`manager_decision_by`), HR (`hr_decision_by`), CEO (`ceo_decision_by`), processor (`processed_by/_at`) | **Done** |
| 6 | Asset damage report (`assets`) | `assets.views._build_damage_report_pdf` (generic renderer) | `GET /api/assets/damage-reports/{id}/pdf/` | `CEOAssetDamageReportViewSet.approve` (view-level save → `APPROVED`; move into a service first) | reporter, HR (`hr_decision_by/_at`), CEO (`ceo_decision_by/_at`) | **Done** |
| 7 | Job offer (`job_offers`) | `job_offers.pdf.build_job_offer_pdf` | `GET /job-offers/{id}/pdf/` (**no `/api` prefix**, `JobOfferPdfView` APIView); the same PDF is e-mailed/WhatsApp'd to the candidate by `job_offers.services.deliver_job_offer` | v1 at send (`JobOfferSendView`, `status=sent`; `hr_signature_date` = `sent_at`), re-freeze v2 at the candidate's answer (`JobOfferRespondView.post`, `accepted`/`rejected`). CEO approval (`JobOfferDecisionView`, view-level) is too early | HR signer (`hr_signer_user`, chosen when drafting — not a decision), CEO (`ceo_decision_by/_at`), candidate (external, no user: `actor=None`) | **Done** |
| 8 | Starting-work acknowledgement (`job_offers`) | `job_offers.starting_work_pdf.build_starting_work_acknowledgment_pdf(profile, data)` | `GET /starting-work-acknowledgments/{id}/pdf/` (no `/api` prefix, HR only, serves the stored `EmployeeDocument` file) | `job_offers.starting_work_service.approve_starting_work_acknowledgment` (re-renders and overwrites the stored `EmployeeDocument`, → `approved`) | HR approver (`approved_by/_at`); the form's direct-superior / general-manager / details-approver boxes come from `StartingWorkAcknowledgmentData`, not from decisions | **Done** |
| 9 | Contract rating (`contract_ratings`) | `contract_ratings.pdf.build_contract_rating_pdf(rating, response=, include_decision=)` | `GET /contract-ratings/{id}/pdf/` (no `/api` prefix) | `contract_ratings.services.submit_ceo_decision` (→ `DECIDED`) | manager at creation, HR commenter (`hr_comment_by`), CEO (`ceo_decided_by`); employee/manager responses | **Done** (decision copy only, option B) |

### Per-type risks and edge cases

* **Permission requests (3)**: the download sets `Content-Type: application/pdf`
  and filename `permission_request_{reference_no}.pdf` — pass
  `content_type="application/pdf"` to keep it. Approval also upserts attendance
  adjustments and schedules a recalculation in the same transaction; the freeze is
  `on_commit`, so order is fine. Only pending requests can be cancelled, so a
  frozen request never changes state again. Evidence attachments are separate
  files, not part of the PDF. References are native `reference_no` values.
* **Annual entitlements (4)**: two final statuses (`approved`, `carried_forward`);
  `freeze_approved_document` accepts both. The CEO approval refreshes
  the settlement salary (`refresh_settlement_salary`) inside the same transaction —
  freeze after commit (as the helpers do) so the frozen form shows the refreshed
  figures. The employee UI links settlements to the balance page, not a detail page.
* **Asset requests (5, 6)**: generic `render_request_pdf` output (no mapped
  template, no signature images — names only). Damage-report approval is written in
  the view without a service or workflow transition; hook it inside a
  `transaction.atomic()` or move it to a service first. `assets/views.py` was being
  edited by another session on 2026-10-08.
* **Job offers (7)**: the document changes after CEO approval (send date, the
  candidate's answer), so it needs two versions (send, answer); versioning already
  exists (`version` +1, previous hash in the event metadata). The candidate copy
  sent by `deliver_job_offer` should then be the frozen bytes. Routes are
  `APIView`s without the `/api` prefix — the mixin does not apply as-is. Offers can
  be cancelled/expire after sending (keep the frozen copy). Candidates have no
  account: no personal signature.
* **Starting work (8)**: system-generated (no request), approved by HR; the stored
  file lives in the employee's documents and can be replaced there. Render for the
  freeze should read the bytes produced at approval rather than rebuild
  `StartingWorkAcknowledgmentData`. Rejected/voided acknowledgements are not frozen.
* **Contract ratings (9)**: the PDF differs by viewer (`response=` employee vs
  manager response; `include_decision` only for HR/CEO), i.e. several documents per
  record, while `FrozenDocument` is unique per (content type, object id). Needs a
  variant key on `FrozenDocument` (migration) or freezing per
  `ContractRatingResponse`. It also uses `signature_for_user` directly (no
  profile-name fallback) and returns 503 when the template is missing. HR detail
  access requires a CEO comment request. Decide the design before implementing.

### Excluded (not approval-workflow request documents)

| Document | Where | Why excluded |
|---|---|---|
| Penalty warning notices | `penalties.warning_notices.create_notice`; `GET /api/penalties/{id}/warning-notice/` | System-issued letter, rendered once at issuance and stored; no approval. Hash-only: `document_sha256` on the notice row, matched by verify-upload (see "Warning notices: stored hash"). |
| Attendance late notices | `attendance.late_notices.issue_late_notice_for_new_violation`; `GET /api/attendance/notices/{id}/download/` | Same as above (hash-only, `late_notice`). |
| Payslips, payroll report/export | `payroll.views._build_payslip_pdf`, `_build_payroll_report_pdf`, `export`/`download` | Reports regenerated from payroll data; not requests. |
| Rent printouts | `rents.views._build_rent_pdf`; `GET /api/hr/rents/{id}/pdf/` | HR record printout, no approval workflow. |
| Asset label sheets | `assets.views.label_job_pdf` | Operational labels. |
| Employee exports, uploaded documents | `employees.views.export`, `download_document`, permission/leave attachments | Not system-generated forms (uploads) or reports. |
| Leave `?packet=1` bundles | leave PDF | Convenience merge, never the verifiable original. |

## Tests

* `Backend/leaves/tests/test_document_integrity.py` — freeze at final stage
  (CEO, HR completion, manual record), serve-frozen-not-re-rendered, signature
  image/name change after approval does not change the PDF, name fallback,
  not_frozen for old records, mode off, tamper + missing file (409 download),
  seal + timestamp (mock TSA) validated by pyHanko, forged bytes with a rewritten
  hash still fail, TSA unreachable → `seal_pending` → HR retry, personal
  incremental signatures + attestation, revocation (after signing / before
  signing / offboarding), permissions, verify-upload (match, tampered, sealed,
  HR-only, no cross-company leak).
* `Backend/core/tests_document_integrity.py` — name-fallback renderer, key
  encryption, KMS signer (fake client), validation edge cases.
* `Backend/loans/test_document_integrity.py` — frozen only at disbursement (direct
  CFO route and CEO-referral route), finalize failure never undoes the
  disbursement, mode off, every PDF alias (with/without trailing slash) serves the
  frozen copy without rendering, signature/name change after approval, in-progress
  renders live, HR-only work paper with `tz` (no zone suffix), tamper/missing →
  409 on both aliases, `not_frozen` for pre-rollout loans, verify clean,
  permissions (owner/approvers/HR 200, uninvolved CEO/outsider 404, anonymous
  401, retry-seal 403/422, foreign-company HR 404), verify-upload (`type: loan`,
  tampered copy, Canva-style copy matched by its visible reference), seal (mock
  TSA) and personal mode (5 approver signatures + seal, roles in order).
* `Backend/conftest.py` — autouse fixture pointing the `FrozenDocument` file
  storage at a temp dir, so test runs no longer write frozen PDFs into the real
  `private_uploads` volume (earlier leave test runs left ~97 orphan
  `frozen_documents/leave_request/<id>/` folders there; see the stage-1 report).

## Asset return requests

Implemented 2026-10-08 (`Backend/assets/document_integrity.py`, registered in
`AssetsConfig.ready()`; type key `asset_return_request`, label "Asset Return
Request", `matched_record.type = "asset_return"`).

```
GET  /api/assets/return-requests/{id}/pdf/                  (also without trailing slash; AssetViewSet action, unchanged auth:
                                                              owner or HRManager/SystemAdmin, company-scoped, 404 otherwise)
     Frozen copy once PROCESSED; 409 if altered/missing; HR-only ?workpaper=1&tz=;
     ?packet=1 still appends the asset invoice (not the verifiable original).
     Filename asset_return_request_{id}.pdf (_workpaper / _packet suffixes).
     AuditLog asset_return_request_exported_pdf (or _exported_packet when an invoice was
     appended) on every 200, never on 409.
GET  /api/assets/return-requests/{id}/integrity/
POST /api/assets/return-requests/{id}/integrity/verify/
POST /api/assets/return-requests/{id}/integrity/retry-seal/
     AssetReturnRequestIntegrityViewSet (DocumentIntegrityActionsMixin on a GenericViewSet
     registered at the same prefix). Access: owner, recorded manager / HR / CEO /
     processor, or HRManager/SystemAdmin in accessible companies; 404 for anyone else
     (also for the PDF-less manager/CEO viewsets); 401 anonymous; retry-seal 403 for
     non-HR, 422 when not sealing.
```

* **Freeze point**: `assets.services.return_requests.mark_return_request_processed`
  (→ `PROCESSED`), called by `POST /api/assets/{asset_id}/return/` inside its
  `transaction.atomic()`; the freeze runs on commit and can never undo the return.
  The form's last row is "Processed", so `APPROVED` still renders live. HR can
  receive an asset while its request is still pending (every open request is
  processed): that request is frozen too, with only the stages that happened.
* **Roles** (personal-mode attestations / work-paper rows, stage order):
  `employee` (Submitted, at `requested_at`), `line_manager`, `hr` (also when the
  manager covers HR), `ceo` (HR manager's own request), **`asset_received`** (new;
  label "Asset received", action "Processed", `processed_by/_at`). Rejections are not
  hooked (a rejected request is never processed).
* Reference = the printed one: `public_reference_for(req)` (`AR-<employee_id><nn>`)
  or the bare id. Edited copies are matched by the visible `AR-` reference; a bare-id
  fallback cannot be matched visually (hash/hidden token only).
* Recovery: `freeze_approved_document --type asset_return_request --id N` (accepts
  `PROCESSED`). No backfill.
* Not frozen data: the asset name/serial and actor names printed on the generic
  `render_request_pdf` form are captured at processing; later edits do not change
  the download.

## Asset damage reports

Implemented 2026-10-08 (same module; key `asset_damage_report`, label "Asset Damage
Report", `matched_record.type = "asset_damage"`).

```
GET  /api/assets/damage-reports/{id}/pdf/                    (unchanged auth: owner or HR, company-scoped)
GET  /api/assets/damage-reports/{id}/integrity/
POST /api/assets/damage-reports/{id}/integrity/verify/
POST /api/assets/damage-reports/{id}/integrity/retry-seal/
     Same rules as the return request. Access: owner, recorded HR / CEO, HR in company.
     Download audit asset_damage_report_exported_pdf / _exported_packet.
```

* **Freeze point**: CEO approval (`POST /api/ceo/assets/damage-reports/{id}/approve/`).
  The save that used to live in `CEOAssetDamageReportViewSet.approve` moved to
  `assets.services.damage_reports.approve_damage_report_by_ceo` (same checks, same
  messages and fields, now under `transaction.atomic()` + `select_for_update`
  re-check of `PENDING_CEO`); the view keeps its audit and notification. CEO
  rejection is unchanged and never freezes.
* **Roles**: `employee` (action "Reported", at `reported_at`; attestation recorded
  when the report is created), `hr` (only if `hr_decision_by/_at` are ever recorded),
  `ceo`.
* **Gap found**: there is no HR decision endpoint for damage reports. A report from a
  non-HR employee is created `PENDING_HR` and nothing moves it on; only an HR
  manager's own report (created `PENDING_CEO`) can reach the CEO and be frozen.
  Product decision needed (add an HR review action, or accept).
* Reference = the printed one, the bare report id (the form has no workflow
  reference). Consequence: a metadata-stripped (Canva-style) copy cannot be matched
  by visible reference and is reported `not_frozen`; exact copies and copies keeping
  the hidden `/FFIDocumentRef` tag are matched. Fixing it means printing a prefixed
  reference (e.g. `AD-<id>`), which changes the visible form — decision needed.
* Recovery: `freeze_approved_document --type asset_damage_report --id N` (accepts `APPROVED`).

Tests: `Backend/assets/test_document_integrity.py` (both types; mirrors the loan tests).

## Contract ratings proposal

Superseded: **option B was chosen and implemented** (see "Contract ratings" below); kept for
the record. Builder: `contract_ratings.pdf.build_contract_rating_pdf(rating, response=, include_decision=)`,
route `GET /contract-ratings/{id}/pdf/` (`ContractRatingViewSet.pdf`), freeze candidate
`contract_ratings.services.submit_ceo_decision` (→ `DECIDED`).

**The problem.** `viewer_role()` picks one of three documents for the same record:

| Viewer | `response=` | `include_decision` |
|---|---|---|
| employee (RATE mode) | employee's self-rating | no |
| manager | manager's rating | no |
| HR (only after a CEO comment request) / CEO | manager's rating | **yes** (recommendation box) |

`FrozenDocument` is unique per `(content_type, object_id)` and every helper
(`get_frozen_document`, `frozen_pdf`, `integrity_payload`, verify-upload's
`_document_for_token`) assumes one document per record. Versioning (leave HR-manual
re-freeze: `version` +1 on the same row, previous hash only in event/audit metadata)
replaces the old copy, so it cannot hold two concurrent variants.

**Option A — variant key on `FrozenDocument` (recommended).**
* Migration (core, schema only, no data migration): add
  `variant = CharField(max_length=20, default="", blank=True)`; replace the unique
  constraint with `(content_type, object_id, variant)`; extend the type/object index.
  Existing rows get `variant=""`, so leave/loan/asset behaviour is untouched.
* API change, additive and backwards compatible: `variant: str = ""` keyword on
  `freeze_document`, `finalize_document`, `get_frozen_document`, `frozen_pdf`,
  `frozen_pdf_response`, `integrity_payload`, `verify_instance`, `retry_seal`,
  `schedule_finalize`; adapter gains optional `variants: (instance) -> list[str]`
  and `render(instance, variant)`. Storage path `.../<id>/<variant>/v<N>_<hash>.pdf`;
  hidden token `contract_rating:<id>:<variant>:<ref>` (parser must accept 3 or 4 parts).
* Contract ratings would freeze three variants at `submit_ceo_decision`: `decision`
  (manager rating + recommendation — the canonical approved document), `manager`,
  `employee` (only in RATE mode, only if the employee response exists). The download
  maps `viewer_role` → variant; the integrity endpoints return the viewer's variant
  (HR/CEO see `decision`).
* verify-upload: hash lookup works unchanged (each variant has its own hash);
  `matched_record` would gain `variant` (additive).
* Effort: ~1.5–2 days backend (core change + its tests re-run for leave/loan/assets,
  contract-rating adapter, tests), plus frontend showing the variant name.
* Risks: touches the shared core every type depends on (regressions in leave/loan);
  three hashes per record to explain to auditors; personal signing would sign three
  files (or only `decision`, and the other two stay hash-only — recommended).

**Option B — one canonical frozen document + live viewer renders.**
* Freeze only the `decision` variant (what the CEO approved) with the current single-
  row model: **no migration**, no core change; adapter `render` =
  `build_contract_rating_pdf(rating, response=rating.manager_response, include_decision=True)`.
* Employee/manager downloads keep rendering live (they never see the decision) and
  are explicitly "not the verifiable original"; HR/CEO downloads serve the frozen copy.
  Integrity endpoints: HR/CEO (and HR in company) only; for the employee/manager
  they would either 404 or report the canonical status without serving it.
* Effort: ~0.5–1 day. Risks: employee and manager copies remain mutable (a later
  signature/name change alters them), which is the exact problem this rollout fixes;
  the integrity badge would mean different things for different viewers.

**Common to both.** `build_contract_rating_pdf` uses `signature_for_user` directly and
raises when the template is missing (503): freezing must catch that (finalize already
logs and never undoes the decision; recovery via `freeze_approved_document`, which
needs `DECIDED` added to its final statuses). HR's detail access requires
`hr_comment_requested_at`; keep that gate on the download and apply the same gate in
`can_access`. Routes have no `/api` prefix (keep them).

**Recommendation:** B now if the business only needs the CEO's decision document to be
tamper-evident; A if the employee's own self-rating copy must also be evidence. Decision
needed from HR/product.

## Warning notices: stored hash (implemented 2026-10-08)

Implemented (backend), the user chose the smaller "hash on the notice row" option: no
`FrozenDocument`, no `/FFIDocumentRef`, no seal or signatures, no change to downloads
or delivery. Penalty warning notices (`penalties.warning_notices.create_notice`) and
attendance late notices (`attendance.late_notices.issue_late_notice_for_new_violation`)
were already rendered once at issuance and stored in `PrivateUploadStorage`; the
in-app download (`GET /api/penalties/{id}/warning-notice/`,
`GET /api/attendance/notices/{id}/download/`) and the WhatsApp attachment
(`in_app_notifications.dispatcher._load_whatsapp_document`) both serve that stored file,
so hashing the stored bytes covers the recipient's copy. Nothing re-renders a letter.

**Fields** (both `PenaltyWarningNotice` and `AttendanceLateNotice`):
`document_sha256` (CharField 64, blank, indexed) and `document_hashed_at` (nullable
DateTime). Set in the same save that stores the PDF, from the exact `pdf_bytes` written
(`core.document_integrity.hash_records.record_issued_hash`). The hash is also recorded in
the existing `penalty_warning_notice_generated` / `attendance_late_notice_generated`
AuditLog metadata (`document_sha256`). Not exposed by the notice list/detail
serializers (their contract is unchanged).

**Migrations:** `penalties/0006_penaltywarningnotice_document_sha256`,
`attendance/0017_attendancelatenotice_document_sha256` (AddField only, no backfill).

**Verify-upload** (`POST /api/documents/verify-upload/`, unchanged path, role gate and
envelope). `services.verify_uploaded_pdf` consults the hash-only registry
(`core/document_integrity/hash_records.py`, `register_hash_only_type`) only after no
`FrozenDocument` matched by hash/superseded version; existing types behave as before.
* Upload bytes equal a hashed notice's `document_sha256` → `integrity.status =
  "frozen_valid"`.
* No hash match, no `FrozenDocument` match by `/FFIDocumentRef` or printed reference,
  and the file prints exactly one hashed notice's `reference_number`
  (`LAN-<company>-<id>` / `PWN-<company>-<id>`, same visible-reference extraction as the
  other types) → `"tampered"`.
* Only notices in the caller's accessible companies (`filter_queryset_by_accessible_companies`,
  `x-active-company-id` narrows) are matched; otherwise the usual `not_frozen` /
  pyHanko result.
* Response: `matched_record = {"type": "warning_notice", "id": <notice id>, "reference":
  "PWN-...", "penalty_id": <penalty id>}` or `{"type": "late_notice", "id": <notice id>,
  "reference": "LAN-..."}`; `integrity.signing_mode = "hash_only"`, `integrity.frozen_at` =
  `document_hashed_at`, `integrity.sha256` = hash of the upload, `seal`/`signatures`
  from pyHanko (empty for these letters); `summary` says the result is hash-verified only.
* Side effects: AuditLog `document_upload_verified` with `entity = "warning_notice" |
  "late_notice"`, `entity_id = <notice id>`, metadata `{upload_sha256, matched: true,
  result, verification: "hash_only"}`. There is no `DocumentIntegrityEvent` (no
  `FrozenDocument` row exists for these letters).

**Frontend needs** (no frontend work done): type labels for `matched_record.type`
`warning_notice` ("Warning notice", link `/penalties/{penalty_id}`) and `late_notice`
("Late attendance notice"); tolerate `integrity.signing_mode = "hash_only"` (show "Hash
verified, not signed"); no integrity panel or badge exists for these records.

**Limitations**
* Notices issued before the migration have no hash and are never matched (verify-upload
  reports `not_frozen` for them, even for a copy carrying their reference). No backfill:
  hashing today's stored file would not prove what was issued. Decide whether a backfill
  ("hash as stored on <date>") is wanted.
* Detects edited copies presented for verification only. The stored file itself has no
  409 protection (downloads do not re-check the hash) and there is no seal or signature,
  so the evidence is only as strong as the database row.
* `frozen_valid` means "identical to what was issued", not "still in force": a waived or
  withdrawn warning still verifies; the frontend should link to the record.
* Tampered detection needs the printed reference to be extractable (pypdf text); a
  scanned/flattened image copy reports `not_frozen`.

## Job offers

Implemented 2026-10-08 (backend). Code: `Backend/job_offers/document_integrity.py`
(both job-offer types), hooks in `job_offers/views.py` and `job_offers/services.py`,
routes in `job_offers/urls.py`, tests `job_offers/tests/test_document_integrity.py`.
Registry key `job_offer`; `matched_record.type = "job_offer"`; label "Job Offer".
Reference = `JobOffer.reference_number` (the printed `reference_no`).

```
GET  /job-offers/{id}/pdf/                       (no /api prefix; unchanged access: HR/SystemAdmin or a CEO approver
                                                  who can see the offer; active-company scoped)
     Frozen copy once sent; 409 when missing/altered (AuditLog document_download_blocked, no
     job_offer_pdf_downloaded); HR-only ?workpaper=1&tz=<IANA> -> job-offer-<ref>_workpaper.pdf.
     Unsent offers and offers sent before 2026-10-08 render live.
GET  /job-offers/{id}/integrity/
POST /job-offers/{id}/integrity/verify/
POST /job-offers/{id}/integrity/retry-seal/      (HRManager/SystemAdmin only: 403; 422 when not sealing)
     Access: HR/SystemAdmin within accessible companies, the CEO recorded as ceo_decision_by,
     the HR user recorded as hr_signer_user (the sender); 404 anyone else; 401 anonymous.
     Routed explicitly (APIView module): a GenericViewSet using DocumentIntegrityActionsMixin
     via as_view({...}), so payloads and 404/403/422 rules are the shared ones.
```

**Freeze points / versions** (`FrozenDocument.version`, the existing re-freeze mechanism):

| Version | Trigger | Why |
|---|---|---|
| v1 | `JobOfferSendView` (`status=sent`), on commit, **before** delivery | the form's HR signature date is the send date and the HR signer is set at send; CEO box already signed |
| v2 | `JobOfferRespondView.post` (`accepted` / `rejected`), on commit | the acceptance block (decision, name, date, rejection reason) is now filled |

CEO approval does **not** freeze (only a personal-mode attestation). Cancel/expiry after
sending keeps the last frozen copy. CEO "request changes"/reject never freeze.

**Candidate copy**: `deliver_job_offer` now sends the frozen v1 bytes (WhatsApp document,
Bird e-mail attachment, CEO copies). Live render only when nothing is frozen (mode `off` or a
logged freeze failure); a frozen copy that fails its hash is never replaced by a live render
(delivery reports "PDF generation failed"). The send response's
`delivery.pdf = {"frozen": bool, "version": int|null, "sha256": str|null}` is **additive**
(also stored in `delivery_metadata`).

**Superseded versions (shared-code change, additive)**: after v2, the candidate's v1 copy no
longer equals the current hash. `verify_uploaded_pdf` now also matches the hash of an earlier
version via the re-freeze event metadata (`previous_sha256`, and the new
`previous_unsigned_sha256` that `freeze_document` records when the old version had a pre-seal
copy). Such a file is reported as genuine (`frozen_valid`, or `sealed_valid`/`signed_valid` by
its own signatures) with `matched_record.superseded_version = <n>` (key present **only** for
superseded matches) and a distinct English `summary` ("earlier approved version ... newer
version has since been issued"). Leave HR-manual re-freezes benefit the same way (previously
an old copy came back `tampered`).

**Stage signers / trail roles**: `ceo` (CEO, `ceo_decision_by/_at`, "Approved", only when
`approval_status=approved`), `hr` (HR, `hr_signer_user` at `sent_at`, "Sent"), `candidate`
(Candidate, `actor=None`, `accepted_at` "Accepted" / `rejected_at` "Declined"; shows "-" as the
name, the trail Subject line carries the candidate name). Personal-mode attestations: CEO at
approval, HR at send; the candidate never signs (no account). v1 and v2 are each signed by
CEO + HR, then sealed.

**Access decision (candidate)**: integrity endpoints are never exposed to unauthenticated users;
the public response token (`/job-offers/respond/`) opens nothing here. The candidate's later
employee account gets no access either (the internal job-offer PDF and its events are HR/CEO
records). HR checks a candidate's copy with `POST /api/documents/verify-upload/`.

Caveats: `freeze_approved_document --type job_offer` accepts every post-send status (`sent`,
`accepted`, `rejected`, `expired`, `cancelled`) of an offer that was actually sent (`sent_at`;
a draft can also be cancelled) and freezes the document as it stands: an answered offer is
recovered with its answer (the v2 content, as v1 if nothing was frozen), an expired/cancelled one
as sent (empty acceptance block, like v1). If v1 exists and only the v2 freeze failed, use
`--force`. The v1 freeze runs inline in HR's send request and the v2 freeze in the candidate's
anonymous answer request (seal mode adds a TSA call, up to `TSA_TIMEOUT`). Fallback-template
offers (no company template) print "Status", which can later read differently from the frozen
copy (expected: the frozen copy is the document as sent/answered).

## Starting work

Implemented 2026-10-08 (backend), same module. Registry key `starting_work_acknowledgment`;
`matched_record.type = "starting_work"`; label "Starting Work Acknowledgment";
reference = `StartingWorkAcknowledgment.reference_number`.

```
GET  /starting-work-acknowledgments/{id}/pdf/                    (no /api prefix; HR only, unchanged)
     Frozen copy once approved (Content-Type application/pdf, original filename kept);
     409 when missing/altered; ?workpaper=1&tz=<IANA>. Pending/rejected/voided and
     pre-rollout rows serve the stored EmployeeDocument as before (404 if missing).
GET  /starting-work-acknowledgments/{id}/integrity/
POST /starting-work-acknowledgments/{id}/integrity/verify/
POST /starting-work-acknowledgments/{id}/integrity/retry-seal/   (HRManager/SystemAdmin only)
     Access: HR/SystemAdmin within accessible companies, or the recorded approver
     (approved_by); the employee gets 404 (HR-only document); 401 anonymous.
```

**Freeze point**: `job_offers.starting_work_service.approve_starting_work_acknowledgment`
(→ `approved`, also from `rejected`), on commit. One version. Rejected/voided never freeze.

**Stored-file reconciliation**: the approval still re-renders the form into the employee's
`EmployeeDocument` (unchanged). The freeze then reads **those stored bytes** (no rebuild from
current profile data), stamps the hidden reference, freezes/seals, and finally writes the frozen
(sealed when sealing ran inline) bytes back into the same `EmployeeDocument`
(`extracted_fields.frozen_document_id/frozen_sha256` added, `hr_only` kept), so the
employee-documents copy, the WhatsApp loader and the integrity endpoint all refer to one
byte-identical file. Failures are logged (`document_integrity.starting_work_sync_failed`) and
never undo the approval. Caveats: a seal that only succeeds later via `retry-seal` leaves the
unsealed frozen copy in `EmployeeDocument` (it still verifies as `frozen_valid` via the pre-seal
hash); do not use `freeze_approved_document --force` on an already sealed acknowledgement (the
render reads the stored, already sealed file).

**Stage signers / trail roles**: `system` (System, `actor=None`, `generated_at`, "Generated"),
`hr` (HR, `approved_by/_at`, "Approved"). Personal-mode attestation: HR at approval. The form's
direct-superior / general-manager boxes have no recorded actor and are not signers.

**i18n role keys added by these two types**: `documentIntegrity.roles.candidate`,
`documentIntegrity.roles.system` (`ceo`, `hr` reused).

## Recovery command (final statuses)

`python manage.py freeze_approved_document --type <key> --id N [--force]` reads the accepted
statuses from the adapter (`DocumentType.final_statuses`, plus `final_check` when set) - the
single source of truth (2026-10-08; replaces the command's own `approved` + asset map). Any other
status is refused ("Only records in a final status (...) can be frozen."); `--force` (re-freeze as
a new version when a frozen copy exists) is unchanged. A type registered without
`final_statuses` defaults to `("approved",)`. Tests: `core/tests_freeze_approved_document.py`.

| Type key | Accepted statuses |
|---|---|
| `leave_request` | `approved` |
| `loan_request` | `approved`, `deducted` (a deducted loan renders with its payroll reference) |
| `permission_request` | `approved` |
| `annual_leave_payment_request` | `approved`, `carried_forward` |
| `job_offer` | `sent`, `accepted`, `rejected`, `expired`, `cancelled` - only when `sent_at` is set |
| `starting_work_acknowledgment` | `approved` (never `--force` an already sealed one, see "Starting work") |
| `asset_return_request` | `PROCESSED` |
| `asset_damage_report` | `APPROVED` |
| `contract_rating` | `DECIDED` |

## Contract ratings

Implemented 2026-10-08 (backend), **option B**: one canonical frozen document per rating, no
migration, no core change. Code: `Backend/contract_ratings/document_integrity.py` (registered in
`ContractRatingsConfig.ready()`), hooks in `contract_ratings/services.py`, routes on
`ContractRatingViewSet` (`DocumentIntegrityActionsMixin`), tests
`contract_ratings/tests/test_document_integrity.py`. Registry key `contract_rating`;
`matched_record.type = "contract_rating"`; label "Contract Rating Decision".

```
GET  /contract-ratings/{id}/pdf/                       (no /api prefix; DefaultRouter, trailing slash required)
     Access unchanged (viewer_role): HR/CEO get the decision copy, the employee their self-rating
     copy, the manager their rating copy. Decision copy (role hr - only after a CEO comment request,
     else 403 as before - or ceo): the frozen copy once DECIDED; 409 when missing/altered
     (AuditLog document_download_blocked); HR-only ?workpaper=1&tz=<IANA>
     (contract_rating_<ref>_workpaper.pdf); still application/pdf, contract_rating_<ref>.pdf.
     Live render (503 "PDF unavailable" when the template is missing) only when nothing is frozen.
     Employee/manager copies: unchanged live renders, never frozen, not the verifiable original.
GET  /contract-ratings/{id}/integrity/
POST /contract-ratings/{id}/integrity/verify/
POST /contract-ratings/{id}/integrity/retry-seal/      (HRManager/SystemAdmin only: 403; 422 when not sealing)
     Access = exactly the decision-copy viewers: viewer_role "ceo" (the CEO who decided) or "hr"
     with hr_comment_requested_at set, within the company-scoped get_queryset; 404 for the rated
     employee (whatever role they hold), the manager, HR without a comment request, another CEO,
     other-company HR and everyone else; 401 anonymous.
POST /api/documents/verify-upload/   ->  matched_record.type = "contract_rating"
     A rating is only named to an uploader who passes the same viewer_role rule (never the rated
     person, never HR without a comment request).
```

* **Freeze point**: `contract_ratings.services.submit_ceo_decision` when the rating ends `DECIDED`
  (after commit; a renew-with-increase that falls into `MANUAL_RESOLUTION_REQUIRED` is not frozen).
  CEO returns (`RETURN_TO_*`) never freeze. Render = `build_contract_rating_pdf(rating,
  response=rating.manager_response, include_decision=True)`, exactly what HR/CEO downloaded live.
  A failure (incl. the missing-template `ValueError`) is logged
  (`document_integrity.finalize_failed`) and never undoes the decision; the download then keeps
  rendering live. No backfill; recovery `freeze_approved_document --type contract_rating --id N`.
* **Late HR comment**: `submit_hr_comment` is allowed after the decision and prints the HR name and
  signature on the decision copy, so when it changes the HR signer of an already frozen rating the
  copy is re-frozen as a new version (v1 hash kept in the event metadata; verify-upload reports a v1
  copy as `superseded_version: 1`). The same HR re-commenting (text only, not printed) does not
  re-freeze. Ratings decided before the rollout are not frozen by a late comment.
* **Stage signers / trail roles** (recorded users and times only): `line_manager` (manager response
  `submitted_by/_at`, "Rated"; absent in SKIP_TO_CEO), `hr` (`hr_comment_by` /
  `hr_comment_submitted_at`, "Commented", if any), `ceo` (`ceo_decided_by/_at`, "Decided"). No new
  role keys. Personal-mode attestations at manager response, HR comment and CEO decision. The
  employee's self-rating is not on the decision copy and the employee is not a signer.
* Reference = the printed one: `public_reference_for(rating)` or `CR-{id}`.
* **Caveats**: the employee/manager live copies print the same reference, so if HR uploads one of
  them to verify-upload it is matched by the visible reference and reported `tampered` (it is not
  the decision copy). The PDF still uses `signature_for_user` (no profile-name fallback). A rating
  later moved to `MANUAL_RESOLUTION_REQUIRED` keeps its frozen copy (what the CEO decided).
