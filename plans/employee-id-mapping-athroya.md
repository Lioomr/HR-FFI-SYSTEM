# Athroya employee ID mapping record

Production snapshot: 2026-10-01. Company: Athroya (database ID 4, employee prefix `ATH`). Applied on 2026-10-04: 8 employee IDs and aliases and 5 leave request references. The old IDs below remain searchable aliases. There were no matching draft payroll rows.

Numbers `ATH-0001` and `ATH-0002` are reserved for Fathi Fouad Itani (CEO) and Abdelaal Ridha (GM), respectively, under the requested company-wide numbering rule. Neither has an Athroya employee profile in this snapshot. Existing Athroya profiles begin at `ATH-0003`. The table sorts profiles with a saved `hire_date` by that date, then by database primary key for ties. Profiles without a saved hire date come after dated profiles, ordered by `created_at` and then primary key. Archived profiles retain a number; numbers must not be reused.

| Proposed ID | Current ID | Employee | Profile PK | Saved hire date | Raw hire date | Created at (UTC) | Archived |
|---|---|---|---:|---|---|---|---|
| `ATH-0003` | `ATH-931731` | Mahmoud saber Helal Khalil | 60 | 2025-04-10 | `2025-04-10` | 2026-04-19 12:39:23.768664 | No |
| `ATH-0004` | `ATH-998089` | Ahmed Mohamed El-Sayed | 59 | 2025-08-04 | `2025-08-04` | 2026-04-19 12:39:23.766626 | Yes |
| `ATH-0005` | `ATH-483426` | SHERIF HAMED MOHAMED HAMED | 61 | 2025-11-04 | `25/9/2025` | 2026-04-19 12:39:23.770322 | No |
| `ATH-0006` | `ATH-548807` | Yasser ELSAIED MAHMOUD ISSA | 62 | 2025-12-15 | `2025-01-11` | 2026-04-19 12:39:23.771811 | No |
| `ATH-0007` | `ATH-342605` | Abdullah Fathi | 77 | 2026-08-09 | blank | 2026-09-02 10:00:06.248892 | No |
| `ATH-0008` | `ATH-592193` | الزناتي علي حسن احمد | 81 | 2026-09-11 | blank | 2026-09-10 13:32:08.933653 | No |
| `ATH-0009` | `ATH-818899` | Aryam Ahmed Alghamdi | 63 | blank | blank | 2026-04-19 12:39:23.773191 | No |
| `ATH-0010` | `FFI-6494E2` | sherif hamed | 82 | blank | blank | 2026-09-13 11:58:50.347324 | Yes |

## Source-data notes after applying

- Yasser's saved `2025-12-15` and raw `2025-01-11` hire dates conflict. The applied order uses the saved date, as the user confirmed. Correct the source personnel record separately if needed; do not silently renumber issued IDs.
- Sherif's saved `2025-11-04` differs from raw `25/9/2025`. The applied order uses the saved date.
- Aryam and the archived `sherif hamed` profile have no saved hire date. They were numbered after dated profiles by creation timestamp, as the user directed. The archived profile's former `FFI-` code remains an alias; its company association can be reviewed separately.
- Athroya had no payroll runs or items in this snapshot. The former employee code appears in a starting work acknowledgment for profile 81 (`SWA-ATH-592193-20260908`); its two late notices use `LAN-ATHROYA-...` references. Previously issued document references were preserved. Database primary keys and foreign keys remain intact.

This table records the mapping applied to the production employee profiles on 2026-10-04.
