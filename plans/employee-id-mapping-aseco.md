# Aseco Pro employee ID mapping record

Production inventory on 2026-10-01. Company database ID `3`, code `ASECO_PRO`, employee ID prefix `ASECO`. Applied on 2026-10-04: 6 employee IDs and aliases and 6 draft payroll item codes. The old IDs below remain searchable aliases. There were no leave requests to backfill.

The business rule reserves `ASECO-0001` for Fathi Fouad Itani (CEO) and `ASECO-0002` for Abdelaal Ridha (GM). Neither currently has an Aseco Pro `EmployeeProfile`; these are reserved numbers, not existing Aseco profile mappings. Among Aseco profiles, sort by saved `hire_date` ascending, then use the immutable database primary key to break a date tie. Include archived profiles and never reuse a number.

| Proposed code | Profile PK | Employee | Current code | Saved `hire_date` | `hire_date_raw` | Archived |
|---|---:|---|---|---|---|---|
| `ASECO-0003` | 57 | Nawal Ali Saad Alkhathami | `ASECO-050153` | 2025-04-12 | `2025-04-12` | No |
| `ASECO-0004` | 56 | Mahmoud Emad Salam | `ASECO-955989` | 2025-08-03 | `2025-08-03` | No |
| `ASECO-0005` | 55 | Essam Effat Ismail Kamel | `ASECO-713528` | 2025-08-16 | `2025-08-16` | No |
| `ASECO-0006` | 54 | Mohamed Samy Al Ansari | `ASECO-423325` | 2025-10-17 | `2023-05-01` | No |
| `ASECO-0007` | 65 | Mohamed Elsayed Musafa Khalil | `ASECO-845853` | 2026-02-10 | empty | No |
| `ASECO-0008` | 58 | Manar Ahmed Alghamdi | `ASECO-793588` | 2026-08-02 | `2026-08-02` | No |

## Source-data note after assignment

Mohamed Samy Al Ansari's raw hire date is 2023-05-01, while the saved parsed date is 2025-10-17. The applied order uses the saved date, as the user confirmed. Correct the source personnel record separately if needed; do not silently renumber issued IDs. Manar's saved hire date is after her profile creation date; verify this separately if the saved value is intended to represent first employment rather than a future start date.

## Existing references to preserve

- All six employees had one draft `PayrollRunItem.employee_id` text snapshot (item PKs 51–56). The matching draft codes were updated with the employee IDs.
- Starting work acknowledgment PK 4 for Mohamed Samy embeds the existing code in `SWA-ASECO-423325-20260912`. Preserve this issued reference and any associated document as historical evidence; provide lookup by both old and new codes.
- Two late notices for Essam use `LAN-ASECO_PRO-000081` and `LAN-ASECO_PRO-000090`. They are company/notice references, not employee-code references. Attendance, BioTime, contract, document, and deduction records refer to the employee by database FK and should retain those links.
- No Aseco Pro leave or permission requests were found through `EmployeeProfile` foreign keys at the time of inspection. Future request references can include the new employee code while internal primary keys and foreign keys remain stable.

This table records the production mapping applied on 2026-10-04. Old-to-new aliases were created for all six profiles, and company-scoped uniqueness was verified after migration.
