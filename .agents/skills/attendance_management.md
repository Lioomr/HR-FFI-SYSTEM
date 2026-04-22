# Attendance Management Skill

Use when working with attendance records, check-in/check-out, HR overrides, or BioTime sync.

## Key Files

| File | Purpose |
|---|---|
| `Backend/attendance/models.py` | AttendanceRecord, BioTimeConfig, BioTimeEmployeeMap |
| `Backend/attendance/views.py` | ViewSets per actor (Employee, Manager, HR, CEO) |
| `Backend/attendance/services.py` | `SyncBioTimeService` — BioTime sync logic |
| `Backend/attendance/biotime_client.py` | `BioTimeClient` — API calls to ZKTeco device |

For BioTime-specific details, also read `.agents/context/biotime_integration.md`.

## AttendanceRecord Status Machine

```
[BioTime sync] ─────────────────────────────────────→ PRESENT (source=SYSTEM)

[Employee check-in]
  ↓
PENDING_MGR (has manager, not HR)
  ├─ approve → PENDING_HR
  └─ reject  → REJECTED

PENDING_HR (no manager, or after manager approves)
  └─ HR override (PATCH) → sets status directly, source=HR, is_overridden=True

PENDING_CEO (HR manager submitted own check-in)
  ├─ approve → PRESENT
  └─ reject  → REJECTED

PENDING (legacy fallback — treat as PENDING_HR)
```

Terminal states: `PRESENT`, `ABSENT`, `LATE`, `REJECTED`

## Source Values

| Source | Meaning |
|---|---|
| `SYSTEM` | Created by BioTime sync |
| `EMPLOYEE` | Created by employee self check-in |
| `HR` | Created or overridden by HR |

**Critical rule**: Once a record has `source=HR` (is_overridden=True), BioTime sync will **not** overwrite it. HR corrections are protected.

## AttendanceRecord Key Fields

- `employee_profile` FK, `date`, `check_in_at`, `check_out_at`
- `status`, `source`
- `is_overridden` — True when HR has manually corrected the record
- `override_reason` — required when HR modifies `check_in_at`, `check_out_at`, or `status`
- `manager_decision_at/by/note`, `ceo_decision_at/by/note`

## Approval Chain Per Role

**Employee**:
- `POST /attendance/me/check-in/` — creates record
- `POST /attendance/me/check-out/` — sets `check_out_at` on today's record
- Initial status:
  - Has manager (not HR manager) → `PENDING_MGR`
  - No manager, or is HR manager → `PENDING_HR` or `PENDING_CEO`

**Manager** (`ManagerAttendanceViewSet`):
- Scope: own direct reports only
- Acts on `PENDING_MGR`
- `approve` → `PENDING_HR` + sets manager decision fields
- `reject` → `REJECTED` (requires notes)

**HR** (standard `AttendanceRecordViewSet` PATCH/PUT):
- Can override **any** record via `AttendanceOverrideSerializer`
- Can modify: `check_in_at`, `check_out_at`, `status`, `notes`, `override_reason`
- `override_reason` is required when changing core fields
- Sets `source=HR`, `is_overridden=True`, `updated_by=user`
- Cannot self-approve a `PENDING_CEO` record that belongs to them

**CEO** (`CEOAttendanceViewSet`):
- Acts on `PENDING_CEO` only
- `approve` → `PRESENT`
- `reject` → `REJECTED` (requires notes)
- Self-approval block: HR managers cannot approve their own records

## BioTime Sync Behaviour

`SyncBioTimeService.execute(days_back=1)`:
1. Validates BioTimeConfig is active
2. Authenticates with ZKTeco BioTime 8.5 API
3. Fetches punch transactions for the date range
4. Groups punches by employee + date (first punch = check_in, last = check_out)
5. Resolves employee via `BioTimeEmployeeMap.biotime_emp_code`
6. Creates/updates `AttendanceRecord` with `source=SYSTEM`, `status=PRESENT`
7. **Skips** records where `is_overridden=True` — HR corrections are never overwritten
8. Logs unmapped employee codes; does not crash on unknown employees
9. Updates `BioTimeConfig.last_sync_time`

## HR Override Rules

- When HR modifies `check_in_at`, `check_out_at`, or `status`: `override_reason` is **required**
- Overriding sets `is_overridden=True` permanently — future BioTime syncs skip this record
- HR can set status to any valid value (PRESENT, ABSENT, LATE, REJECTED)
- Source is forced to `HR` on any HR modification

## Security Rules

- Managers can only see/act on their own direct reports' records
- HR can act on any record in their accessible companies
- CEO can only see `PENDING_CEO` records
- Self-approval is blocked at the CEO stage (prevents HR managers approving their own records)
- Company scope applies — use `filter_queryset_by_company_scope` on all attendance querysets

## Checklist

- [ ] Initial status routing respects whether employee has a manager and their role
- [ ] `override_reason` required when HR modifies core fields
- [ ] BioTime sync skips `is_overridden=True` records
- [ ] Unmapped BioTime employees logged, not crashed
- [ ] Self-approval blocked at CEO stage
- [ ] Company scope applied to all querysets
- [ ] `AuditLog` emitted for HR overrides and CEO decisions
- [ ] Frontend attendance views filter by correct status per role
