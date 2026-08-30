Implement Phase 10 of geofenced attendance in D:\HR-FFI-SYSTEM\MobileApp only.

Do not modify Backend/ or FrontEnd/. The backend contract is authoritative. If any required contract detail is missing or contradicts source, return BLOCKED rather than guessing.

Read first:
- repository AGENTS.md
- .agents/context/INDEX.md
- .agents/context/mobile_app.md, if present
- plans/Geofenced Attendance Phase 8 Backend Contract.md
- plans/API Route Status Matrix.md
- existing MobileApp attendance API, screen, location/permission, error-parser, and test files

Verified backend contract:

- Check-in: `POST /api/attendance/me/check-in/`
- Check-out: `POST /api/attendance/me/check-out/`
- When geofencing is enabled, send exactly:

```json
{
  "latitude": "24.713600",
  "longitude": "46.675300",
  "accuracy_meters": "12.50"
}
```

* Latitude/longitude are decimal degrees; accuracy is metres.
* Do not send WorkLocation, company, site name, radius, distance, or other inferred location fields.
* The backend global toggle is in System Settings as `attendance.geofence_enabled`. If the mobile app has no supported endpoint for it, let the backend decide and handle its returned validation response. Do not bypass a rejection by retrying without coordinates.
* Existing empty-body clients remain compatible while the toggle is off.

Exact backend failures while enabled:

* `422`, `Invalid GPS coordinates.`
* `422`, `GPS accuracy must be 100 metres or better.`
* `403`, `You are not within an approved work location.`
* `400`, `Check-in already exists for today.`
* `400`, `No check-in record found for today.`
* `400`, `Check-out already exists for today.`

Implement:

* Request foreground-location permission through the app’s existing platform pattern.
* Capture current location immediately before both check-in and check-out.
* Send exact six-decimal latitude/longitude strings and metres-based accuracy.
* Handle permission denied, location unavailable, invalid location, poor accuracy, outside-site, duplicate check-in, missing check-in, duplicate check-out, and network errors with clear user-facing states.
* Keep coordinates ephemeral unless the existing mobile security policy explicitly requires storage.
* Preserve existing timeline, retry, loading, and success behavior.
* Never show or infer a matched site name, coordinates, radius, or distance.

Tests:

* Exact check-in/check-out request bodies.
* Permission denied and unavailable location.
* Poor accuracy and outside-site backend responses.
* Successful inside-site check-in and check-out.
* Duplicate/missing state errors and network errors.
* Run the mobile attendance tests plus the repository’s type-check and lint commands.

Return exactly:
STAGE_COMPLETION_REPORT
stage: mobile
status: READY_FOR_VERIFICATION | BLOCKED
base_commit_or_worktree: <value>
changed_files:

* <path> implementation_summary:
* <item> contract_consumed:
* <file and section> contract_published:
* <file and section, or N/A>
tests:
* command: <exact command>
result: <result>
manual_verification:
* <item> known_risks_or_followups:
* <item or None> handoff_to_verifier:
* <exact facts to check> END_STAGE_COMPLETION_REPORT
