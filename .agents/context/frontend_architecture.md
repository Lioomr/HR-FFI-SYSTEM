# Frontend Architecture Context

> **TL;DR (read this only if your task doesn't need the full map):**
> React 18 + TS + Vite + Ant Design + React Router v6 + Zustand + Axios + Vitest. Folders: `components/`, `pages/<role>/`, `services/api/<domain>Api.ts`, `stores/`, `routes/routes.tsx`, `hooks/`, `i18n/`. All HTTP goes through `services/api/apiClient.ts` (JWT refresh + `x-active-company-id` injected). Roles: `SystemAdmin`, `HRManager`, `Manager`, `CEO`, `CFO`, `Employee`. Wrap role pages in `RequireRole`. Zustand only for cross-page state; local `useState` otherwise.

## Stack

| Tool | Version / Notes |
|---|---|
| React | 18 |
| TypeScript | strict mode |
| Vite | build tool + dev server (`npm run dev` on port 5173) |
| Ant Design | UI component library — use existing patterns, do not introduce alternatives |
| React Router | v6 — all routes in `FrontEnd/src/routes/routes.tsx` |
| Zustand | lightweight global state — only for shared state that crosses component trees |
| Axios | HTTP client — configured in `FrontEnd/src/services/api/apiClient.ts` with JWT auto-refresh interceptor |
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
│   ├── apiClient.ts  # Axios instance + JWT refresh interceptor
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

## Pages (~45 total)

**Admin**: AdminDashboardPage, AdminUsersListPage, AdminUserCreatePage, AdminInvitesPage, AdminAuditLogsPage, AdminSettingsPage, BioTimeSettingsPage

**HR**: HRDashboardPage, EmployeesListPage, CreateEmployeePage, ViewEmployeePage, EditEmployeePage, ExpiringDocumentsPage, ImportEmployeesEntryPage, ImportResultPage, ImportHistoryPage, DepartmentsPage, PositionsPage, TaskGroupsPage, SponsorsPage, RentTypesPage, PayrollDashboardPage, CreatePayrollRunPage, PayrollRunDetailsPage, HRAssetsPage, HRRentsPage, LeaveInboxPage, LeaveRequestDetailsPage, LoanInboxPage, HrLoanRequestDetailsPage, DelegationRulesPage, HrLeaveBalancesPage, AnnouncementsManagementPage, CreateAnnouncementPage, RecentActivityPage

**Manager**: ManagerDashboardPage, ManagerTeamRequestsPage, ManagerLeaveRequestDetailsPage, ManagerTeamPage, CreateTeamAnnouncementPage, ManagerLoanRequestsPage, ManagerLoanRequestDetailsPage

**Employee**: DashboardPage, MyProfilePage, EmployeeLeavesPage, RequestLeavePage, MyLeaveRequestsPage, MyLeaveBalancePage, RequestLoanPage, MyLoanRequestsPage, MyAssetsPage, EmployeePayslipsListPage, EmployeePayslipDetailsPage

**CEO**: CEODashboardPage, CEOLeaveInboxPage, CEOLoanInboxPage

**Shared**: UserProfilePage, AnnouncementsPage

## API Service Layer Rules

- All backend calls go through `services/api/<domain>Api.ts` — never put raw Axios calls in pages or components.
- The Axios interceptor in `apiClient.ts` handles JWT refresh automatically — do not duplicate refresh logic.
- Every API service function should type both request params and response using `apiTypes.ts` or local types.
- The active company header (`x-active-company-id`) is injected by the Axios instance — do not manually add it in service functions.

## State Management Rules

- **Local state** (`useState`) for UI state (modal open, form values, loading).
- **Zustand stores** only for state shared across multiple pages/components (employee list, attendance, language).
- Do not add new Zustand stores for single-page data — use local state or React Query patterns.

## Role-Based Routes

`RequireRole` in `routes.tsx` takes a `role` string. Roles: `SystemAdmin`, `HRManager`, `Manager`, `CEO`, `CFO`, `Employee`. Specialized: `RequireCEOApprover`, `RequireCFOApprover`.

Always wrap new role-specific pages with the appropriate `RequireRole` guard.
