# Geofenced Attendance: Synced Agent Prompts

This document is the execution contract for three agents. Run the prompts in order:

1. Backend Codex: implement and publish the authoritative API contract.
2. Mobile Codex: implement the mobile GPS flow against the published contract.
3. Claude frontend: implement the web WorkLocation administration UI against the published contract.

Do not start a later stage until the previous stage has produced its completion report and the verifier has confirmed it.

## Shared synchronization rules

- The backend is the source of truth for attendance decisions, WorkLocations, company scoping, permissions, status codes, and response shapes.
- Agents must read this file, the repository `AGENTS.md`, `.agents/context/INDEX.md`, and the backend contract files before changing code.
- Agents must inspect the real implementation before relying on examples in plans.
- Do not invent endpoint names, field names, error messages, enum values, or permissions. Copy them from the backend contract after Phase 8 is complete.
- Do not modify another surface's files. Backend owns `Backend/`; mobile owns `MobileApp/`; Claude owns `FrontEnd/`.
- Every stage must run its focused tests and report exact commands and results.
- Every stage must return the completion report at the end of its response using the template below.
- A stage is not verified merely because tests pass. The verifier must check the changed files, contract documentation, scope boundaries, and reported evidence.

## Completion report template required from every agent

```text
STAGE_COMPLETION_REPORT
stage: <backend|mobile|frontend>
status: READY_FOR_VERIFICATION | BLOCKED
base_commit_or_worktree: <commit hash, branch, or working-tree identifier>
changed_files:
  - <path>
implementation_summary:
  - <short factual item>
contract_consumed:
  - <file and section, or N/A for backend>
contract_published:
  - <file and section, or N/A>
tests:
  - command: <exact command>
    result: <passed/failed and count>
manual_verification:
  - <endpoint/UI flow/device behavior checked>
known_risks_or_followups:
  - <item or None>
handoff_to_verifier:
  - <the exact facts the verifier should check>
END_STAGE_COMPLETION_REPORT
```

The verifier response should use this format:

```text
STAGE_VERIFICATION_REPORT
stage: <backend|mobile|frontend>
decision: VERIFIED | CHANGES_REQUIRED | BLOCKED
checked:
  - <file, test, contract, or behavior checked>
evidence:
  - <exact command/result or source observation>
issues:
  - <item or None>
next_stage: <backend|mobile|frontend|NONE>
END_STAGE_VERIFICATION_REPORT
```

When an agent reports `READY_FOR_VERIFICATION`, send its report to the verifier. The verifier must inspect the repository and run appropriate checks before returning `VERIFIED`. If the decision is `CHANGES_REQUIRED`, send the issues back to the same agent and do not begin the next stage.

---

## Prompt 1: Backend Codex

Copy and send this prompt to Codex working in the repository backend.

```text
Implement Phase 8 of the geofenced attendance feature in D:\\HR-FFI-SYSTEM\\Backend.

You are the backend owner and the authoritative source for the mobile and web agents. Implement only backend work. Do not modify FrontEnd/ or MobileApp/.

Read first, completely:
- repository AGENTS.md
- .agents/context/INDEX.md
- .agents/context/system_design.md
- .agents/context/database_schema.md
- .agents/context/auth_and_permissions.md
- .agents/context/api_design.md
- .agents/context/biotime_integration.md
- plans/Global API Rules (v1).txt
- plans/API Route Status Matrix.md
- Backend/attendance/models.py, serializers.py, views.py, urls.py, services.py, biotime_views.py, tests.py
- Backend/organization/services.py and Backend/core/permissions.py

Before coding, verify the actual implementation. Confirm the current self-service routes, response envelope, active-company resolution, attendance locking, duplicate errors, workflow sync, audit calls, BioTime source rules, and the real SystemAdmin permission class. Confirm whether GeoDjango/PostGIS is installed. Do not rely on plan examples when source code differs.

Feature design:

1. WorkLocations
- Add an attendance WorkLocation model with company FK using PROTECT, name, latitude, longitude, radius_meters, is_active, timestamps, and reviewed database constraints.
- Use DecimalField(max_digits=9, decimal_places=6) for latitude and longitude.
- Validate coordinate ranges, positive radius, active company ownership, and safe soft deletion.
- Add a reviewed migration.
- Add a SystemAdmin-only CRUD API at the canonical route chosen from the actual URL structure. The final route must be documented exactly.
- Company is injected server-side from the active-company context and is never client-writable.
- List/retrieve/update/delete must be active-company scoped. DELETE is a soft delete and must be audited.
- Use the repository response envelope and permission patterns. Do not expose secrets or unrelated company data.

2. Global rollout toggle
- Extend the existing singleton SystemSettings with a global boolean geofence attendance flag, default false.
- Expose it through the existing SystemAdmin settings API using the repository's current serializer and audit pattern.
- When false, existing mobile check-in/check-out behavior remains compatible with the current empty-body clients.
- When true, mobile self-service check-in and check-out require the geofence payload.
- BioTime ingestion is not blocked by this mobile toggle.

3. Mobile attendance validation
- Extend the existing POST self-service check-in and check-out actions only.
- When enabled, accept the exact fields selected by the backend contract for latitude, longitude, and accuracy_meters. Use decimal degrees and metres.
- Validate missing, non-numeric, non-finite, and out-of-range coordinates. Reject accuracy worse than the single named threshold of 100 metres.
- Validate before the existing transaction.atomic()/select_for_update() and duplicate-state logic.
- Resolve active WorkLocations through the caller's employee profile company and active-company request context.
- Require the GPS reading to be inside at least one active WorkLocation radius using a plain-Python Haversine helper.
- Use distinguishable status codes/messages for invalid coordinates, poor accuracy, and outside-all-sites. Keep the outside message generic and do not reveal site names, coordinates, or distances.
- On success, keep CheckInResponseSerializer and CheckOutResponseSerializer unchanged. Do not return location data.
- Preserve existing locking, duplicate errors, workflow sync, notifications, and audit behavior.
- Add matched WorkLocation ID/name only to attendance audit metadata.

4. BioTime integration and unified truth
- Do not require GPS fields from BioTime transactions because the current BioTime client receives employee code, punch time, and terminal serial only.
- Keep BioTime records as source=SYSTEM and preserve the rule that BioTime does not overwrite employee or HR-managed records.
- Add the design needed to represent a BioTime punch as physically verified by terminal only if the current scope supports it safely. If terminal-to-WorkLocation mapping is not implemented in this phase, document it as a follow-up rather than pretending BioTime is GPS verified.
- If implementing terminal verification, use company-scoped active terminal mappings and retain terminal serial metadata. Do not call mobile GPS validation for BioTime ingestion.

5. Tests and contract publication
- Add Haversine unit tests using known city-pair distances and boundary behavior.
- Test WorkLocation CRUD, SystemAdmin-only access, company injection, active-company isolation, client company-field rejection, validation, soft delete, and audits.
- Test the toggle-off compatibility path.
- Test enabled check-in/check-out inside radius, boundary, outside radius, invalid coordinates, poor accuracy, missing company, and no active WorkLocations.
- Assert existing duplicate and missing check-in/out errors remain unchanged.
- Test BioTime ingestion remains independent of mobile GPS and does not overwrite employee/HR records.
- Run the complete attendance suite and relevant settings/organization tests.

Publish the contract before declaring completion:
- Update plans/API Route Status Matrix.md and its Last reviewed marker.
- Add a dated Shared Context Log entry wherever the project keeps that log; if it is not present, add the entry to the feature contract document created for this work.
- Document exact model fields/types, migration filename, constraints, routes, methods, permission classes, envelopes, read-only fields, company scoping, toggle behavior, GPS field names/units/types, 100-metre constant location, every failure status/message, unchanged legacy errors, BioTime behavior, audit metadata, and examples for both clients.
- Explicitly state the exact web create/update payload and the exact mobile check-in/check-out payload.

Do not modify frontend or mobile files. Do not claim completion without the required report.

Return exactly this report at the end:

STAGE_COMPLETION_REPORT
stage: backend
status: READY_FOR_VERIFICATION | BLOCKED
base_commit_or_worktree: <value>
changed_files:
  - <path>
implementation_summary:
  - <item>
contract_consumed:
  - <file and section>
contract_published:
  - <file and section>
tests:
  - command: <exact command>
    result: <result>
manual_verification:
  - <item>
known_risks_or_followups:
  - <item or None>
handoff_to_verifier:
  - <exact facts to check>
END_STAGE_COMPLETION_REPORT
```

### Backend verification gate

The verifier checks the actual diff, migration graph, endpoint behavior, permissions, active-company isolation, toggle default, error taxonomy, BioTime non-regression, contract documentation, and complete attendance test output. Only after `decision: VERIFIED` may the mobile or frontend prompt be used.

---

## Prompt 2: Mobile Codex

Copy and send this prompt to Codex working in `MobileApp/` only after backend verification is `VERIFIED`.

```text
Implement Phase 10 of geofenced attendance in D:\\HR-FFI-SYSTEM\\MobileApp.

Backend Phase 8 has been verified. Treat the backend contract as authoritative. Do not modify Backend/ or FrontEnd/.

Read first:
- repository AGENTS.md
- .agents/context/INDEX.md
- .agents/context/mobile_app.md if present
- the verified backend Shared Context Log entry
- plans/API Route Status Matrix.md
- MobileApp/src/features/attendance/attendance-api.ts
- MobileApp/src/features/attendance/AttendanceScreen.tsx
- MobileApp/src/features/attendance/types.ts
- corresponding attendance tests and API client/error parser

Before coding, copy the exact route, field names, types, toggle behavior, status codes, and messages from the verified backend contract. If the contract is missing or contradictory, stop with BLOCKED and report the contradiction. Do not guess.

Implement:
- Request foreground location permission using the existing mobile platform pattern.
- Capture latitude, longitude, and accuracy_meters immediately before check-in and immediately before check-out.
- Send the exact backend field names and decimal-degree/metre units to the existing POST check-in/check-out routes.
- Handle the backend global toggle as documented. If the backend contract provides a supported way to learn the toggle state, use it. Otherwise preserve compatibility by allowing the backend to decide and handle its documented validation response.
- Map the exact backend failure taxonomy to user-facing states: invalid location, poor accuracy, outside every site, duplicate check-in, missing check-in, and generic/network failure.
- Do not display or infer the site name, coordinates, radius, or distance unless the backend contract explicitly returns them. The expected outside-site response is generic.
- Keep existing attendance timeline, loading, retry, and success behavior intact.
- Do not bypass a backend rejection by retrying with empty coordinates when geofencing is enabled.
- Keep permissions and location data ephemeral unless the existing mobile security policy explicitly requires otherwise.

Tests:
- update API tests for the exact request body
- test permission denied, location unavailable, stale/poor accuracy, successful check-in, successful check-out, outside-site response, duplicate/missing-state responses, and network errors
- run the full attendance/mobile test suite and type/lint checks used by the repository

Return the required completion report. Include the backend contract section consumed, exact request body sent, exact response branches implemented, commands and results, and any device-only behavior that still needs manual verification.
```

### Mobile verification gate

The verifier checks that mobile sends only the backend contract fields, uses real permission/error handling, branches on exact statuses, does not expose sensitive location information, passes tests/type checks, and has no backend/frontend changes. Device verification should confirm permission denied, location disabled, poor accuracy, inside-site, and outside-site behavior.

---

## Prompt 3: Claude Frontend

Copy and send this prompt to Claude working in `FrontEnd/` only after backend verification is `VERIFIED`.

```text
Implement Phase 9 of geofenced attendance in D:\\HR-FFI-SYSTEM\\FrontEnd.

Backend Phase 8 has been verified. The backend contract is authoritative. Do not modify Backend/ or MobileApp/.

Read first:
- repository AGENTS.md
- .agents/context/INDEX.md
- .agents/context/frontend_architecture.md
- .agents/context/frontend_design_system.md
- the verified backend Shared Context Log entry
- plans/API Route Status Matrix.md
- existing System Admin routes, API service patterns, company selector behavior, i18n, and tests

Before coding, extract and use the exact verified WorkLocation route, methods, payload fields, read-only fields, envelope, permission behavior, validation responses, active-company header behavior, and settings toggle contract. If any item is absent, stop and return BLOCKED rather than inventing an API.

Implement only the web administration surface:
- Add a SystemAdmin-only WorkLocation management screen using existing routing/layout/permission patterns.
- List active WorkLocations for the selected active company.
- Provide create, edit, and soft-delete actions using the exact backend API contract.
- Provide a map picker if the repository already has an approved map provider/dependency; otherwise use the project-approved approach and document any dependency decision before adding it.
- Let the administrator select coordinates from the map and edit name/radius according to backend validation rules.
- Never allow the client to submit or edit company/company_id; company comes from active-company context.
- Display backend validation and permission errors without changing their semantics.
- Use the project i18n system for every user-facing string, including English and Arabic text.
- Follow existing Ant Design, responsive, loading, empty, confirmation, and error patterns.
- Do not build mobile GPS capture or alter employee check-in/out behavior.

Tests and checks:
- test list/create/update/soft-delete request shapes and response envelopes
- test active-company changes and SystemAdmin-only route protection
- test validation and API error rendering
- test that company fields are not client-writable
- test map selection populates the exact latitude/longitude fields and radius units
- run the relevant frontend tests, type-check, lint, format check, and build

Return the required completion report. Include the exact backend contract sections consumed, routes/components changed, API payload examples, test commands/results, and a screenshot or manual browser verification note if available.
```

### Frontend verification gate

The verifier checks route protection, selected-company behavior, exact API payloads, no client company mutation, bilingual strings, map/provider behavior, tests, type-check, lint, format, build, and that only `FrontEnd/` files changed.

## Final integration verification

After all three stages are individually verified, run the integration gate:

- Backend attendance and BioTime tests.
- Mobile attendance/API tests and type checks.
- Frontend WorkLocation tests, type-check, lint, format check, and build.
- Confirm the backend contract documentation matches both client implementations exactly.
- Confirm a WorkLocation created by Claude’s web UI can be used by mobile GPS validation.
- Confirm BioTime ingestion remains terminal/source verified and is not incorrectly labeled as GPS verified.
- Confirm no client receives matched site name, coordinates, radius, or distance from the attendance success response.

The final verifier should report `VERIFIED` only when all three stage reports, source inspection, contract comparison, and integration checks are complete.
