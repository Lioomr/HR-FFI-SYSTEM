# Request form template assets

Each supported request form is **one asset pair**: the blank PDF that HR approved
and the field map that names every printable box on it. Deploy both files
together in the same directory. When `HR_TEMPLATES_DIR` is mounted it must
contain both; a template without its paired map intentionally falls back to the
generic request renderer instead of applying coordinates measured against a
different PDF.

| Form | Template | Field map | Renderer |
|---|---|---|---|
| Leave request | `leave_request_blank.pdf` | `leave_request_blank_field_map.json` | `leaves/pdf_leave_request.py` |
| Loan request | `loan_request_blank.pdf` | `loan_request_blank_field_map.json` | `loans/pdf_loan_request.py` |
| Annual entitlements disbursement | `annual_entitlements_disbursement_blank.pdf` | `annual_entitlements_disbursement_blank_field_map.json` | `leaves/pdf_annual_entitlements.py` |
| Job offer | `job_offer_blank.pdf` | `job_offer_blank_field_map.json` | `job_offers/pdf.py` |
| Starting work acknowledgment | `starting_work_acknowledgment_blank.pdf` | `starting_work_acknowledgment_blank_field_map.json` | `job_offers/starting_work_pdf.py` |

`asset_damage_report_blank.pdf`, `asset_return_request_blank.pdf`, and
`rent_agreement_blank.pdf` ship **without** a field map. They remain available
for download from the template library, but no renderer fills them; those
domains keep the generic `core.pdf.render_request_pdf` output until a map is
authored and verified against the actual PDF.

## How a map is applied

All five pairs render through `core/pdf_forms.py`. No renderer carries
coordinates of its own. Both map schemas in the bundle are accepted:

```jsonc
// flat
{ "employee_name": { "page": 1, "x": 102, "y": 682.89, "width": 406, "height": 19, "font_size": 7.8 } }

// versioned
{ "template": "loan_request_blank.pdf", "version": 3, "coordinate_origin": "bottom_left",
  "fields": { "employee_name": { "page": 1, "x": 102, "y": 692 } } }
```

Coordinates use the PDF's own bottom-left origin, 1 unit = 1 point. Field kinds:

- **text** - centred in its box unless the spec sets `align`; honours
  `font_size`, `shrink`, `multiline`, `max_lines`, `padding`.
- **checkbox** - `{"checkboxes": {"yes": [x, y], "no": [x, y]}}`; the renderer
  ticks the anchor whose key matches the value.
- **image** - `{"kind": "image"}`; only signature images are drawn here, and only
  for the actor the workflow recorded for that stage.

Where a map lets a signature box overlap a printed value (the loan approval
columns, the acknowledgment approval rows), the image is confined to the free
part of its own box so it can never bury that value. The one exception is a
`*_signature_image` whose exact twin `*_signature` text field is the same slot -
a real signature supersedes its typed placeholder.

Signature images come from `EmployeeProfile.signature`, resolved for the actor
the workflow recorded for that stage. The job offer's `hr_signature_image`
targets the template's printed `Signature` rule beneath the HR name and position
boxes - never the boxes themselves.

Some boxes the maps declare are **pre-printed on the template** and must be left
alone. `annual_entitlements_disbursement_blank_field_map.json` declares
`letter_body`, but the template already prints that bilingual declaration; the
renderer lists it in `PRE_PRINTED_FIELDS` and never writes there.

## Regenerating a blank form

```bash
python static/pdf_templates/generate_leave_request_final.py
python static/pdf_templates/generate_annual_entitlements_final.py
python static/pdf_templates/generate_job_offer_final.py
python static/pdf_templates/generate_starting_work_final.py
python loans/scripts/generate_loan_request_template.py
```

Regenerating rewrites the PDF **and** its map together. Never ship one without
the other.

## Verifying a change

```bash
docker exec ffi_hr_backend pytest core/tests_pdf_forms.py core/tests_pdf_signers.py leaves/tests/test_pdf_leave_request.py leaves/tests/test_pdf_annual_entitlements.py loans/tests_pdf.py loans/test_pdf_permissions.py job_offers/tests/test_pdf.py core/tests_templates.py -q
```

For visual QA, generate a PDF from a representative record and render page 1 to
PNG with PyMuPDF. Keep that evidence outside this directory - it is production
asset storage, not a scratch area.
