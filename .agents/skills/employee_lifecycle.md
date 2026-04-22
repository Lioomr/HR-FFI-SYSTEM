# Employee Lifecycle Skill

Use when working with employee creation, status transitions, document expiry, or onboarding (invites).

## Status States

`EmployeeProfile.status`:
- `ACTIVE` — normal working state
- `SUSPENDED` — temporarily restricted (no leave/loan/payroll processing)
- `TERMINATED` — end of employment (cannot be re-activated via normal flow)

Transitions:
- ACTIVE → SUSPENDED (HR/Admin action)
- SUSPENDED → ACTIVE (HR/Admin reinstatement)
- ACTIVE | SUSPENDED → TERMINATED (HR/Admin termination)

Status changes must emit `AuditLog` entries: `employee_status_changed`.

## Bilingual Fields

`EmployeeProfile` has bilingual name/title fields:
- `name_en`, `name_ar`
- `position_en`, `position_ar` (from linked `Position`)

Frontend must read the appropriate field based on `language` from `useI18n`.

## Employee ID Generation

Employee IDs use the company's `employee_id_prefix` from `OrganizationNode`. Always respect this prefix when generating employee IDs on new employee creation.

## Document Expiry Tracking

`EmployeeProfile` tracks document expiry dates (`passport_expiry`, `iqama_expiry`, etc.).
- `ExpiringDocumentsPage` (HR) shows employees with upcoming expiry.
- When adding new document fields, add them to the expiry query in `employees/views.py`.

## Invite-Based Onboarding

New users are onboarded via `Invite`:
1. HR/Admin creates an `Invite` (email, role, company).
2. `Invite.token` is emailed to the user.
3. User registers via `POST /invites/<token>/register/` → creates `User` account.
4. `Invite.status` updated to ACCEPTED.
5. `EmployeeProfile` is created/linked at registration or by HR afterward.

Invite expiry: configurable TTL. Check `Invite.expiry` before allowing registration.

## Checklist for Employee Features

- [ ] Status transitions are validated server-side.
- [ ] Status changes emit `AuditLog` entries.
- [ ] All employee data is scoped to `company` FK.
- [ ] Bilingual fields (`name_en`, `name_ar`) are populated for both languages.
- [ ] `employee_id_prefix` is respected when generating employee IDs.
- [ ] Document expiry fields are included in the expiry monitoring query.
- [ ] Frontend displays name/position in the active language.
