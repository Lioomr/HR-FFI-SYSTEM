# PDF Template Library

Use this context when changing request PDF downloads or blank HR template downloads.

## Source Of Truth

Blank HR forms live in the template library:
- Production: `/hr/templates`
- Local fallback/bundled defaults: `Backend/static/pdf_templates`

Resolve templates through `core.views_templates.resolve_template_path(...)`. Do not hard-code only the bundled path, because production must prefer `/hr/templates`.

Current catalog entries include:
- `leave_request_blank.pdf`
- `loan_request_blank.pdf`
- asset/rent/certificate templates in `Backend/core/views_templates.py`

## Current Request PDF Pattern

Every supported request form is rendered by the shared, map-driven renderer in
`Backend/core/pdf_forms.py`. Individual views must not carry coordinates.

Keep this behavior:
- Template and field map are **one pair**, resolved from the same directory.
  `load_form_assets(template, map)` prefers `HR_TEMPLATES_DIR` and reads the map
  from the *resolved* template's own folder, so a production PDF is never filled
  with coordinates measured against the bundled PDF.
- A template with no colocated map returns `None` and the caller takes its
  documented fallback. Never fill from a map found in a different directory.
- Preserve the original template pages; draw an overlay and merge it.
- Leave missing optional fields blank; avoid placeholder dashes.
- Draw values centered within their field boxes unless the map sets `align`.
- Use human labels such as `Pending`, `Approved`, `Rejected`; never leak raw
  enums like `pending_hr`.
- Keep `core.pdf.render_request_pdf(...)` only as the fallback when the pair
  cannot be resolved.

## Signatures

`Backend/core/pdf_signers.py` resolves a signature from the actor the workflow
recorded for that stage - never from the user downloading the PDF. A stage
nobody completed yields `None`, the mapped box stays blank, and
`log_signature_diagnostics` records the gap (field name and state only; never
bytes, storage paths, or tokens).

Storage is `EmployeeProfile.signature` (`FileField`, `PrivateUploadStorage`,
`upload_to="employee_signatures/"`) plus `signature_uploaded_at`. One reusable
signature per employee; uploading a new one replaces and deletes the old file.

API (on `EmployeeProfileViewSet`, so both `/employees/...` and `/api/employees/...`):

| Method | Path | Who |
|---|---|---|
| `GET` | `/employees/{id\|me}/signature` | owner, or HR/SystemAdmin in the same company |
| `POST` | `/employees/{id\|me}/signature` | **owner only** - multipart `signature` field |
| `DELETE` | `/employees/{id\|me}/signature` | owner, or HR/SystemAdmin |
| `GET` | `/employees/{id\|me}/signature/preview` | owner, or HR/SystemAdmin |

HR and SystemAdmin can read and delete but **cannot upload for someone else**:
storing a signature in another person's name would forge a mark that appears on
official forms. Uploads accept PNG/JPG/JPEG only, validated by extension,
declared content type, and magic bytes, capped by
`MAX_EMPLOYEE_SIGNATURE_SIZE_BYTES` (2 MB default). SVG and PDF are refused.

Audit events: `employee_signature_uploaded`, `employee_signature_replaced`,
`employee_signature_deleted`, `employee_signature_previewed` - metadata carries
only `employee_profile_id`, `company_id`, `replaced`, and `size_bytes`.

Signatures are only ever drawn into a `kind: "image"` field the approved map
declares. Where a signature box overlaps another mapped value, the image is
confined to the free part of its own box rather than covering that value.

## Implemented Files

| Form | Renderer | Test |
|---|---|---|
| Leave | `leaves/pdf_leave_request.py` | `leaves/tests/test_pdf_leave_request.py` |
| Loan | `loans/pdf_loan_request.py` | `loans/tests_pdf.py`, `loans/test_pdf_permissions.py` |
| Annual entitlements | `leaves/pdf_annual_entitlements.py` | `leaves/tests/test_pdf_annual_entitlements.py` |
| Job offer | `job_offers/pdf.py` | `job_offers/tests/test_pdf.py` |
| Starting work | `job_offers/starting_work_pdf.py` | `job_offers/tests/test_pdf.py` |
| Shared renderer | `core/pdf_forms.py`, `core/pdf_signers.py` | `core/tests_pdf_forms.py`, `core/tests_pdf_signers.py` |

Fallbacks: `leaves/views.py::_build_leave_request_pdf_fallback`,
`loans/views.py::_build_loan_request_pdf_fallback`,
`job_offers/pdf.py::_fallback_pdf`, `job_offers/starting_work_pdf.py::_fallback_pdf`.

**Blocked forms**: `asset_damage_report`, `asset_return_request`, and
`rent_agreement` have no supplied field map. Do not author one without measuring
it against the actual PDF and attaching visual evidence.

**Job offer HR signature**: `hr_signature_image` targets the template's own
printed `Signature` rule (x 76-174, y 115.39, height 13), measured from the
rules the generator draws at `bot(727)` and `bot(713)`. It previously spanned
the HR name and position boxes and was reported unplaceable. Do not move it back
over those boxes.

## Verification Workflow

When changing template fills:
1. Confirm the template is non-fillable (all bundled request forms are: single
   A4 page, no AcroForm) and inspect its structure with `pypdf` + PyMuPDF before
   trusting any coordinate.
2. Validate the map against the PDF: every box must fall inside the page, and
   overlapping boxes must be intentional.
3. Rebuild backend if using Docker:
   `docker compose -f docker-compose.dev.yml up -d --build backend`
4. Run the owned PDF tests:
   `docker exec ffi_hr_backend pytest core/tests_pdf_forms.py core/tests_pdf_signers.py leaves/tests/test_pdf_leave_request.py leaves/tests/test_pdf_annual_entitlements.py loans/tests_pdf.py loans/test_pdf_permissions.py job_offers/tests/test_pdf.py core/tests_templates.py -q`
5. Generate a sample PDF from a representative record and render to PNG with
   PyMuPDF for visual inspection. Store that evidence outside
   `Backend/static/pdf_templates/`.

## Production Notes

Production compose mounts `/hr/templates:/hr/templates:ro` and should set `HR_TEMPLATES_DIR=/hr/templates`.

Deployment-related work must follow `AWS_AGENT_DEPLOYMENT_HANDOFF.md`. Production compose commands must run from `/opt/hr-ffi`.
