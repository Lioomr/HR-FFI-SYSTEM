# FFI employee ID mapping proposal

Production snapshot: 2026-10-01. **Preview only:** no employee ID, request ID, payroll record, or historical document has been changed by this mapping.

## Numbering rule used for this preview

Fathi Fouad Itani is reserved `FFI-0001`, Abdulaal Ridha Abdulaal Sultan is reserved `FFI-0002`, and MD Julfiker Ali is assigned `FFI-0003` as requested. All remaining FFI employee profiles, including archived profiles, are ordered by saved `hire_date`, then database primary key (`pk`) for ties. Numbers are never reused after archival. The database `pk` remains the relational identity.

| New system ID | Existing system ID | Profile pk | Saved hire date | Archived |
|---|---|---:|---|---|
| FFI-0001 | FFI-405062 | 2 | 2024-09-05 | No |
| FFI-0002 | FFI-176955 | 1 | 2025-08-01 | No |
| FFI-0003 | FFI-504054 | 22 | 2023-05-01 | No |
| FFI-0004 | FFI-960525 | 50 | 2023-05-01 | Yes |
| FFI-0005 | FFI-601389 | 41 | 2023-05-29 | No |
| FFI-0006 | FFI-253219 | 49 | 2023-09-15 | No |
| FFI-0007 | FFI-948796 | 53 | 2023-11-02 | No |
| FFI-0008 | FFI-413195 | 17 | 2024-05-14 | No |
| FFI-0009 | FFI-064498 | 19 | 2024-07-10 | No |
| FFI-0010 | FFI-521952 | 10 | 2024-07-15 | No |
| FFI-0011 | FFI-597819 | 11 | 2024-07-22 | No |
| FFI-0012 | FFI-582708 | 15 | 2024-08-01 | No |
| FFI-0013 | FFI-332056 | 48 | 2024-08-01 | No |
| FFI-0014 | FFI-211408 | 12 | 2024-08-10 | No |
| FFI-0015 | FFI-038439 | 4 | 2024-09-06 | No |
| FFI-0016 | FFI-552005 | 13 | 2024-09-10 | No |
| FFI-0017 | FFI-525063 | 25 | 2024-09-17 | Yes |
| FFI-0018 | FFI-809929 | 32 | 2024-09-21 | No |
| FFI-0019 | FFI-281568 | 5 | 2024-10-13 | No |
| FFI-0020 | FFI-435392 | 21 | 2024-10-14 | No |
| FFI-0021 | FFI-717563 | 9 | 2024-10-16 | No |
| FFI-0022 | FFI-130184 | 6 | 2024-10-28 | No |
| FFI-0023 | FFI-020291 | 39 | 2024-11-01 | No |
| FFI-0024 | FFI-770435 | 38 | 2024-11-02 | No |
| FFI-0025 | FFI-231125 | 23 | 2024-11-21 | No |
| FFI-0026 | FFI-656879 | 42 | 2024-11-24 | No |
| FFI-0027 | FFI-001472 | 43 | 2024-11-24 | Yes |
| FFI-0028 | FFI-321181 | 47 | 2024-11-24 | Yes |
| FFI-0029 | FFI-394368 | 30 | 2024-11-28 | No |
| FFI-0030 | FFI-193533 | 26 | 2024-12-04 | No |
| FFI-0031 | FFI-027418 | 45 | 2024-12-04 | No |
| FFI-0032 | FFI-808876 | 7 | 2024-12-12 | No |
| FFI-0033 | FFI-734626 | 37 | 2024-12-16 | Yes |
| FFI-0034 | FFI-030261 | 35 | 2024-12-22 | No |
| FFI-0035 | FFI-494083 | 3 | 2024-12-27 | No |
| FFI-0036 | FFI-835833 | 31 | 2025-01-04 | No |
| FFI-0037 | FFI-696514 | 20 | 2025-01-10 | Yes |
| FFI-0038 | FFI-551174 | 24 | 2025-01-15 | No |
| FFI-0039 | FFI-819016 | 34 | 2025-02-01 | No |
| FFI-0040 | FFI-557635 | 36 | 2025-03-19 | No |
| FFI-0041 | FFI-867751 | 67 | 2025-03-26 | No |
| FFI-0042 | FFI-655467 | 33 | 2025-04-14 | No |
| FFI-0043 | FFI-739463 | 16 | 2025-05-07 | No |
| FFI-0044 | FFI-587568 | 14 | 2025-06-30 | No |
| FFI-0045 | FFI-996360 | 86 | 2025-08-26 | No |
| FFI-0046 | FFI-387310 | 8 | 2025-09-01 | No |
| FFI-0047 | FFI-447569 | 28 | 2025-09-20 | No |
| FFI-0048 | FFI-296548 | 44 | 2025-10-01 | No |
| FFI-0049 | FFI-548714 | 46 | 2025-10-14 | No |
| FFI-0050 | FFI-405071 | 18 | 2025-11-01 | No |
| FFI-0051 | FFI-361209 | 69 | 2025-11-24 | No |
| FFI-0052 | FFI-742032 | 27 | 2025-12-01 | No |
| FFI-0053 | FFI-272295 | 40 | 2025-12-20 | No |
| FFI-0054 | FFI-671870 | 78 | 2026-01-08 | No |
| FFI-0055 | FFI-661749 | 52 | 2026-01-29 | No |
| FFI-0056 | FFI-514505 | 51 | 2026-03-08 | Yes |
| FFI-0057 | FFI-910797 | 64 | 2026-04-22 | No |
| FFI-0058 | FFI-180341 | 70 | 2026-07-07 | No |
| FFI-0059 | FFI-064303 | 74 | 2026-08-23 | No |
| FFI-0060 | FFI-306963 | 76 | 2026-09-01 | No |
| FFI-0061 | FFI-238185 | 85 | 2026-09-15 | No |

## Review before applying

- Profile pk 48, Abdullah Abdulwahab Alshehri, has saved `hire_date=2024-08-01` but `hire_date_raw=2024-01-08`. If the raw date is correct, the order from `FFI-0008` onward changes. Resolve the source of truth first.
- MD Julfiker Ali and archived Mohamed Sami Ibrahim Riad share `2023-05-01`; the requested Julfiker override gives Mohamed `FFI-0004`. Other same-date ties use ascending profile pk: 2024-08-01, 2024-11-24, and 2024-12-04.
- Existing profile codes occur as text in 53 payroll items in the September 2026 FFI draft, and in two starting-work acknowledgment references: `SWA-FFI-064303-20260830` and `SWA-FFI-306963-20260901`. Those references and any already issued PDFs require an alias or historical preservation rule. `AttendanceLateNotice.reference_number` uses company plus violation number and has an employee profile FK; it is a separate numbering scheme.
- Profile IDs in foreign keys, payroll snapshots, audit history, and exported documents must stay traceable to the original codes. A production migration should preserve old-to-new aliases, update live lookups atomically, and verify company scope and uniqueness.
