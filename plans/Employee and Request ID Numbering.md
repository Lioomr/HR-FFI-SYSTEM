# Employee and request ID numbering

Status: local implementation and production mapping prepared, 2026-10-04. This document is the handoff for agents changing employee-facing identifiers. No production identifier has been changed by this work. Run the per-company mapping and reference checks before each migration.

## Agreed format

- Reserve suffixes `0001` and `0002` in each company for Fathi Fouad Itani (CEO) and Abdulaal Ridha (GM), respectively. Their current employee profiles exist in FFI only; these slots remain reserved in Aseco Pro and Athroya until profiles exist there.
- FFI: `FFI-0001`, `FFI-0002`, then `FFI-0003` for MD Julfiker Ali. His saved hire date ties with archived Mohamed Sami Ibrahim Riad; the user selected MD Julfiker for `0003`.
- Aseco Pro: `ASECO-0001`, `ASECO-0002`, then employees beginning at `ASECO-0003`.
- Athroya: `ATH-0001`, `ATH-0002`, then employees beginning at `ATH-0003`.
- Order each company's other profiles by the authoritative hire date, then database profile ID for ties. Include archived profiles and never reuse their numbers. Athroya profiles without a saved hire date go after dated profiles, ordered by profile creation time. The hire-date source for conflicting raw imports remains to be confirmed.
- Leave request display reference: `LV-` + full employee ID + a two-digit per-employee request sequence, e.g. `LV-FFI-000101`. Define an overflow rule before any employee creates a 100th leave request; never truncate or reuse a reference. Keep numeric primary keys for routes, foreign keys, workflow, and authorization.
- Search should accept current ID and historical aliases. Employee-linked references must retain the company prefix, because `0001` repeats across companies.

## Production inventory and provisional `0003`

| Company | Profiles | Provisional `0003` | Current ID | Saved hire date | Issue |
| --- | ---: | --- | --- | --- | --- |
| FFI | 61 | MD Julfiker Ali | `FFI-504054` | 2023-05-01 | Explicit user tie-break; another profile has the same date. |
| Aseco Pro | 6 | Nawal Ali Saad Alkhathami | `ASECO-050153` | 2025-04-12 | Mohamed Samy Al Ansari has raw 2023-05-01 but saved 2025-10-17. |
| Athroya | 8 | Mahmoud Saber Helal Khalil | `ATH-931731` | 2025-04-10 | Yasser has raw 2025-01-11 but saved 2025-12-15; two profiles have no saved date. |

FFI also has a raw/saved date conflict for Abdullah Abdulwahab Alshehri (raw 2024-01-08, saved 2024-08-01). Athroya has an archived profile with an `FFI-` code and no hire date. Verify these against source personnel records before finalizing every company mapping.

## Migration boundaries for each company

1. Export an immutable old-ID to new-ID map keyed by `EmployeeProfile.id`, with company, saved and raw hire dates, archive status, and the chosen ordering rule. Review collisions, ties, null dates, and the reserved CEO/GM slots.
2. Keep `EmployeeProfile.id` and all relational foreign keys unchanged. Add a durable alias from each historical employee code to its profile so old records and searches still resolve.
3. Inspect text copies and document references before renumbering. `PayrollRunItem.employee_id` stores a text snapshot; payroll deduction matching currently compares it to the current profile code. Update that matching and each draft item deliberately. Preserve paid payroll snapshots. `StartingWorkAcknowledgment.reference_number` and saved PDFs can embed the old code; retain the historical reference and make it searchable. Late notice references (`LAN-...`) use company and violation IDs and should remain as issued.
4. Change all employee creation paths together: HR manual create, Excel import, and prehire profile creation. Allocate the next free number atomically within a company; concurrent hires must not collide. Reserved and archived numbers remain unavailable.
5. Give leave requests their own immutable public reference and per-employee sequence. Backfill existing requests in a documented chronological order, and expose the reference in search, API, list/detail, and future PDFs. Preserve old numeric request routes and previously issued PDF references as aliases or historical snapshots.
6. Migrate and verify one company at a time. Reconcile profile counts, payroll item matches, document references, search results, and request links after each company. Record an audit trail and a rollback mapping. Do not rewrite already issued PDFs.

## Reviewed mapping artifacts and rollout order

- `plans/employee-id-mapping-ffi.md` and `.csv`: 61 current FFI profiles. Fixed IDs: Fathi `FFI-0001`, Abdulaal `FFI-0002`, MD Julfiker `FFI-0003`.
- `plans/employee-id-mapping-aseco.md` and `.csv`: 6 current Aseco Pro profiles, starting at `ASECO-0003`.
- `plans/employee-id-mapping-athroya.md` and `.csv`: 8 current Athroya profiles, starting at `ATH-0003`. Two missing hire dates are sorted last by profile creation time, per user direction.
- Ordering currently uses the saved structured `hire_date`; every conflicting `hire_date_raw` is listed in its company mapping document. A roster change, hire-date edit, or changed code requires a new preview and reviewed CSV before applying.

After deploying the code and schema migrations, run `python manage.py migrate_employee_ids --company-code CODE --csv /path/to/company.csv` as a preview, then the same command with `--apply` for exactly one company. Run `python manage.py backfill_leave_references --company-code CODE` as a preview, then with `--apply`. Repeat for the next company only after verifying the prior company's profile codes, old-code search, draft payroll rows, leave references, and audit entries. The commands default to preview. The employee allocator retains legacy random codes for a company until its entire roster is migrated, then issues sequential codes under a company lock.

This clean rollout checkout starts from production commit `2eb130fc` and depends on employee migration `0027`; its employee alias migration is `0028_employee_id_alias`. The main local checkout has unrelated uncommitted employee migrations `0028` and `0029`, so merge these migration histories deliberately before returning changes to that checkout. The leave schema was at `0028` in production and the new leave reference migration is `0029` in this rollout.

## Current code entry points

- `Backend/employees/views.py`: manual employee ID generation.
- `Backend/employees/services/importer.py`: Excel import ID generation.
- `Backend/job_offers/services.py`: prehire ID generation.
- `Backend/payroll/services.py`: deduction matching by employee ID string.
- `Backend/payroll/models.py`: payroll run item text snapshot.
- `Backend/leaves/models.py`, `Backend/leaves/serializers.py`, and `Backend/leaves/pdf_leave_request.py`: request relation, API, and current PDF reference.
- `Backend/job_offers/starting_work_service.py`: acknowledgment reference embedding employee ID.

The production database and local checkout can differ. Check deployed migrations and code before any production rollout. This document is intended for agents working on employee, leave, payroll, hiring, attendance, or search flows.
