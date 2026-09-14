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
| Exit permission request | `exit_permission_request_blank.pdf` | `exit_permission_request_blank_field_map.json` | `permission_requests/pdf_permission_request.py` |
| Annual entitlements disbursement | `annual_entitlements_disbursement_blank.pdf` | `annual_entitlements_disbursement_blank_field_map.json` | `leaves/pdf_annual_entitlements.py` |
| Job offer | `job_offer_blank.pdf` | `job_offer_blank_field_map.json` | `job_offers/pdf.py` |
| Starting work acknowledgment | `starting_work_acknowledgment_blank.pdf` | `starting_work_acknowledgment_blank_field_map.json` | `job_offers/starting_work_pdf.py` |
| Late attendance notice v3, level 1 (occurrence 1) | `late_attendance_level_1_blank_v3.pdf` | `late_attendance_level_1_field_map_v3.json` | `attendance/late_notices.py` |
| Late attendance notice v3, level 2 (occurrence 2) | `late_attendance_level_2_blank_v3.pdf` | `late_attendance_level_2_field_map_v3.json` | `attendance/late_notices.py` |
| Late attendance notice v3, level 3 (occurrence 3) | `late_attendance_level_3_blank_v3.pdf` | `late_attendance_level_3_field_map_v3.json` | `attendance/late_notices.py` |
| Late attendance notice v3, level 4 (occurrence 4+) | `late_attendance_level_4_blank_v3.pdf` | `late_attendance_level_4_field_map_v3.json` | `attendance/late_notices.py` |
| Late attendance notice v2, level 1 (retained) | `late_attendance_level_1_blank_v2.pdf` | `late_attendance_level_1_field_map_v2.json` | none (historical) |
| Late attendance notice v2, level 2 (retained) | `late_attendance_level_2_blank_v2.pdf` | `late_attendance_level_2_field_map_v2.json` | none (historical) |
| Late attendance notice v2, level 3 (retained) | `late_attendance_level_3_blank_v2.pdf` | `late_attendance_level_3_field_map_v2.json` | none (historical) |
| Late attendance notice v2, level 4 (retained) | `late_attendance_level_4_blank_v2.pdf` | `late_attendance_level_4_field_map_v2.json` | none (historical) |
| Late attendance notice v1, level 1 (retained) | `late_attendance_level_1_blank.pdf` | `late_attendance_level_1_blank_field_map.json` | none (historical) |
| Late attendance notice v1, level 2 (retained) | `late_attendance_level_2_blank.pdf` | `late_attendance_level_2_blank_field_map.json` | none (historical) |
| Late attendance notice v1, level 3 (retained) | `late_attendance_level_3_blank.pdf` | `late_attendance_level_3_blank_field_map.json` | none (historical) |
| Late attendance notice v1, level 4 (retained) | `late_attendance_level_4_blank.pdf` | `late_attendance_level_4_blank_field_map.json` | none (historical) |

**Version 3 is the active version.** New late-attendance notices render only on
the version 3 pairs, byte-identical copies of
`artifacts/late-attendance-notice/v3/level-*/` (map `version: 3`,
`asset_revision: 3`). The renderer refuses a map whose `template`, `version`,
`asset_revision`, or `style.level` does not match, or whose
`hr_signature_image` is not a manual-only image with `auto_sign: false`.

- `company_logo` is an image slot filled from the company's configured
  `OrganizationNode.logo`.
- v3's logo area is a neutral, opaque `#F8FAFC` surface with no visible or
  extractable `Company logo` or `شعار الشركة` text. Transparent and opaque logos
  both render cleanly on it, and without a usable logo the slot stays plain.
- The HR signature is never drawn.

**Versions 1 and 2 are retained historical versions.** Their pairs stay
deployed unchanged as the record for notices already issued on them
(`template_version = 1` or `2`). Those stored PDFs are never re-rendered,
replaced, or redelivered, and no new notice uses them. v2's logo area still
prints the placeholder label.

No version has a generator in this directory. Never edit or regenerate one file
without the other; a layout amendment is a new approved version.
`attendance/test_late_notice_delivery.py` pins the SHA-256 of every file.

`asset_damage_report_blank.pdf`, `asset_return_request_blank.pdf`, and
`rent_agreement_blank.pdf` ship **without** a field map. They remain available
for download from the template library, but no renderer fills them; those
domains keep the generic `core.pdf.render_request_pdf` output until a map is
authored and verified against the actual PDF.

## How a map is applied

Every mapped pair renders through `core/pdf_forms.py`. No renderer carries
coordinates of its own. Both map schemas in the bundle are accepted:

```jsonc
// flat
{ "employee_name": { "page": 1, "x": 102, "y": 682.89, "width": 406, "height": 19, "font_size": 7.8 } }

// versioned
{ "template": "loan_request_blank.pdf", "version": 4, "coordinate_origin": "bottom_left",
  "fields": { "employee_name": { "page": 1, "x": 102, "y": 692 } } }
```

Coordinates use the PDF's own bottom-left origin, 1 unit = 1 point. Field kinds:

- **text** - centred in its box unless the spec sets `align`; honours
  `font_size`, `shrink`, `multiline`, `max_lines`, `padding`.
- **checkbox** - `{"checkboxes": {"yes": [x, y], "no": [x, y]}}`; the renderer
  ticks the anchor whose key matches the value.
- **image** - `{"kind": "image"}`; only signature images are drawn here, and only
  for the actor the workflow recorded for that stage.

Every approved signature is mapped to an invisible image box centred in an
open, unruled white area. Adjacent names, decisions, and dates use their own
visible boxes. A real signature supersedes only its exact `*_signature` typed
placeholder, when such a compatibility field exists.

Signature images come from `EmployeeProfile.signature`, resolved for the actor
the workflow recorded for that stage. The job offer maps separate HR and CEO
signature areas; its external applicant has no signature field.

Some boxes the maps declare are **pre-printed on the template** and must be left
alone. `annual_entitlements_disbursement_blank_field_map.json` declares
`letter_body`, but the template already prints that bilingual declaration; the
renderer lists it in `PRE_PRINTED_FIELDS` and never writes there.

## Regenerating a blank form

```bash
python static/pdf_templates/generate_leave_request_final.py
python static/pdf_templates/generate_exit_permission_request.py
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
