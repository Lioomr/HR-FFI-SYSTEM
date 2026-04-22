# Skill Invocation

## Start Every Session With (in this order)

1. Root `AGENTS.md`
2. Your agent profile:
   - **Codex** (backend/API) → `.agents/agents/codex_backend.md`
   - **Claude** (frontend) → `.agents/agents/claude_frontend.md`
3. `.agents/agents/skill_binding.md` — which files to load
4. `.agents/context/INDEX.md` — keyword map (load specific context files only on match)

Do **not** pre-load the full `.agents/context/` directory. Pull files by keyword from `INDEX.md`.

## Per-Task Flow

1. Match the task to a row in the routing map below.
2. Load only the rule + key context files listed for that row.
3. Inspect the affected code before editing.
4. Make the smallest change that satisfies the request.
5. Run the most relevant validation command (see your agent profile).
6. Update `.agents/` per the "Keeping `.agents/` Up to Date" triggers in root `AGENTS.md`.

## Ownership Map

| Layer | Agent | Files |
|---|---|---|
| Django models, serializers, views, URLs, permissions, migrations, backend tests | **Codex** | `Backend/**` |
| REST contracts, API response shape, endpoint naming | **Codex** | `Backend/**`, `plans/Global API Rules (v1).txt`, `postman/` |
| React pages, components, routes, Zustand stores, API service files, frontend tests | **Claude** | `FrontEnd/**` |
| Bilingual text / translations | **Claude** | `FrontEnd/src/i18n/translations.ts` |
| Shared knowledge base | both | `.agents/**`, `plans/**` |

A task outside your layer → produce a handoff block (format in your agent profile). Do not cross layers without an explicit user hand-off.

## Agent Routing (rule files)

| Task domain | Rule | Key context |
|---|---|---|
| Backend Django/DRF work | `backend_agent` | `database_schema`, `auth_and_permissions`, plus keyword matches from `INDEX.md` |
| Frontend React work | `frontend_agent` | `frontend_architecture`, `i18n` |
| User flows, HR/admin workflows, acceptance criteria | `product_agent` | relevant screen spec in `plans/` |
| Auth, permissions, tenant boundaries, file access, audit | `security_auditor` | `auth_and_permissions`, `multi_company`, `audit_system` |

## Skill Selection (per feature area)

| What you're doing | Skill | Key context | Agent |
|---|---|---|---|
| Leave types, requests, balances, carry-over, quotas | `leave_management` | `workflow_engine` | Codex |
| Asset CRUD, assignment/return, damage reports, label printing, scanner lookup | `asset_management` | `multi_company`, `audit_system`, `file_uploads` | Codex |
| New or modified approval flow (loan / asset / new domain) | `approval_workflow` | `workflow_engine` | Codex |
| Request obligations or final approval blockers/waivers | `approval_workflow` | `workflow_engine`, `audit_system`, `multi_company` | Codex |
| Approval inbox or action buttons (any role) | `approval_workflow` | `auth_and_permissions` | Claude |
| Workflow security (transition authority, status spoofing) | `security_auditor` | `workflow_engine` | Codex |
| Permission/auth/session bugs or route guards | `session_validation` | `auth_and_permissions` | Claude |
| Notifications (email/WhatsApp/Bird) | — | `notifications` | Codex |
| Export endpoint (CSV/XLSX/PDF) | `data_export` | — | Codex |
| Employee CRUD, status transitions, document expiry, invites | `employee_lifecycle` | — | Codex |
| Payroll run creation, status transitions, payslips | `payroll_processing` | — | Codex |
| Loan requests, approval chain, disbursement, deductions | `loan_management` | `workflow_engine` | Codex |
| Attendance records, check-in/out, HR overrides, BioTime sync | `attendance_management` | `biotime_integration` | Codex |
| File uploads (private storage, size limits, serving) | — | `file_uploads` | Codex |
| BioTime config or sync changes | — | `biotime_integration` + `backend_agent` rule | Codex |
| Multi-company scoping bugs or new company-scoped models | — | `multi_company` + `backend_agent` rule | Codex |
| i18n / bilingual text | — | `i18n` + `frontend_agent` rule | Claude |
| Audit logging gaps | — | `audit_system` + `backend_agent` rule | Codex |
| Role-gated navigation or dynamic sidebar | — | `auth_and_permissions` + `frontend_agent` rule | Claude |
| WebSocket / real-time UI updates | `websocket_event_flow` | `frontend_realtime_ui` | Claude |
| Frontend API integration (new service, loading/error states) | `frontend_api_integration` | — | Claude |
| Frontend error handling (field-level, page-level) | `api_error_handling` | — | Claude |
| UI/UX implementation, visual cleanup | `frontend_ui_direction` | `frontend_design_system` | Claude |
| Frontend performance (memoization, pagination, code split) | `frontend_performance` | — | Claude |
| PDF generation (loans, assets, rents, leaves) | — | `../skills/PDF.md`; for asset labels also `asset_management` | Codex |

## Work Order for Cross-Cutting Features

Only when the user explicitly asks a single agent to handle both ends:

1. Plan / spec (`plans/*.txt` or task description)
2. Backend API (model → serializer → view → URL → permission → tests → migration)
3. Emit the API handoff block (see agent profile)
4. Frontend integration (service → types → page → route guard → i18n)
5. Validation (type-check, lint, tests, build)

Otherwise, each agent stays in its layer and hands off via the block.
