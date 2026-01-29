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
import EmployeesListPage from "../pages/hr/employees/EmployeesListPage";
import CreateEmployeePage from "../pages/hr/employees/CreateEmployeePage";
import ViewEmployeePage from "../pages/hr/employees/ViewEmployeePage";
import EditEmployeePage from "../pages/hr/employees/EditEmployeePage";
import HRDashboardPage from "../pages/hr/dashboard/HRDashboardPage";
import ImportEmployeesEntryPage from "../pages/hr/import/ImportEmployeesEntryPage";
import ImportResultPage from "../pages/hr/import/ImportResultPage";

import ImportHistoryPage from "../pages/hr/import/ImportHistoryPage";
import PayrollDashboardPage from "../pages/hr/payroll/PayrollDashboardPage";
import CreatePayrollRunPage from "../pages/hr/payroll/CreatePayrollRunPage";
import PayrollRunDetailsPage from "../pages/hr/payroll/PayrollRunDetailsPage";
import EmployeePayslipsListPage from "../pages/employee/payslips/EmployeePayslipsListPage";
import EmployeePayslipDetailsPage from "../pages/employee/payslips/EmployeePayslipDetailsPage";

import RequestLeavePage from "../pages/employee/leave/RequestLeavePage";
import MyLeaveRequestsPage from "../pages/employee/leave/MyLeaveRequestsPage";
import MyLeaveBalancePage from "../pages/employee/leave/MyLeaveBalancePage";

import LeaveInboxPage from "../pages/hr/leave/LeaveInboxPage";
import LeaveRequestDetailsPage from "../pages/hr/leave/LeaveRequestDetailsPage";

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
              { path: "hr/dashboard", element: <HRDashboardPage /> },

              // Employee Management
              { path: "hr/employees", element: <EmployeesListPage /> },
              { path: "hr/employees/create", element: <CreateEmployeePage /> },
              { path: "hr/employees/:id", element: <ViewEmployeePage /> },
              { path: "hr/employees/:id/edit", element: <EditEmployeePage /> },

              // Reference Data
              { path: "hr/departments", element: <DepartmentsPage /> },
              { path: "hr/positions", element: <PositionsPage /> },
              { path: "hr/task-groups", element: <TaskGroupsPage /> },
              { path: "hr/sponsors", element: <SponsorsPage /> },

              // Import Employees
              { path: "hr/import/employees", element: <ImportEmployeesEntryPage /> },
              { path: "hr/import/employees/:import_id/result", element: <ImportResultPage /> },
              { path: "hr/import/employees/history", element: <ImportHistoryPage /> },

              // Payroll
              { path: "hr/payroll", element: <PayrollDashboardPage /> },
              { path: "hr/payroll/create", element: <CreatePayrollRunPage /> },
              { path: "hr/payroll/:run_id", element: <PayrollRunDetailsPage /> },

              // Leave Management (HR)
              { path: "hr/leave/requests", element: <LeaveInboxPage /> },
              { path: "hr/leave/requests/:id", element: <LeaveRequestDetailsPage /> },

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
              { path: "employee/payslips", element: <EmployeePayslipsListPage /> },
              { path: "employee/payslips/:id", element: <EmployeePayslipDetailsPage /> },

              // Employee Leave
              { path: "employee/leave/request", element: <RequestLeavePage /> },
              { path: "employee/leave/requests", element: <MyLeaveRequestsPage /> },
              { path: "employee/leave/balance", element: <MyLeaveBalancePage /> },
            ],
          },
        ],
      },
    ],
  },

  // 404
  { path: "*", element: <NotFound404Page /> },
];
