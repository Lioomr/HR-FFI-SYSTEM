import { Navigate } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import RequireRole from "./RequireRole";

import LoginPage from "../pages/LoginPage";
import ChangePasswordPage from "../pages/ChangePasswordPage";
import Unauthorized403Page from "../pages/Unauthorized403Page";
import NotFound404Page from "../pages/NotFound404Page";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import AdminUsersListPage from "../pages/admin/AdminUsersListPage";
import AdminUserCreatePage from "../pages/admin/AdminUserCreatePage";
import AdminInvitesPage from "../pages/admin/AdminInvitesPage";
import AdminAuditLogsPage from "../pages/admin/AdminAuditLogsPage";

import AdminSettingsPage from "../pages/admin/AdminSettingsPage";
import EmployeeAttendancePage from "../pages/employee/AttendancePage";
import EmployeeLeavesPage from "../pages/employee/EmployeeLeavesPage";
import HrAttendancePage from "../pages/hr/AttendancePage";
import HrLeaveBalancesPage from "../pages/hr/HrLeaveBalancesPage";
import DepartmentsPage from "../pages/hr/reference/DepartmentsPage";
import PositionsPage from "../pages/hr/reference/PositionsPage";
import TaskGroupsPage from "../pages/hr/reference/TaskGroupsPage";
import SponsorsPage from "../pages/hr/reference/SponsorsPage";
import RouteErrorBoundary from "./RouteErrorBoundary";




import BaseLayout from "../layouts/BaseLayout";

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ padding: 24 }}>
      <h1>{title}</h1>
      <p>Coming soon – Phase 2</p>
    </div>
  );
}

export const routes = [
  // Public
  { path: "/login", element: <LoginPage />, errorElement: <RouteErrorBoundary /> },


  // Authenticated (all roles)
  {
    path: "/change-password",
    element: <RequireAuth />,
    children: [{ index: true, element: <ChangePasswordPage /> }],
  },
  {
    path: "/unauthorized",
    element: <RequireAuth />,
    children: [{ index: true, element: <Unauthorized403Page /> }],
  },

  // Protected area + layout
  {
    path: "/",
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <BaseLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          // System Admin (SystemAdmin)
          {
            element: <RequireRole roles={["SystemAdmin"]} />,
            children: [
              { path: "admin", element: <Navigate to="/admin/dashboard" replace /> },
              { path: "admin/dashboard", element: <AdminDashboardPage /> },
              { path: "admin/users", element: <AdminUsersListPage /> },
              { path: "admin/users/create", element: <AdminUserCreatePage /> },
              { path: "admin/invites", element: <AdminInvitesPage /> },
              { path: "admin/audit-logs", element: <AdminAuditLogsPage /> },
              { path: "admin/settings", element: <AdminSettingsPage /> },

            ],
          },

          // HR Manager routes
          {
            element: <RequireRole roles={["HRManager", "SystemAdmin"]} />,
            children: [
              { path: "hr", element: <Navigate to="/hr/employees" replace /> },
              { path: "hr/dashboard", element: <Placeholder title="HR Dashboard" /> },

              // Employee Management
              { path: "hr/employees", element: <Placeholder title="Employees" /> },
              { path: "hr/employees/create", element: <Placeholder title="Create Employee" /> },
              { path: "hr/employees/:id", element: <Placeholder title="View Employee" /> },
              { path: "hr/employees/:id/edit", element: <Placeholder title="Edit Employee" /> },

              // Reference Data
              { path: "hr/departments", element: <DepartmentsPage /> },
              { path: "hr/positions", element: <PositionsPage /> },
              { path: "hr/task-groups", element: <TaskGroupsPage /> },
              { path: "hr/sponsors", element: <SponsorsPage /> },

              // Existing pages
              { path: "hr/attendance", element: <HrAttendancePage /> },
              { path: "hr/leave-balances", element: <HrLeaveBalancesPage /> },
            ],
          },

          // Employee (placeholders)
          {
            element: <RequireRole roles={["Employee", "SystemAdmin", "HRManager"]} />,
            children: [
              { path: "employee", element: <Navigate to="/employee/attendance" replace /> },
              { path: "employee/home", element: <Placeholder title="Employee Home" /> },
              { path: "employee/attendance", element: <EmployeeAttendancePage /> },
              { path: "employee/leaves", element: <EmployeeLeavesPage /> },
            ],
          },
        ],
      },
    ],
  },

  // 404
  { path: "*", element: <NotFound404Page /> },
];
