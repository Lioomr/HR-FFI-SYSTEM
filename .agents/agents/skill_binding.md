# Skill Binding

Project-local memory for coding agents on FFI HR System. **Token discipline is a first-class goal** — load narrow, not wide.

## Which Agent Are You?

This repo is worked by **two AI coding agents** with split ownership:

| Agent | Owns | Entry file |
|---|---|---|
| **Codex** | `Backend/` (Django + DRF) and API contracts | `.agents/agents/codex_backend.md` |
| **Claude** | `FrontEnd/` (React + TS + Ant Design) | `.agents/agents/claude_frontend.md` |

Open **your** profile file first. It lists the minimal load set and the handoff format for crossing the boundary.

## Always-Load Baseline (both agents)

- `.agents/rules/global_rules.md` — project principles
- `.agents/rules/task_execution.md` — how to approach a task
- `.agents/context/INDEX.md` — keyword map for `.agents/context/` (load specific files only on keyword match)

Do **not** reflexively load `system_design.md` or `local_dev_setup.md`. They are referenced from `INDEX.md`; read them only when a task actually needs them.

## Load Based on Task Domain

**Backend / API (Codex)** — start from `.agents/agents/codex_backend.md`. Extra files by keyword only:
- `.agents/rules/api_conventions.md` — when adding or renaming endpoints
- `.agents/context/database_schema.md` — model relations
- `.agents/context/auth_and_permissions.md` — permission classes, groups

**Frontend (Claude)** — start from `.agents/agents/claude_frontend.md`. Extra files by keyword only:
- `.agents/context/frontend_architecture.md` — folder map, pages list
- `.agents/context/i18n.md` — any user-facing text
- `.agents/context/frontend_design_system.md` — visual/UX conventions

**Security (either agent)**:
- `.agents/rules/security_auditor.md`
- `.agents/context/auth_and_permissions.md`
- `.agents/context/multi_company.md`
- `.agents/context/audit_system.md`

**Leave / Loan / Asset approvals (any domain with a chain)**:
- `.agents/skills/approval_workflow.md`
- `.agents/context/workflow_engine.md`
- Plus the specific skill: `leave_management.md` / `loan_management.md` / `asset_management.md` / etc.

**BioTime / Attendance (Codex)**:
- `.agents/context/biotime_integration.md`
- `.agents/skills/attendance_management.md`

**Multi-Company scoping (Codex)**:
- `.agents/context/multi_company.md`

**Notifications (Codex — Bird / Email / WhatsApp)**:
- `.agents/context/notifications.md`

**File Uploads (Codex)**:
- `.agents/context/file_uploads.md`

**Data Export (Codex)**:
- `.agents/skills/data_export.md`

**Product / Admin UX (Claude)**:
- `.agents/rules/product_agent.md`
- `.agents/context/admin_dashboard_design.md`

## Cross-Boundary Work

Most tasks touch **either** backend or frontend, not both. When a feature genuinely spans both:

1. **Codex ships first** — model, serializer, view, URL, permission, tests, migration, and an API handoff block (see `codex_backend.md`).
2. **Claude consumes the handoff block** — builds the service, types, page, route guard, i18n keys.

Neither agent should read the other side's code in full. Use the handoff block as the contract. If it is missing or ambiguous, ask rather than guess.

## Routing Guide

See `.agents/agents/skill_invocation.md` for the full task → skill map.

## Plans as Contracts

If a plan file exists under `plans/`, treat it as the functional contract. Update it when behavior intentionally changes.
