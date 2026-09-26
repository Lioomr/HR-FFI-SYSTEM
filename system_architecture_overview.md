# HR-FFI System Architecture

**Last aligned with repository:** 2026-09-26

**Purpose:** A short architecture map for developers and AI agents. This is not an endpoint contract. Verify exact routes, fields, permissions, and runtime settings in the source and the linked authority documents below.

For a compact feature-to-code index and token-efficient agent workflow, see `.agents/context/system_map.md`.

## Technology

- Backend: Django 6.1.1 and Django REST Framework; PostgreSQL is the production database. See `Backend/requirements.txt` and `Backend/config/settings.py` for the installed versions and runtime configuration.
- Web client: React 19, TypeScript, Vite, Ant Design, React Router 7, and Zustand. See `FrontEnd/package.json`.
- Employee mobile client: Expo SDK 57, React Native 0.86, TypeScript, and Expo Router. See `MobileApp/package.json` and `MobileApp/README.md`.
- Background work and notifications use Celery/Redis and configured providers. Provider enablement and credentials come from runtime settings; do not assume that a provider or toggle is enabled.

## Repository map

| Location | Responsibility |
|---|---|
| `Backend/` | Django project, domain apps, API, workflow services, and backend tests |
| `FrontEnd/` | Browser app, role pages, shared request components, API clients, and frontend tests |
| `MobileApp/` | Employee self-service mobile app and its feature modules |
| `plans/` | Product/API contracts, route status, feature handoffs, and dated audit evidence |
| `.agents/context/` | Concise codebase maps; start at `INDEX.md` and read only the relevant context |
| `SECURITY_POLICY.md`, `AGENTS.md` | Security requirements and repository-wide instructions |

Use the filesystem and `INSTALLED_APPS` in `Backend/config/settings.py` as the current inventory of backend modules. App folders change over time; this page intentionally avoids a fixed app count.

## Important cross-feature flow: requests and approvals

An employee request is connected across several layers: a domain model and service own its business status; the shared workflow engine projects approval state and history; serializers expose actor-specific workflow data; role-specific inboxes and employee request pages consume it; notifications and audit records report transitions.

The employee dashboard's **Current Requests** panel is a summary, not the approval trail. It aggregates leave, permission, loan, and annual-leave-settlement requests in `FrontEnd/src/services/api/employeeCurrentRequestsApi.ts` and renders them in `FrontEnd/src/pages/employee/CurrentRequests.tsx`. A request's card must take the employee to the correct detail experience to inspect its progress. For leave, use `MyLeaveRequestsPage` and `EmployeeLeaveRequestDetailsPage` as working examples: they use `LeaveApprovalMap`, and the detail page also uses `ApprovalTimeline`, `PendingActionBanner`, and the Business Trip `RequestObligationsPanel`.

When a request page is changed or a new request kind is added, agents must trace the linked list/dashboard card, route, API client, serializer, domain transition service, workflow adapter/history, authorization and delegation, company scope, audit/notifications, related obligations, translations, and tests before editing. Reuse real workflow history and the request-kind detail API; never invent an approval trail from the current status alone. Check relevant feature flags and runtime toggles first, including defaults and consumers. Do not change toggle values unless the task asks for that.

**Known UX follow-up:** annual-leave settlements in Current Requests currently link to the leave-balance page rather than an individual settlement detail route. Verify the current route and API before claiming that this request kind has the same detail-level trail as leave. This is a documented gap, not evidence that settlement behavior should be changed without a scoped task.

## Workflow and data authority

- Domain request models own business status. Workflow models in `Backend/core/` are a projection and history layer; transition domain state through its service and synchronize workflow history using the established service helpers.
- The workflow response can contain `current_actor`, `can_approve`, `can_reject`, and `history`. These values are actor-specific. Workflow-backed detail serializers must receive request context.
- Delegation changes who may act on an approval stage; it does not transfer ownership of the request or silently grant unrelated access.
- Company access is determined by backend organization-scope helpers and permissions. Do not assume every model has a company field or trust a client-supplied company selector as authorization.
- Sensitive actions should preserve existing audit records, validation, and notification behavior.

## Before changing a feature

1. Read `AGENTS.md` and `.agents/context/INDEX.md`; load the relevant context and domain rules.
2. Check `plans/API Route Status Matrix.md`, then verify the live Django URL, ViewSet, serializer, permissions, service, and tests. For mobile work, follow the source hierarchy in `plans/Employee Mobile App Master Plan.md`.
3. Search or query the code graph for connected pages, APIs, workflow stages, shared components, flags, and tests. Identify what consumes the behavior across web, mobile, backend, and notifications before editing.
4. Keep the existing user journey and linked features in sync. Update the matching documentation and regression tests when behavior changes.

## Documentation authority

Follow `SECURITY_POLICY.md`, `AGENTS.md`, `plans/Employee Mobile App Master Plan.md` for mobile scope, `plans/Global API Rules (v1).txt` for API conventions, and `plans/API Route Status Matrix.md` for route status, plus the relevant `.agents/context/`, rules, and skills. Dated audit reports and handoffs are evidence from their stated date, not automatically current operating instructions. If documentation and implementation disagree, verify the implementation and record the mismatch before changing the contract.
