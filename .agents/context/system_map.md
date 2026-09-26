# FFI HR System Map

**Use for architecture, feature planning, or changes crossing modules.** For a narrow task, skip this map and read only the matching row in `INDEX.md`. This is a navigation aid, not a full spec. Verify behavior in source and load detailed rules only when needed.

| Area | Start in code | Focused guide |
|---|---|---|
| Requests and approvals | `Backend/core/services/workflow_engine.py`; request-owning apps such as `leaves/`, `loans/`, `permission_requests/`, `assets/`; web `FrontEnd/src/pages/`, `src/components/requests/`, `src/services/api/`; mobile `MobileApp/src/features/approvals/` | `workflow_engine.md` |
| Employee request summary and trail | `FrontEnd/src/pages/employee/CurrentRequests.tsx`; employee leave pages; `FrontEnd/src/components/requests/`; `src/services/api/employeeCurrentRequestsApi.ts` | `frontend_architecture.md`, then `workflow_engine.md` |
| Identity and permissions | `Backend/accounts/`; `FrontEnd/src/auth/`, `src/routes/routes.tsx`, `src/services/api/apiClient.ts` | `auth_and_permissions.md` |
| Company access | `Backend/organization/` and the relevant domain queryset/permission; active-company header in `apiClient.ts` | `multi_company.md` |
| Employee records and hiring | `Backend/employees/`, `job_offers/`, `contract_ratings/`; matching HR pages and API clients | `database_schema.md`; relevant plan/handoff |
| Attendance and BioTime | `Backend/attendance/`; `FrontEnd/src/pages/hr/attendance/`, attendance API; `MobileApp/src/features/attendance/` | `biotime_integration.md`; attendance API contract in `plans/` |
| Notifications and audit | `Backend/in_app_notifications/`, `Backend/audit/`, domain notification services; `FrontEnd/src/pages/shared/NotificationsPage.tsx`, admin audit page | `notifications.md`, `audit_system.md` |
| Payroll, leave balances, PDFs | `Backend/payroll/`, `Backend/leaves/`; matching HR/employee pages and API clients | `database_schema.md`; `pdf_template_library.md` when PDFs are involved |
| Admin settings and flags | `Backend/admin_portal/`, `FrontEnd/src/services/api/settingsApi.ts`; search for the specific setting's definition and consumers | Load the domain guide; inspect default and consumers in source |
| Docker runtime | `docker-compose.dev.yml`, `docker-compose.yml`, `Backend/Dockerfile`, `FrontEnd/Dockerfile` | `local_dev_setup.md`; for production, `AWS_AGENT_DEPLOYMENT_HANDOFF.md` |

Paths are starting points, not a complete inventory. Search routes, imports, serializers, and tests for the affected behavior.

## How features connect

- A request's business model/service owns its status. Shared `core` workflow services expose actor-specific actions and approval history. The experience may connect a dashboard/list item to a detail page and approver inbox, plus permissions/delegation, company scope, notifications, audit, and obligations.
- For employee request progress, leave is the working UI example: `LeaveApprovalMap` shows stages, `ApprovalTimeline` renders recorded events, and `PendingActionBanner` shows who/stage is waiting. Current Requests is a summary. Annual-settlement cards currently link to the leave-balance page; verify that flow before assuming it has a leave-style detail trail.
- Before proposing a new feature, map its related users, data, screens, rules, and workflows. Reuse shared capabilities when they fit. Standalone is appropriate when purpose or lifecycle is separate; document why. See `AGENTS.md`.
- Before changing a flag/toggle, inspect its definition, default, consumers, and tests. Do not flip it unless the task asks.

## Docker runtime

The local app is a Compose stack of cooperating containers, not one container. In `docker-compose.dev.yml`, the browser reaches React served by Nginx on `localhost:5173`. Nginx proxies API paths over the Docker network to `backend:8000`; the backend port is also published as `localhost:8000` for direct local access. Django, the Celery worker, and Celery Beat use PostgreSQL and Redis; worker and Beat are separate containers. Development also starts Evolution API and its own PostgreSQL/Redis containers for WhatsApp. The marketing site is an opt-in `marketing` profile.

After code or runtime changes, rebuild and recreate every affected service before reporting completion: Backend changes normally mean `backend`, `notification-worker`, and `celery-beat`; frontend changes mean `frontend`. Check service health with Compose. Do not rebuild for documentation-only changes or wipe volumes as a routine rebuild. See `local_dev_setup.md` for commands.

The root `docker-compose.yml` is a dev-compatible configuration with optional `messaging-trial` (Evolution), `memory` (Cognee), and `marketing` profiles. This differs from `docker-compose.dev.yml`, where Evolution is included by default. Inspect the selected Compose file and profiles before explaining why a service is running or stopping it. Named volumes hold database, Redis, private-upload, and provider data; `docker compose down -v` deletes those volumes.

At the last local inspection, `docker ps` showed the screenshot's nine running services: frontend, backend, main database and Redis, notification worker, Celery Beat, and Evolution API with its database and Redis. Treat this as a dated observation, not permanent system state; check `docker compose ps` for current status. The local checkout has no `docker-compose.prod.yml` (only a dated backup). The AWS handoff describes the separate production host/config; do not treat local Compose or this screenshot as proof of current production state.

## Token-efficient lookup

1. Start with `.agents/context/INDEX.md`; read this map only for cross-module work.
2. Load one relevant context guide, then follow only links that apply. Do not read every context file, plan, or historical audit.
3. For an endpoint, check `plans/API Route Status Matrix.md`, then confirm the Django URL, view, serializer, permission, and tests. Security rules are in `SECURITY_POLICY.md`.
4. Treat dated audits and handoffs as evidence from their date, not automatically current instructions.
