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

Leave and loan downloads intentionally use the blank template PDF as the visual base, then add a ReportLab overlay and merge it with `pypdf`.

Keep this behavior:
- Preserve the original template pages.
- Do not recreate leave/loan forms as a clean one-off generated layout.
- Leave missing optional fields blank; avoid placeholder dashes in professional forms.
- Mask internal gray input underlines before drawing values, so text appears inside the field boxes.
- Draw values centered within their field boxes and keep approval table values centered in their own cells.
- Use human labels such as `Pending`, `Approved`, and `Rejected`; never leak raw enums like `pending_hr`.
- Keep the older generic `core.pdf.render_request_pdf(...)` path only as a fallback if the template cannot be resolved.

## Implemented Files

Leave:
- Renderer: `Backend/leaves/views.py`, `_build_leave_request_pdf`
- Fallback: `_build_leave_request_pdf_fallback`
- Test: `Backend/leaves/tests/test_existing.py::LeaveManagementTests.test_employee_can_download_leave_request_pdf`

Loan:
- Renderer: `Backend/loans/views.py`, `_build_loan_request_pdf`
- Fallback: `_build_loan_request_pdf_fallback`
- Test: `Backend/loans/tests_pdf.py::test_build_loan_request_pdf_returns_pdf_bytes`

## Verification Workflow

When changing template fills:
1. Run the PDF skill form check first:
   `python .agents/skills/pdf/scripts/check_fillable_fields.py Backend/static/pdf_templates/<template>.pdf`
2. For non-fillable templates, extract structure:
   `python .agents/skills/pdf/scripts/extract_form_structure.py Backend/static/pdf_templates/<template>.pdf output/<template>_structure.json`
3. Rebuild backend if using Docker:
   `docker compose -f docker-compose.dev.yml up -d --build backend`
4. Run targeted tests:
   `docker exec ffi_hr_backend pytest loans/tests_pdf.py -q`
   `docker exec ffi_hr_backend python manage.py test leaves.tests.test_existing.LeaveManagementTests.test_employee_can_download_leave_request_pdf`
5. Generate a sample PDF from the system and render to PNG with PyMuPDF (`fitz`) for visual inspection.

## Production Notes

Production compose mounts `/hr/templates:/hr/templates:ro` and should set `HR_TEMPLATES_DIR=/hr/templates`.

Deployment-related work must follow `AWS_AGENT_DEPLOYMENT_HANDOFF.md`. Production compose commands must run from `/opt/hr-ffi`.
