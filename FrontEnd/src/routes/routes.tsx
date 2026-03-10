import { Navigate } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import RequireRole from "./RequireRole";
import RequireFinanceApprover from "./RequireFinanceApprover";
import RequireCFOApprover from "./RequireCFOApprover";
import RequireCEOApprover from "./RequireCEOApprover";

import LoginPage from "../pages/LoginPage";
import RegisterInvitePage from "../pages/RegisterInvitePage";
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
import RentTypesPage from "../pages/hr/reference/RentTypesPage";
import EmployeesListPage from "../pages/hr/employees/EmployeesListPage";
import CreateEmployeePage from "../pages/hr/employees/CreateEmployeePage";
import ViewEmployeePage from "../pages/hr/employees/ViewEmployeePage";
import EditEmployeePage from "../pages/hr/employees/EditEmployeePage";
import ExpiringDocumentsPage from "../pages/hr/employees/ExpiringDocumentsPage";
import HRDashboardPage from "../pages/hr/dashboard/HRDashboardPage";
import ImportEmployeesEntryPage from "../pages/hr/import/ImportEmployeesEntryPage";
import ImportResultPage from "../pages/hr/import/ImportResultPage";

import ImportHistoryPage from "../pages/hr/import/ImportHistoryPage";
import PayrollDashboardPage from "../pages/hr/payroll/PayrollDashboardPage";
import CreatePayrollRunPage from "../pages/hr/payroll/CreatePayrollRunPage";
import PayrollRunDetailsPage from "../pages/hr/payroll/PayrollRunDetailsPage";
import HRAssetsPage from "../pages/hr/assets/HRAssetsPage";
import HRRentsPage from "../pages/hr/rents/HRRentsPage";
import EmployeePayslipsListPage from "../pages/employee/payslips/EmployeePayslipsListPage";
import EmployeePayslipDetailsPage from "../pages/employee/payslips/EmployeePayslipDetailsPage";

import RequestLeavePage from "../pages/employee/leave/RequestLeavePage";
import MyLeaveRequestsPage from "../pages/employee/leave/MyLeaveRequestsPage";
import MyLeaveBalancePage from "../pages/employee/leave/MyLeaveBalancePage";
import RequestLoanPage from "../pages/employee/loan/RequestLoanPage";
import MyLoanRequestsPage from "../pages/employee/loan/MyLoanRequestsPage";
import EmployeeLoanRequestDetailsPage from "../pages/employee/loan/LoanRequestDetailsPage";
import MyAssetsPage from "../pages/employee/assets/MyAssetsPage";

import LeaveInboxPage from "../pages/hr/leave/LeaveInboxPage";
import LeaveRequestDetailsPage from "../pages/hr/leave/LeaveRequestDetailsPage";
import HRAttendancePage from "../pages/hr/attendance/HRAttendancePage";
import LoanInboxPage from "../pages/hr/loan/LoanInboxPage";
import HrLoanRequestDetailsPage from "../pages/hr/loan/LoanRequestDetailsPage";
import ManagerDashboardPage from "../pages/manager/ManagerDashboardPage";
import ManagerTeamRequestsPage from "../pages/manager/ManagerTeamRequestsPage";
import ManagerLeaveRequestDetailsPage from "../pages/manager/ManagerLeaveRequestDetailsPage";
import ManagerTeamPage from "../pages/manager/ManagerTeamPage";
import CreateTeamAnnouncementPage from "../pages/manager/CreateTeamAnnouncementPage";
import ManagerLoanRequestsPage from "../pages/manager/ManagerLoanRequestsPage";
import ManagerLoanRequestDetailsPage from "../pages/manager/ManagerLoanRequestDetailsPage";

import MyProfilePage from "../pages/employee/MyProfilePage";
import UserProfilePage from "../pages/shared/UserProfilePage";
import DashboardPage from "../pages/employee/DashboardPage";

// Announcements
import AnnouncementsManagementPage from "../pages/hr/announcements/AnnouncementsManagementPage";
import CreateAnnouncementPage from "../pages/hr/announcements/CreateAnnouncementPage";
import AnnouncementsPage from "../pages/announcements/AnnouncementsPage";

// CEO
import CEODashboardPage from "../pages/ceo/CEODashboardPage";
import CEOLeaveInboxPage from "../pages/ceo/CEOLeaveInboxPage";
import CEOTeamPage from "../pages/ceo/CEOTeamPage";
import CEOLoanRequestsPage from "../pages/ceo/CEOLoanRequestsPage";
import CEOLoanRequestDetailsPage from "../pages/ceo/CEOLoanRequestDetailsPage";
import CEOAttendancePage from "../pages/ceo/CEOAttendancePage";
import CEOAssetDamageReportsPage from "../pages/ceo/CEOAssetDamageReportsPage";
import CEOAssetReturnRequestsPage from "../pages/ceo/CEOAssetReturnRequestsPage";
import CFODashboardPage from "../pages/cfo/CFODashboardPage";
import CFOLoanRequestsPage from "../pages/cfo/CFOLoanRequestsPage";
import CFOLoanRequestDetailsPage from "../pages/cfo/CFOLoanRequestDetailsPage";

import RouteErrorBoundary from "./RouteErrorBoundary";




import BaseLayout from "../layouts/BaseLayout";



export const routes = [
  // Public
  { path: "/login", element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  { path: "/register", element: <RegisterInvitePage />, errorElement: <RouteErrorBoundary /> },


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
              { path: "admin/profile", element: <UserProfilePage /> },
            ],
          },

          // HR Manager routes
          {
            element: <RequireRole roles={["HRManager", "SystemAdmin"]} />,
            children: [
              { path: "hr", element: <Navigate to="/hr/employees" replace /> },
              { path: "hr/dashboard", element: <HRDashboardPage /> },
              { path: "hr/profile", element: <UserProfilePage /> },
              { path: "hr/attendance", element: <HRAttendancePage /> },
              { path: "hr/invites", element: <AdminInvitesPage /> },

              // Employee Management
              { path: "hr/employees", element: <EmployeesListPage /> },
              { path: "hr/employees/create", element: <CreateEmployeePage /> },
              { path: "hr/employees/:id", element: <ViewEmployeePage /> },
              { path: "hr/employees/:id/edit", element: <EditEmployeePage /> },
              { path: "hr/employees/expiries", element: <ExpiringDocumentsPage /> },

              // Reference Data
              { path: "hr/departments", element: <DepartmentsPage /> },
              { path: "hr/positions", element: <PositionsPage /> },
              { path: "hr/task-groups", element: <TaskGroupsPage /> },
              { path: "hr/sponsors", element: <SponsorsPage /> },
              { path: "hr/rent-types", element: <RentTypesPage /> },
              { path: "hr/rents", element: <HRRentsPage /> },

              // Import Employees
              { path: "hr/import/employees", element: <ImportEmployeesEntryPage /> },
              { path: "hr/import/employees/:import_id/result", element: <ImportResultPage /> },
              { path: "hr/import/employees/history", element: <ImportHistoryPage /> },

              // Payroll
              { path: "hr/payroll", element: <PayrollDashboardPage /> },
              { path: "hr/payroll/create", element: <CreatePayrollRunPage /> },
              { path: "hr/payroll/:run_id", element: <PayrollRunDetailsPage /> },
              { path: "hr/assets", element: <HRAssetsPage /> },

              // Leave Management (HR)
              { path: "hr/leave/requests", element: <LeaveInboxPage /> },
              { path: "hr/leave/requests/:id", element: <LeaveRequestDetailsPage /> },
              { path: "hr/loan-requests", element: <LoanInboxPage /> },
              { path: "hr/loan-requests/:id", element: <HrLoanRequestDetailsPage /> },

              // Announcements (HR)
              { path: "hr/announcements", element: <AnnouncementsManagementPage /> },
              { path: "hr/announcements/create", element: <CreateAnnouncementPage /> },

              // Existing pages
              { path: "hr/attendance", element: <HrAttendancePage /> },
              { path: "hr/leave-balances", element: <HrLeaveBalancesPage /> },
            ],
          },


          // Employee (placeholders)
          {
            element: <RequireRole roles={["Employee", "SystemAdmin", "HRManager", "Manager"]} />,
            children: [
              { path: "employee", element: <Navigate to="/employee/dashboard" replace /> },
              { path: "employee/home", element: <Navigate to="/employee/dashboard" replace /> },
              { path: "employee/dashboard", element: <DashboardPage /> },
              { path: "employee/profile", element: <MyProfilePage /> },
              { path: "employee/attendance", element: <EmployeeAttendancePage /> },
              { path: "employee/leaves", element: <EmployeeLeavesPage /> },
              { path: "employee/payslips", element: <EmployeePayslipsListPage /> },
              { path: "employee/payslips/:id", element: <EmployeePayslipDetailsPage /> },

              // Employee Leave
              { path: "employee/leave/request", element: <RequestLeavePage /> },
              { path: "employee/leave/requests", element: <MyLeaveRequestsPage /> },
              { path: "employee/leave/balance", element: <MyLeaveBalancePage /> },
              { path: "employee/loans/request", element: <RequestLoanPage /> },
              { path: "employee/loans", element: <MyLoanRequestsPage /> },
              { path: "employee/loans/:id", element: <EmployeeLoanRequestDetailsPage /> },
              { path: "employee/assets", element: <MyAssetsPage /> },

              // Announcements
              { path: "employee/announcements", element: <AnnouncementsPage /> },
            ],
          },

          // Manager Routes
          {
            element: <RequireRole roles={["Manager", "SystemAdmin"]} />,
            children: [
              { path: "manager", element: <Navigate to="/manager/dashboard" replace /> },
              { path: "manager/dashboard", element: <ManagerDashboardPage /> },
              { path: "manager/team-requests", element: <ManagerTeamRequestsPage /> },
              { path: "manager/team", element: <ManagerTeamPage /> },
              { path: "manager/leave/requests/:id", element: <ManagerLeaveRequestDetailsPage /> },
              { path: "manager/loan-requests", element: <ManagerLoanRequestsPage /> },
              { path: "manager/loan-requests/:id", element: <ManagerLoanRequestDetailsPage /> },
              { path: "manager/announcements", element: <AnnouncementsPage /> },
              { path: "manager/announcements/create", element: <CreateTeamAnnouncementPage /> },
              { path: "manager/profile", element: <UserProfilePage /> },
            ]
          },

          // Admin Announcements
          {
            element: <RequireRole roles={["SystemAdmin"]} />,
            children: [
              { path: "admin/announcements", element: <AnnouncementsPage /> },
            ]
          },

          // CEO Routes
          {
            element: <RequireRole roles={["CEO", "SystemAdmin"]} />,
            children: [
              { path: "ceo", element: <Navigate to="/ceo/dashboard" replace /> },
              { path: "ceo/dashboard", element: <CEODashboardPage /> },
              { path: "ceo/leave/requests", element: <CEOLeaveInboxPage /> },
              { path: "ceo/team-requests", element: <ManagerTeamRequestsPage /> },
              { path: "ceo/team", element: <CEOTeamPage /> },
              { path: "ceo/announcements", element: <AnnouncementsPage /> },
              { path: "ceo/announcements/create", element: <CreateTeamAnnouncementPage /> },
              { path: "ceo/profile", element: <UserProfilePage /> },
            ]
          },

          // CEO Loan Approver Routes (role OR profile-based approver)
          {
            element: <RequireCEOApprover />,
            children: [
              { path: "ceo/loan-requests", element: <CEOLoanRequestsPage /> },
              { path: "ceo/loan-requests/:id", element: <CEOLoanRequestDetailsPage /> },
              { path: "ceo/attendance", element: <CEOAttendancePage /> },
              { path: "ceo/assets/damage-reports", element: <CEOAssetDamageReportsPage /> },
              { path: "ceo/assets/return-requests", element: <CEOAssetReturnRequestsPage /> },
            ],
          },

          // CFO Routes (role OR profile-based approver)
          {
            element: <RequireCFOApprover />,
            children: [
              { path: "cfo", element: <Navigate to="/cfo/dashboard" replace /> },
              { path: "cfo/dashboard", element: <CFODashboardPage /> },
              { path: "cfo/loan-requests", element: <CFOLoanRequestsPage /> },
              { path: "cfo/loan-requests/:id", element: <CFOLoanRequestDetailsPage /> },
              { path: "cfo/profile", element: <UserProfilePage /> },
            ],
          },

          // Finance Approver Routes (accountant profile based)
          {
            element: <RequireFinanceApprover />,
            children: [
              { path: "finance/loan-requests", element: <LoanInboxPage /> },
              { path: "finance/loan-requests/:id", element: <HrLoanRequestDetailsPage /> },
            ],
          },
        ],
      },
    ],
  },

  // 404
  { path: "*", element: <NotFound404Page /> },
];



