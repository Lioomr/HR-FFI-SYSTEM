# Geofenced Attendance Phase 8 Backend Contract

**Published:** 2026-08-29
**Backend migration files:** `Backend/attendance/migrations/0010_worklocation.py` and `Backend/admin_portal/migrations/0002_systemsettings_geofence_attendance_enabled.py`

## Shared Context Log

### 2026-08-29 - Phase 8 backend contract published

The attendance backend now supports company-scoped work locations and an opt-in global GPS validation toggle. Web clients configure sites only through `/api/work-locations/`; mobile clients continue using the existing self-service routes. BioTime remains terminal-sourced and is not GPS-validated.

## Data model and constraints

`attendance.WorkLocation` has these fields:

| Field | Type | Rule |
|---|---|---|
| `id` | bigint | server-generated |
| `company` | FK to `organization.OrganizationNode` | required, `PROTECT`, server-injected, active `COMPANY` node only |
| `name` | `CharField(120)` | required; unique among active locations in one company |
| `latitude` | `DecimalField(max_digits=9, decimal_places=6)` | database and model range `-90..90` |
| `longitude` | `DecimalField(max_digits=9, decimal_places=6)` | database and model range `-180..180` |
| `radius_meters` | positive integer | database and model constraint `> 0` |
| `is_active` | boolean | defaults to `true`; API read-only and changed to `false` by DELETE |
| `created_at`, `updated_at` | timestamps | server-managed |

Database constraints are `work_location_latitude_range`, `work_location_longitude_range`, `work_location_positive_radius`, and the conditional `unique_active_work_location_name`. GeoDjango/PostGIS is not installed or used; distance evaluation is the plain-Python `attendance.geofence.haversine_distance_meters` helper.

`admin_portal.SystemSettings.geofence_attendance_enabled` is a singleton boolean, default `false`.

## Web work-location API

All routes require authentication, the `x-active-company-id` header selecting an authorized active company, and `core.permissions.IsSystemAdmin`. The canonical routes are:

| Method | Route | Behavior |
|---|---|---|
| `GET` | `/api/work-locations/` | paginated active-company list in `{status, data: {items, page, page_size, count, total_pages}}` |
| `POST` | `/api/work-locations/` | create an active-company location; success envelope, `201` |
| `GET` | `/api/work-locations/{id}/` | active-company retrieve; cross-company/inactive rows are `404` |
| `PUT`, `PATCH` | `/api/work-locations/{id}/` | update only the active-company row; success envelope |
| `DELETE` | `/api/work-locations/{id}/` | soft delete (`is_active=false`), success envelope `{status:"success",data:{}}` |

The response fields are `id`, `name`, `latitude`, `longitude`, `radius_meters`, `is_active`, `company_id`, `company_name`, `created_at`, and `updated_at`. `id`, `is_active`, both company fields, and timestamps are read-only. Client-supplied `company` or `company_id` is rejected with `422`; it is never writable.

Exact web create payload:

```json
{
  "name": "Riyadh Main Office",
  "latitude": "24.713600",
  "longitude": "46.675300",
  "radius_meters": 100
}
```

Exact web update payload (PUT requires all writable fields; PATCH may send a subset):

```json
{
  "name": "Riyadh Main Office",
  "latitude": "24.713600",
  "longitude": "46.675300",
  "radius_meters": 125
}
```

Create/update/delete are audited as `attendance.work_location_created`, `attendance.work_location_updated`, and `attendance.work_location_deleted`. Audit metadata contains the location ID/entity linkage, company ID, name, and `soft_deleted: true` for a delete.

## Settings API and rollout

`GET /settings/` and SystemAdmin-only `PUT /settings/` include this response/request section:

```json
{ "attendance": { "geofence_enabled": false } }
```

The remaining existing settings sections remain required for `PUT`. The new `attendance` section is optional on an update for legacy settings clients; omission preserves the existing toggle. A change is included in the existing `settings_updated` audit's `changed` metadata.

When `geofence_enabled` is `false`, `POST /api/attendance/me/check-in/` and `POST /api/attendance/me/check-out/` retain empty-body compatibility. When it is `true`, both routes require GPS validation. BioTime ingestion does not read or depend on this setting.

## Mobile self-service GPS contract

The routes are unchanged:

- `POST /api/attendance/me/check-in/`
- `POST /api/attendance/me/check-out/`

Exact payload for both routes, only while the global toggle is enabled:

```json
{
  "latitude": "24.713600",
  "longitude": "46.675300",
  "accuracy_meters": "12.50"
}
```

All three fields are decimal numeric values. Latitude and longitude are decimal degrees; `accuracy_meters` is metres. The helper constant `attendance.geofence.MAX_GPS_ACCURACY_METERS` is exactly `Decimal("100")`. Values must be finite; latitude is `-90..90`, longitude is `-180..180`, accuracy is non-negative, and accuracy must be at most 100 metres. The server resolves active locations through both the caller's employee-profile company and the active-company request context, then accepts a reading at or inside at least one location radius using Haversine distance. It does not expose location names, coordinates, or distance in any attendance response.

Failure contract when enabled:

| Condition | HTTP status | Envelope message |
|---|---:|---|
| missing field, non-numeric/non-finite input, invalid coordinate range, or negative accuracy | `422` | `Invalid GPS coordinates.` |
| accuracy greater than 100 metres | `422` | `GPS accuracy must be 100 metres or better.` |
| no active work location for the company, or coordinate outside every active radius | `403` | `You are not within an approved work location.` |
| missing employee profile | `404` | `Employee profile not found.` |
| profile has no active-company match | `403` | `Employee profile is not available in the active company.` |
| archived profile (including the only model-valid profile shape with no company) | `403` | `Archived employees cannot check in.` or `Archived employees cannot check out.` |
| existing same-day check-in | `400` | `Check-in already exists for today.` |
| checkout before any check-in | `400` | `No check-in record found for today.` |
| existing checkout | `400` | `Check-out already exists for today.` |

GPS validation happens before attendance write transactions, row locking, and duplicate-state logic. Successful replies remain exactly the established `CheckInResponseSerializer` (`id`, `date`, `check_in_at`, `status`) and `CheckOutResponseSerializer` (`id`, `date`, `check_in_at`, `check_out_at`, `status`) envelopes. Existing locks, workflow sync, notifications, throttling, and audits remain in place. Successful mobile check-in/out audits additionally record `work_location_id` and `work_location_name`; location data is not returned to either client.

## BioTime unified-truth rule

BioTime continues to ingest only employee code, punch time, and terminal serial into `AttendanceRecord.source=SYSTEM`. It receives no mobile GPS fields and never calls mobile geofence validation. It retains the terminal serial metadata and does not overwrite non-`SYSTEM` employee or HR-managed records. This phase does not introduce terminal-to-WorkLocation mappings, so BioTime punches must not be represented as GPS verified. A future, separately reviewed phase may add active company-scoped terminal mappings and a terminal-verified state while retaining the BioTime serial.
