# Frontend Task — Attendance: Late Threshold, Absence Detection & View Rebuild

> Paste this to the frontend developer. The backend for this feature is **already implemented** on the current working branch. Do not change backend files; if the contract below doesn't match what the API returns, flag it — don't work around it.

---

## 1. Context / what changed on the backend

The HR system now has a **company-wide work schedule** (single policy, no per-employee/per-department config) used to:

1. **Auto-classify late arrivals.** A check-in after `work_day_start_time + late_grace_minutes` on a working day becomes `LATE` instead of `PRESENT`.
   - BioTime (`source=SYSTEM`) records are classified immediately on sync.
   - Employee self check-ins (`source=EMPLOYEE`) **still go through the full manager → HR → (CEO) approval flow**. They carry a new `is_late_flagged` boolean; when the CEO approves such a record it resolves to `LATE` (not `PRESENT`). HR override already lets HR pick the final status manually.
2. **Auto-detect absentees.** A daily Celery job (`attendance.tasks.mark_daily_absentees`, 05:30 server time) creates an `ABSENT` record (`source=SYSTEM`) for every active employee who has **no** attendance record for a working day and is **not** on approved leave. Non-working days and archived employees are skipped. There is also a management command `backfill_absences --from --to` for HR/ops (not a UI concern).

Nothing about existing statuses, endpoints, routes, or the approval workflow changed. The additions are **purely additive fields**.

---

## 2. API contract changes (authoritative)

### 2.1 `AttendanceRecord` payload — two new read-only fields

Every attendance record returned by these endpoints now also includes:

| Field | Type | Meaning |
|---|---|---|
| `is_late_flagged` | `boolean` | The check-in was past the late cutoff at creation time. Use to show a "Late arrival" hint on records still `PENDING_*`. |
| `late_minutes` | `integer` | Whole minutes past the grace cutoff for `check_in_at`. `0` when on time, no check-in, or a non-working day. Display only when `> 0`. |

Affected endpoints (all already used by the app):
- `GET /api/attendance/` (HR/Admin global list) — envelope `data.results[]`, plus `data.summary` (unchanged shape: `{ STATUS: count }`)
- `GET /api/attendance/{id}/`
- `GET /api/attendance/me/` (employee self list)
- `GET /api/manager/attendance/` (manager list)
- `GET /api/ceo/attendance/` (CEO list, with `data.summary`)
- Check-in response `POST /api/attendance/me/check-in/` body still only has `id, date, check_in_at, status` and `status` is the pending state. **Don't assume PRESENT** — it may later resolve to `LATE`.

> `LATE` / `ABSENT` were already valid `AttendanceStatus` values and already handled in the UI colour maps. No new status strings.

### 2.2 System Settings endpoint — `attendance` object extended

`GET /api/admin/settings/` → `data.attendance` and `PUT /api/admin/settings/` body `attendance` now carry:

```jsonc
"attendance": {
  "geofence_enabled": true,               // existing
  "work_day_start_time": "09:00",         // NEW — "HH:MM" (24h). PUT accepts "HH:MM" or "HH:MM:SS".
  "late_grace_minutes": 15,               // NEW — integer 0–240
  "absence_detection_enabled": true,      // NEW — boolean
  "work_week_days": [6, 0, 1, 2, 3]       // NEW — array of ints, Python weekday(): Mon=0 … Sun=6.
                                          //       Default [6,0,1,2,3] = Sun–Thu.
}
```

**PUT rules:**
- The four new keys are all **optional** on PUT. Send the full `attendance` object (including `geofence_enabled`, which stays required whenever `attendance` is present) plus whichever new keys the form edits. Omitting a new key leaves it unchanged.
- `work_week_days`: non-empty, max 7, ints 0–6; backend de-dupes and sorts. Send what the user picked.
- Validation errors come back as `422` with `{ message, errors: { attendance: { <field>: [msg] } } }` (same pattern as the rest of that form).

---

## 3. Frontend work items

### 3.1 Admin Settings page — new "Work schedule" controls
File: `FrontEnd/src/pages/admin/AdminSettingsPage.tsx` (+ its test).

Under the existing Attendance section, add:
- **Work day start time** — time picker, bind to `work_day_start_time`. Render/submit as `"HH:MM"`.
- **Late grace period (minutes)** — number input, `0–240`, bind `late_grace_minutes`.
- **Automatic absence detection** — switch, bind `absence_detection_enabled`. Helper text: "Each morning, employees with no attendance and no approved leave are marked Absent for the previous working day."
- **Working days** — multi-select / checkbox group of the 7 weekdays. **Map carefully:** value is Python `weekday()` where Monday=0 … Sunday=6. Provide a labelled option list, e.g. `[{label:'Sunday',value:6},{label:'Monday',value:0},…,{label:'Saturday',value:5}]`, order the display Sun→Sat, submit the numeric array.

Wire these into the same load (`GET`) → form state → `PUT` cycle the page already uses. Update the settings TS type to include the four fields. Update the settings API test fixtures/expectations.

Add i18n keys (en + ar) under the settings namespace, e.g. `settings.attendance.workDayStart`, `settings.attendance.lateGraceMinutes`, `settings.attendance.absenceDetection`, `settings.attendance.workingDays`, and weekday labels if not already present.

### 3.2 Types
File: `FrontEnd/src/types/attendance.ts`
```ts
export interface AttendanceRecord {
  // …existing…
  is_late_flagged?: boolean;
  late_minutes?: number;
}
```

### 3.3 Attendance view rebuild
Primary file: `FrontEnd/src/pages/shared/AttendancePreviewPage.tsx` (already the shared HR + CEO screen — routes `hr/attendance` and `ceo/attendance` both render it). `FrontEnd/src/pages/hr/attendance/HRAttendancePage.tsx` is legacy/unused by routes — you may delete it and its imports, or leave it; confirm with the team.

Rebuild goals:

1. **Summary bar** — keep the existing tiles; add:
   - **Attendance rate** = `PRESENT + LATE` ÷ (all non-pending, non-rejected records in range), shown as `%`.
   - **Late** and **Absent** counts already come from `data.summary`.
   - **Avg check-in time** (optional, compute client-side from loaded page rows — acceptable as a "page-level" stat, label it as such).
2. **Table columns** — add:
   - **Late by** — render `late_minutes` when `> 0` (e.g. `+23m` in amber), else `—`. Show it for `LATE` rows and any row where `late_minutes > 0`.
   - Keep the existing **Duration** column.
   - On `PENDING_*` rows where `is_late_flagged` is true, show a small amber "Late arrival" tag next to the status so approvers see it before deciding.
3. **Filters** — keep search / date range / employee / source. No new backend filter params exist beyond `status`, `source`, `date_from/to`, `employee_id`, `search`, so `LATE` / `ABSENT` filtering uses the existing `status` param (already wired via `STATUS_OPTIONS`).
4. **CSV export** — "Export" button that downloads the currently-filtered rows (employee, date, check-in, check-out, duration, status, late_minutes, source). Client-side CSV from the loaded dataset; if the range can exceed one page, page through the API (respect `page_size`) before building the file, or cap + warn.
5. **Empty / error / loading** — reuse existing `EmptyState` / `ErrorState` components.
6. **i18n** — add keys for the new column/labels under `attendancePreview.*` (en + ar). Reuse `attendancePreview.status.late` / `.absent` which already exist.

Update `AttendancePreviewPage.test.tsx` (and `.ceo.test.tsx`) for the new column and summary math.

### 3.4 Employee-facing
`FrontEnd/src/pages/employee/AttendancePage.tsx` / `AttendanceMaintenancePage` — if it renders a records list, surface `LATE` / `ABSENT` the same way and show `late_minutes` when present. No workflow change for the employee.

---

## 4. Behavioural notes to keep FE/BE in sync

- **Don't assume a self check-in becomes PRESENT.** After approval it can be `LATE`. Always render from the record's `status`.
- **`ABSENT` rows have `source=SYSTEM` and no `check_in_at`.** Duration / check-in columns should show `—`.
- **`late_minutes` is computed from the *current* schedule setting**, not frozen at creation — if an admin changes the grace period, historical `late_minutes` values shift. `is_late_flagged` and the stored `status` do not. For a stable "was late" signal on pending rows, use `is_late_flagged`.
- **Non-working days:** a check-in on a non-working day is never `LATE` and `late_minutes` is `0`. The absence job skips them entirely.
- **Timezone:** `check_in_at` / `check_out_at` are ISO datetimes; keep using the existing `formatTimeOnly` / `formatDateOnly` helpers.

---

## 5. Definition of done

- [x] Settings page reads + writes the 4 new `attendance` fields; PUT round-trips; validation errors surface inline.
- [x] Weekday mapping verified (Mon=0…Sun=6) with a unit test on the option list.
- [x] `AttendanceRecord` type updated; no `any` leakage.
- [x] Attendance view shows Late-by, late-arrival tag on pending rows, attendance-rate tile, CSV export.
- [x] en + ar translations added; `i18n` test passes.
- [x] Component tests updated and green.
- [ ] Manual check against a running backend: confirm a late record shows `LATE` + minutes; confirm an `ABSENT` row renders cleanly.

---

## 6. Implementation notes (done 2026-09-02)

**Files touched**

| File | Change |
|---|---|
| `src/types/attendance.ts` | `AttendanceRecord` + `is_late_flagged?: boolean`, `late_minutes?: number` |
| `src/services/api/apiTypes.ts` | `SettingsDto.attendance` + the 4 work-schedule keys (all optional) |
| `src/pages/admin/workWeekDays.ts` | **new** — `WORK_WEEK_DAY_OPTIONS` (value = Python `weekday()`, ordered Sun→Sat) |
| `src/pages/admin/AdminSettingsPage.tsx` | Work-schedule controls: start-time `TimePicker`, grace `InputNumber` (0–240), absence `Switch`, working-days `Checkbox.Group` |
| `src/pages/shared/AttendancePreviewPage.tsx` | "Late by" column (`+Nm`, amber), "Late arrival" tag on flagged `PENDING_*` rows, "Attendance rate" summary tile, "Export" button → client-side CSV (walks all filtered pages, BOM-prefixed, capped at 10 000 rows) |
| `src/pages/employee/AttendancePage.tsx` | "Late by" column (see caveat below) |
| `src/i18n/translations.ts` | en + ar: `attendancePreview.columns.lateBy` / `.lateArrivalTag` / `.summary.attendanceRate` / `.export.*`, `admin.settings.lbl*`/`help*` for the 4 fields, `common.weekday.*` |

**Tests:** `src/pages/admin/workWeekDays.test.ts` (new, 4), `AdminSettingsPage.test.tsx` (9), `AttendancePreviewPage.test.tsx` (19) — all green. `tsc --noEmit` and `eslint` clean (one pre-existing `exhaustive-deps` warning in `employee/AttendancePage.tsx` left untouched).

**TimePicker binding:** `work_day_start_time` stays an `"HH:MM"` string in form state; `getValueProps` converts to dayjs for the picker and `getValueFromEvent` reads the picker's `timeString` back. No `dayjs` customParseFormat plugin needed.

**Deviations from the brief**

- **Avg check-in time tile — not built.** It was marked optional and a single-page average is misleading; attendance-rate (required) is in.
- **`employee/AttendancePage.tsx` is not currently routed** — `routes.tsx` points `employee/attendance` at `AttendanceMaintenancePage` (a placeholder). The Late-by column was still added so it is correct when that screen is re-enabled; nothing user-visible changed today.
- **`HRAttendancePage.tsx` left in place** — confirmed unused by `routes.tsx`, but deletion is a separate call for the team.
- **Validation errors** surface via the page's existing top-of-card `Alert` (`getFirstApiErrorMessage`), consistent with the rest of that form — not per-field inline.
