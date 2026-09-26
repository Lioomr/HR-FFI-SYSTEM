# Frontend Architecture Context

> **TL;DR (read this only if your task doesn't need the full map):**
> React 19 + TS + Vite + Ant Design + React Router v7 + Zustand + Axios + Vitest. Folders: `components/`, `pages/<role>/`, `services/api/<domain>Api.ts`, `stores/`, `routes/routes.tsx`, `hooks/`, `i18n/`. All HTTP goes through `services/api/apiClient.ts` (JWT + `x-active-company-id` injected). Roles: `SystemAdmin`, `HRManager`, `Manager`, `CEO`, `CFO`, `Employee`. Wrap role pages in `RequireRole`. Zustand only for cross-page state; local `useState` otherwise.

## Stack

| Tool | Version / Notes |
|---|---|
| React | 19 (installed frontend dependency) |
| TypeScript | strict mode |
| Vite | build tool + dev server (`npm run dev` on port 5173) |
| Ant Design | UI component library — use existing patterns, do not introduce alternatives |
| React Router | v7 (installed frontend dependency; definitions remain in `FrontEnd/src/routes/routes.tsx`) |
| Zustand | lightweight global state — only for shared state that crosses component trees |
| Axios | HTTP client — configured in `FrontEnd/src/services/api/apiClient.ts` with JWT attachment and unauthorized cleanup |
| Vitest + Testing Library | unit/component tests |
| ESLint + Prettier | code quality (`npm run lint`, `npm run format:check`) |

## Folder Structure

```
FrontEnd/src/
├── components/       # Reusable UI (layouts, tables, forms, modals)
├── pages/            # Role-grouped page components
│   ├── admin/        # SystemAdmin pages
│   ├── hr/           # HRManager pages
│   ├── manager/      # Manager pages
│   ├── employee/     # Employee self-service pages
│   ├── ceo/          # CEO pages
│   └── shared/       # Shared across roles (profile, announcements)
├── services/api/     # All backend communication
│   ├── apiClient.ts  # Axios instance + JWT attachment/401 cleanup
│   ├── apiTypes.ts   # Shared request/response types
│   ├── apiHelpers.ts # Utility functions
│   ├── tokenStorage.ts
│   └── <domain>Api.ts  # One file per domain (authApi, leaveApi, etc.)
├── stores/           # Zustand stores (attendanceStore, hrEmployeeListStore, i18nStore)
├── routes/           # Route definitions + role guards
│   └── routes.tsx    # RequireAuth, RequireRole, RouteErrorBoundary wrappers
├── hooks/            # Custom React hooks
├── i18n/             # Bilingual support (translations.ts, useI18n.ts, i18nStore.ts)
└── App.tsx
```

## Feature navigation and linked request pages

Page inventory changes frequently; find current routes in `FrontEnd/src/routes/` and `FrontEnd/src/pages/` instead of relying on a copied page count or stale list.

The employee dashboard's `CurrentRequests` panel (`pages/employee/CurrentRequests.tsx`) aggregates leave, permission, loan, and annual-leave-settlement summaries through `services/api/employeeCurrentRequestsApi.ts`. Cards show the current status and link to a request-specific experience. Before changing that panel or adding a request type, trace its API source, route, detail page, backend transition/history, permissions, and tests.

### Approval trail UX example

- `pages/employee/leave/MyLeaveRequestsPage.tsx` renders `LeaveApprovalMap` in each leave row.
- `pages/employee/leave/EmployeeLeaveRequestDetailsPage.tsx` shows `LeaveApprovalMap`, `ApprovalTimeline`, `PendingActionBanner`, and Business Trip obligations.
- `pages/hr/leave/LeaveRequestDetailsPage.tsx` and the delegated leave inbox reuse parts of this pattern.
- `components/requests/ApprovalTimeline.tsx` renders the actual `workflow.history`; `ApprovalFlowMap` renders stage progress.

Current Requests is currently a **summary with links**, not an inline approval timeline. Treat leave as the reference for what an employee can inspect after opening a request. For any request-progress UI task, ensure the employee can reach the real history and current waiting actor/stage. Use that request kind's authorized detail API and workflow snapshot; do not build history from status text. Annual-leave settlements currently link to the leave-balance page, so verify the actual settlement detail/history route before claiming it has the same trail.

Before editing a request experience, map its linked dashboard/list/detail routes, API client, backend serializer and service, workflow adapter/history, authorization/delegation, company scope, notifications/audit, obligations, feature flags, translations, and tests. Inspect toggle defaults and every relevant consumer first; do not change toggle values unless requested.

## API Service Layer Rules

- All backend calls go through `services/api/<domain>Api.ts` — never put raw Axios calls in pages or components.
- `apiClient.ts` attaches the current JWT and active-company header, automatically refreshes an expired access token once, retries the original request, and clears the session if refresh fails. Verify this behavior in `FrontEnd/src/services/api/apiClient.ts` before changing authentication.
- Notifications use `NotificationPollingManager` (immediate REST hydration, then every 20 seconds). The WebSocket compatibility path is deliberately unavailable with close code `4403`; no frontend notification code constructs a WebSocket URL or places JWTs in it.
- Every API service function should type both request params and response using `apiTypes.ts` or local types.
- The active company header (`x-active-company-id`) is injected by the Axios instance — do not manually add it in service functions.

## State Management Rules

- **Local state** (`useState`) for UI state (modal open, form values, loading).
- **Zustand stores** only for state shared across multiple pages/components (employee list, attendance, language).
- Do not add new Zustand stores for single-page data — use local state or React Query patterns.
- New approve/reject list-view actions should update local list state optimistically (remove/restore the row) rather than `await`-then-`load()`. See `reliability_and_perf_fixes.md` for the pattern and the full list of screens already converted.

## Role-Based Routes

`RequireRole` in `routes.tsx` takes a `role` string. Roles: `SystemAdmin`, `HRManager`, `Manager`, `CEO`, `CFO`, `Employee`. Specialized: `RequireCEOApprover`, `RequireCFOApprover`.

Always wrap new role-specific pages with the appropriate `RequireRole` guard.
