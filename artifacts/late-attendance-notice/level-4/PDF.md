# Late Attendance Notice Level 4 PDF Handoff

## Status

This is the approved design-stage asset for the fourth and later late-attendance occurrences. It is intentionally stored outside `Backend/static/pdf_templates` and does not change the backend. Do not move or implement it until the other notice levels are visually approved.

## Asset pair

- Blank template: `late_attendance_level_4_blank.pdf`
- Coordinate map: `late_attendance_level_4_blank_field_map.json`
- Approved visual reference: `approved-level-4-style-reference.png`

The PDF and JSON map are one versioned pair. They must always be copied, reviewed, and deployed together. Coordinates use points with a bottom-left origin on one A4 page (`595.2756 x 841.8898`).

## Level 4 policy copy

Use only the fourth-and-later-occurrence policy. The rendered notice must visibly include both:

- English: `Critical final warning - 50% daily-rate deduction.`
- Arabic: `إنذار نهائي حرج - خصم بنسبة ٥٠٪ من الأجر اليومي.`

Do not add termination, legal, payroll-pending, or any other consequence beyond the agreed 50% daily-rate deduction.

## Layout requirements preserved by this asset

- Bilingual English/Arabic title and Level 4 critical/final-warning badge.
- Deep charcoal and dark-crimson critical/final-warning accent with the approved FFI orange divider and contact footer.
- Employee data grid for name, code, department, position, violation date, first check-in, scheduled shift start, and minutes late.
- Visible blank HR signature box. It must be manually signed only; the map explicitly sets `auto_sign: false`.
- The selected design’s promotional `Building a Better Tomorrow` mark is absent.

## Field-map JSON

```json
{
  "template": "late_attendance_level_4_blank.pdf",
  "version": 1,
  "coordinate_origin": "bottom_left",
  "page_size": { "width": 595.2756, "height": 841.8898, "unit": "pt" },
  "fields": {
    "notice_reference": { "page": 1, "x": 409, "y": 764, "width": 98, "height": 10 },
    "issue_timestamp": { "page": 1, "x": 409, "y": 744, "width": 98, "height": 10 },
    "employee_name": { "page": 1, "x": 174, "y": 571, "width": 239, "height": 14 },
    "employee_code": { "page": 1, "x": 174, "y": 548, "width": 239, "height": 14 },
    "department": { "page": 1, "x": 174, "y": 524, "width": 239, "height": 14 },
    "position": { "page": 1, "x": 174, "y": 501, "width": 239, "height": 14 },
    "violation_date": { "page": 1, "x": 174, "y": 477, "width": 239, "height": 14 },
    "actual_first_check_in": { "page": 1, "x": 174, "y": 454, "width": 239, "height": 14 },
    "scheduled_shift_start": { "page": 1, "x": 174, "y": 430, "width": 239, "height": 14 },
    "minutes_late": { "page": 1, "x": 174, "y": 407, "width": 239, "height": 14 },
    "hr_representative_name": { "page": 1, "x": 59, "y": 151, "width": 115, "height": 13 },
    "hr_representative_title": { "page": 1, "x": 59, "y": 138, "width": 115, "height": 12 },
    "hr_signature_image": { "page": 1, "x": 186, "y": 157, "width": 216, "height": 52, "kind": "image", "auto_sign": false }
  }
}
```

The complete machine-readable map, including typography, colors, signature policy, and integration notes, is `late_attendance_level_4_blank_field_map.json`.

## Backend handoff constraints for later

1. Use the repository's map-driven PDF overlay mechanism and keep the template/map colocated.
2. Render the active company name and logo through the existing brand-asset mechanism. This design reference contains the supplied FFI logo only as the approved visual example. If no active-company logo exists, render a clearly labeled `Company logo` placeholder.
3. Preserve raw BioTime punches as immutable evidence; do not place or modify those punches inside the PDF artifact.
4. Do not auto-sign. The HR signature box stays blank until a manual HR action provides a permitted signature.
5. The approved visual has no separate blank zones for occurrence number, reason, penalty percentage/amount, or payroll status. Add those areas only after a specific Level 4 layout amendment is approved. Do not invent coordinates or cover the preprinted bilingual letter copy.
6. The delivery workflow, authorization, notifications, idempotency, audits, payroll preservation, and migrations are deliberately out of scope for this design-stage asset and must be handled by the later backend handoff.
