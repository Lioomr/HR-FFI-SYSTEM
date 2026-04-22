# BioTime Integration Context

The attendance module integrates with **ZKTeco BioTime 8.5** to sync employee attendance records.

## Key Files

| File | Purpose |
|---|---|
| `Backend/attendance/biotime_client.py` | `BioTimeClient` class — handles JWT auth, paginated API calls to BioTime |
| `Backend/attendance/biotime_views.py` | `BioTimeConfigViewSet`, `BioTimeActionsViewSet`, `BioTimeEmployeeMapViewSet` |
| `Backend/attendance/models.py` | `BioTimeConfig` (singleton), `BioTimeEmployeeMap` |
| `Backend/attendance/services.py` | `SyncBioTimeService` — executes the sync, returns `{success, message}` |
| `Backend/attendance/management/commands/sync_biotime.py` | CLI: `python manage.py sync_biotime --days N` |
| `BioTime 8.5 API User Manual.pdf` | Vendor API reference |
| `biotime_manual.txt` | Plain-text version of BioTime API docs |

## Data Models

**`BioTimeConfig`** (singleton — only one row allowed):
- `server_ip`, `port`, `username`, `password`
- `last_sync_time` — updated after each successful sync

**`BioTimeEmployeeMap`**:
- `user` FK → `biotime_employee_id` (BioTime's internal ID for the employee)
- Required for sync to match BioTime records to HR system users

## Sync Workflow

1. Admin configures BioTime server (IP, port, credentials) via `BioTimeSettingsPage`
2. Frontend calls `POST /biotime/actions/test_connection/` to verify
3. Sync triggered via `POST /biotime/actions/sync/` (UI) or `python manage.py sync_biotime --days N` (scheduled/CLI)
4. `BioTimeClient` authenticates with BioTime, fetches attendance records for the date range
5. Records are matched to HR users via `BioTimeEmployeeMap`
6. `AttendanceRecord` rows are created/updated with `source=SYSTEM`
7. `last_sync_time` updated on `BioTimeConfig`

## API Endpoints

- `GET/POST/PATCH /biotime/config/` — manage server config (SystemAdmin only)
- `POST /biotime/actions/test_connection/` — verify connectivity
- `POST /biotime/actions/sync/` — trigger manual sync
- `GET/POST/DELETE /biotime/employee-map/` — manage employee ID mappings

## Rules for Working with BioTime

- `BioTimeConfig` is a singleton — there should never be more than one row. Use `get_or_create` with a fixed `pk=1` or similar pattern.
- Never expose BioTime credentials in API responses — exclude `password` from serializer output.
- Sync failures must be logged (to audit or at least Django logger) — never silently swallow errors.
- BioTime-sourced `AttendanceRecord` rows have `source=SYSTEM`; manual corrections have `source=MANUAL`. Do not overwrite MANUAL records with SYSTEM sync data for the same date.
- When mapping employees, confirm `BioTimeEmployeeMap` exists before syncing — unmatched BioTime IDs should be logged/skipped, not crash the sync.
