# Late Attendance Notice Backend Handoff

## Objective

Implement the private, idempotent delivery workflow for bilingual late-attendance notices. Use the four visually approved PDF template/map pairs in this directory. Do not deploy.

## Approved asset manifest

| Level | Trigger | Policy result | Visual treatment | Blank PDF | Field map | Per-level handoff |
|---|---|---|---|---|---|---|
| 1 | Active occurrence `1`; penalty `0.00`; payroll status `null` | Warning only. No payroll deduction. | Blue informational warning | `level-1/late_attendance_level_1_blank.pdf` | `level-1/late_attendance_level_1_blank_field_map.json` | `level-1/PDF.md` |
| 2 | Active occurrence `2`; 5% daily-rate penalty | 5% daily-rate deduction | Amber formal caution | `level-2/late_attendance_level_2_blank.pdf` | `level-2/late_attendance_level_2_blank_field_map.json` | `level-2/PDF.md` |
| 3 | Active occurrence `3`; 10% daily-rate penalty | 10% daily-rate deduction | Burgundy serious warning | `level-3/late_attendance_level_3_blank.pdf` | `level-3/late_attendance_level_3_blank_field_map.json` | `level-3/PDF.md` |
| 4 | Every active occurrence `4+`; 50% daily-rate penalty | 50% daily-rate deduction | Critical/final warning, dark crimson/charcoal | `level-4/late_attendance_level_4_blank.pdf` | `level-4/late_attendance_level_4_blank_field_map.json` | `level-4/PDF.md` |

Each PDF and its JSON map are an inseparable versioned pair. Copy them together into the backend's configured PDF-template location only when implementation begins. Do not use the `approved-*-style-reference.png` files as production templates; they are retained visual references.

## Non-negotiable policy behavior

1. Level 1 is informational only. It must visibly say `Warning only - no payroll deduction.` and `تحذير فقط - لا يوجد خصم من الراتب.` Never call it pending, awaiting payroll, or deducted.
2. Level 2 must visibly state the 5% daily-rate deduction, Level 3 the 10% daily-rate deduction, and Level 4 the 50% daily-rate deduction. Do not invent disciplinary, termination, legal, or other consequences.
3. Level 4 applies separately to every active occurrence `4+`. Occurrence 4 and occurrence 5 therefore each receive their own Level 4 notice.
4. Never generate or deliver a notice for a voided violation, attendance-exempt violation, or a violation excused by a late permission.
5. Do not backfill legacy `AttendanceRecord` rows. Only create notices for newly qualifying violations in the new workflow.
6. Preserve raw BioTime punches as immutable evidence. Do not rewrite, normalize in place, or delete the source punches.
7. Do not alter finalized payroll totals.

## PDF rendering requirements

- Use the repository's existing map-driven PDF overlay mechanism. It preserves the HR-approved blank PDF and draws dynamic values only through the colocated JSON map.
- Render the active company name and actual company logo through the existing company/brand asset mechanism. Do not hardcode the supplied FFI logo. If no company logo is configured, retain a visible `Company logo` placeholder and record the missing configuration in the audit trail.
- Keep English/Arabic bilingual output and correct RTL shaping. Use Arabic-capable fonts already registered by the backend PDF utilities.
- Populate the approved mapped fields: notice reference, issue timestamp, employee name/code, department, position, violation date, first check-in when available, scheduled shift start, minutes late, HR representative name/title, and a blank HR signature area.
- The HR signature area must remain blank. Do not auto-sign and do not embed an employee or named person's signature. It is a manual HR-only field.

### Approved-layout limitation requiring user approval

The currently approved visual has no separate blank fields for `reason`, dynamic `occurrence_number`, `penalty_amount`, or `payroll_status`. The maps intentionally flag this rather than guessing coordinates over preprinted bilingual copy.

Before presenting the completed backend workflow as production-ready, obtain a focused layout amendment for those fields if they must be visibly displayed. Do not silently add boxes, cover the approved text, or reuse an unrelated area. The static policy wording already handles Level 1 no-deduction and Level 2-4 percentages.

## Suggested implementation shape

1. Add one notice record per qualifying violation with a unique database constraint on the violation and notice type/version. Store level, company, employee, reference number, generated PDF storage key, generated timestamp, and delivery state.
2. Create the record and PDF in a transaction after the current late-violation calculation establishes an active qualifying violation. Recalculation must reuse the existing record and skip another PDF/notification.
3. Render from the selected level's asset pair. Keep the template filename and map filename on a stable, reviewed selector, not dynamically supplied by a client request.
4. Store the rendered PDF in the existing private storage pattern. Return a short-lived, authorization-checked download endpoint or secure link, never a public media URL.
5. Create an in-app notification containing the secure private download link. Use configured email and WhatsApp attachment/secure-link patterns only where those channels are already enabled and supported. Do not add a new channel or send to a personal contact outside the configured employee channel.
6. Add auditable generated and delivered/scheduled events without putting private file paths, signed URLs, or punch payloads in logs.
7. Enforce company scope server-side: employees see only their own notice; HR and System Admin can access only notices belonging to their active company. Do not trust a client-supplied company ID.

## Required tests

- All four levels: selected PDF/title/style marker/localized title/policy wording/footer/logo behavior/blank HR signature field.
- Level 1: no monetary deduction, no payroll-pending language or state.
- Monetary policy accuracy: 5%, 10%, and 50% daily-rate deductions.
- Fourth and fifth occurrences: distinct Level 4 notice records and PDFs.
- Recalculation idempotency: no duplicate PDF, notification, or audit event.
- Exclusion cases: voided, exempt, and late-permission-excused violations generate nothing.
- Company scope and authorization for employee, HR, and System Admin; private download access; no cross-company access.
- Bilingual English/Arabic content and RTL rendering.
- In-app notification and configured email/WhatsApp behavior, including audit events.
- Finalized payroll totals unchanged; no legacy-row backfill.

## Required validation before review

Run the repository's configured Ruff check, Django system checks, migration-drift check, and focused database tests for the new workflow. Render one representative PDF from each level and visually inspect it at normal print scale. Report the exact command outcomes in the final implementation handoff.

## Ready-to-send backend-agent prompt

```text
Implement the late-attendance notice PDF delivery workflow described in
artifacts/late-attendance-notice/BACKEND_HANDOFF.md. Use all four approved
template/map pairs there and read each level's PDF.md before coding. Do not
deploy. Follow existing map-driven PDF, private storage, company-scoping,
notification, and audit patterns in this repository.

Meet every policy, authorization, idempotency, exclusion, notification, and
test requirement in the handoff. Preserve finalized payroll and immutable raw
BioTime punches. Do not backfill legacy AttendanceRecord rows. Do not invent
disciplinary or legal consequences.

Important visual constraint: do not alter the approved layouts or add fields
over their preprinted copy. The handoff identifies unresolved visual zones for
reason, occurrence number, dynamic penalty amount, and payroll status; request
the specified layout amendment before claiming those display requirements are
complete.

Return changed files/migrations, visual QA evidence, all validation commands
and exact outcomes, known blockers, and “Ready for deployment-agent review.”
```
