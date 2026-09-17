import { Suspense } from "react";
import { Navigate, useParams } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import RequireRole from "./RequireRole";
import RequireManagerAccess from "./RequireManagerAccess";
import RequireCompletedSelfRating from "./RequireCompletedSelfRating";
import RequireCompletedManagerRating from "./RequireCompletedManagerRating";
import RequireFinanceApprover from "./RequireFinanceApprover";
import RequireCFOApprover from "./RequireCFOApprover";
import RequireCEOApprover from "./RequireCEOApprover";
import HomeRedirect from "./HomeRedirect";
import LoadingState from "../components/ui/LoadingState";

// Small, always-needed entry/exit screens stay eagerly bundled: they are on
// the critical path for every unauthenticated visitor (or are the fallback
// error/404 screens), so lazy-loading them would only add a network
// round-trip with no benefit.
import LoginPage from "../pages/LoginPage";
import ChangePasswordPage from "../pages/ChangePasswordPage";
import ResetPasswordPage from "../pages/ResetPasswordPage";
import NotFound404Page from "../pages/NotFound404Page";

// Everything else is a route-level page split into its own chunk. See
// ./lazyPages.tsx for the React.lazy() definitions — route tests that assert
// route -> component identity import the same lazy-wrapped references from
// there instead of the raw page modules.
import {
  AdminDashboardPage,
  AdminUsersListPage,
  AdminUserCreatePage,
  AdminInvitesPage,
  AdminAuditLogsPage,
  AdminWhatsAppIntegrationPage,
  AdminSettingsPage,
  AdminWorkLocationsPage,
  BioTimeSettingsPage,
  DelegationRulesPage,
  UserProfilePage,
  MyProfilePage,
  DepartmentsPage,
  PositionsPage,
  TaskGroupsPage,
  SponsorsPage,
  RentTypesPage,
  EmployeesListPage,
  CreateEmployeePage,
  ViewEmployeePage,
  EditEmployeePage,
  ExpiringDocumentsPage,
  HRDashboardPage,
  RecentActivityPage,
  ImportEmployeesEntryPage,
  ImportResultPage,
  ImportHistoryPage,
  PayrollDashboardPage,
  CreatePayrollRunPage,
  PayrollRunDetailsPage,
  HRAssetsPage,
  AssetLookupPage,
  LabelJobsHistoryPage,
  HRRentsPage,
  TemplateLibraryPage,
  JobOffersListPage,
  JobOfferFormPage,
  JobOfferDetailPage,
  StartingWorkAcknowledgmentsListPage,
  StartingWorkAcknowledgmentDetailPage,
  EmployeePayslipsListPage,
  EmployeePayslipDetailsPage,
  EmployeeLeavesPage,
  RequestLeavePage,
  MyLeaveRequestsPage,
  MyLeaveBalancePage,
  EmployeeLeaveRequestDetailsPage,
  DelegatedLeaveInboxPage,
  RequestLoanPage,
  MyLoanRequestsPage,
  EmployeeLoanRequestDetailsPage,
  MyAssetsPage,
  EmployeeAttendancePage,
  DashboardPage,
  LeaveInboxPage,
  AnnualLeaveSettlementsPage,
  LeaveRequestDetailsPage,
  LoanInboxPage,
  HrLoanRequestDetailsPage,
  HrLeaveBalancesPage,
  AttendancePolicyPage,
  ManagerDashboardPage,
  ManagerTeamRequestsPage,
  ManagerLeaveRequestDetailsPage,
  ManagerTeamPage,
  CreateTeamAnnouncementPage,
  ManagerLoanRequestsPage,
  ManagerLoanRequestDetailsPage,
  ManagerEmployeeProfilePage,
  ManagerAttendancePage,
  PermissionRequestDetailPage,
  PermissionRequestFormPage,
  HrPermissionRequestsPage,
  ManagerPermissionRequestsPage,
  MyPermissionRequestsPage,
  AnnouncementsManagementPage,
  CreateAnnouncementPage,
  EditAnnouncementPage,
  AnnouncementsPage,
  CEODashboardPage,
  CEOLeaveInboxPage,
  CEOAnnualLeaveSettlementsPage,
  CEOTeamPage,
  CEOLoanRequestsPage,
  CEOLoanRequestDetailsPage,
  CEOAssetDamageReportsPage,
  CEOAssetReturnRequestsPage,
  CEOEmployeeDeletionInboxPage,
  CEOEmployeeDeletionDetailPage,
  CEOJobOffersInboxPage,
  CEOJobOfferDetailPage,
  CFODashboardPage,
  CFOLoanRequestsPage,
  CFOLoanRequestDetailsPage,
  AttendancePreviewPage,
  PendingInboxPage,
  NotificationsPage,
  ContractDecisionsPage,
  ContractRatingsPage,
  ManagerRatingFormPage,
  EmployeeRatingFormPage,
  RegisterInvitePage,
  JobOfferResponsePage,
  Unauthorized403Page,
} from "./lazyPages";

// Public, unauthenticated flows accessed only via an emailed/WhatsApp'd
// link. They are lazy-loaded (see ./lazyPages) but sit outside BaseLayout's
// Suspense boundary, so each gets its own inline fallback here.
const LazyRegisterInvitePage = (
  <Suspense fallback={<LoadingState />}>
    <RegisterInvitePage />
  </Suspense>
);
const LazyJobOfferResponsePage = (
  <Suspense fallback={<LoadingState />}>
    <JobOfferResponsePage />
  </Suspense>
);
// Unauthorized403Page is nested directly under RequireAuth's <Outlet/>
// (not under BaseLayout), which also carries its own Suspense boundary.
const LazyUnauthorized403Page = (
  <Suspense fallback={<LoadingState />}>
    <Unauthorized403Page />
  </Suspense>
);

import RouteErrorBoundary from "./RouteErrorBoundary";

import BaseLayout from "../layouts/BaseLayout";

function LegacyEmployeeRedirect() {
  const { id } = useParams();
  return <Navigate to={`/hr/employees/${id}`} replace />;
}

export const routes = [
  // Public
  {
    path: "/login",
    element: <LoginPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/register",
    element: LazyRegisterInvitePage,
    errorElement: <RouteErrorBoundary />,
  },
  // Public: landing page for the one-time link an admin-triggered password
  // reset emails out. No auth — the token in the URL is the credential.
  {
    path: "/reset-password",
    element: <ResetPasswordPage />,
    errorElement: <RouteErrorBoundary />,
  },
  // Candidate-facing offer response. No auth, no app chrome: the recipient has
  // only the tokenized link from their WhatsApp/email message.
  {
    path: "/job-offers/respond",
    element: LazyJobOfferResponsePage,
    errorElement: <RouteErrorBoundary />,
  },

  // Authenticated (all roles)
  {
    path: "/change-password",
    element: <RequireAuth />,
    children: [{ index: true, element: <ChangePasswordPage /> }],
  },
  {
    path: "/unauthorized",
    element: <RequireAuth />,
    children: [{ index: true, element: LazyUnauthorized403Page }],
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
          { index: true, element: <HomeRedirect /> },
          // System Admin (SystemAdmin)
          {
            element: <RequireRole roles={["SystemAdmin"]} />,
            children: [
              {
                path: "admin",
                element: <Navigate to="/admin/dashboard" replace />,
              },
              { path: "admin/dashboard", element: <AdminDashboardPage /> },
              { path: "admin/users", element: <AdminUsersListPage /> },
              { path: "admin/users/create", element: <AdminUserCreatePage /> },
              { path: "admin/invites", element: <AdminInvitesPage /> },
              { path: "admin/audit-logs", element: <AdminAuditLogsPage /> },
              { path: "admin/settings", element: <AdminSettingsPage /> },
              {
                path: "admin/work-locations",
                element: <AdminWorkLocationsPage />,
              },
              { path: "admin/biotime", element: <BioTimeSettingsPage /> },
              {
                path: "admin/whatsapp",
                element: <AdminWhatsAppIntegrationPage />,
              },
              {
                path: "admin/workflow/delegations",
                element: <DelegationRulesPage />,
              },
              { path: "admin/profile", element: <UserProfilePage /> },
            ],
          },

          // HR Manager routes
          {
            element: <RequireRole roles={["HRManager", "SystemAdmin"]} />,
            children: [
              { path: "hr", element: <Navigate to="/hr/employees" replace /> },
              { path: "hr/dashboard", element: <HRDashboardPage /> },
              { path: "hr/activity", element: <RecentActivityPage /> },
              { path: "hr/profile", element: <UserProfilePage /> },
              {
                path: "hr/attendance",
                element: <AttendancePreviewPage role="hr" />,
              },
              {
                path: "hr/attendance-policy",
                element: <AttendancePolicyPage />,
              },
              { path: "hr/invites", element: <AdminInvitesPage /> },

              // Employee Management
              { path: "hr/employees", element: <EmployeesListPage /> },
              { path: "hr/employees/create", element: <CreateEmployeePage /> },
              { path: "hr/employees/:id", element: <ViewEmployeePage /> },
              { path: "employees/:id", element: <LegacyEmployeeRedirect /> },
              { path: "hr/employees/:id/edit", element: <EditEmployeePage /> },
              {
                path: "hr/employees/expiries",
                element: <ExpiringDocumentsPage />,
              },

              // Reference Data
              { path: "hr/departments", element: <DepartmentsPage /> },
              { path: "hr/positions", element: <PositionsPage /> },
              { path: "hr/task-groups", element: <TaskGroupsPage /> },
              { path: "hr/sponsors", element: <SponsorsPage /> },
              { path: "hr/rent-types", element: <RentTypesPage /> },
              { path: "hr/rents", element: <HRRentsPage /> },
              { path: "hr/templates", element: <TemplateLibraryPage /> },

              // Job Offers
              { path: "hr/job-offers", element: <JobOffersListPage /> },
              { path: "hr/job-offers/new", element: <JobOfferFormPage /> },
              { path: "hr/job-offers/:id", element: <JobOfferDetailPage /> },
              { path: "hr/job-offers/:id/edit", element: <JobOfferFormPage /> },

              // Starting work acknowledgements: HR-only BioTime verification.
              // There is deliberately no employee-facing counterpart.
              {
                path: "hr/starting-work-acknowledgments",
                element: <StartingWorkAcknowledgmentsListPage />,
              },
              {
                path: "hr/starting-work-acknowledgments/:id",
                element: <StartingWorkAcknowledgmentDetailPage />,
              },

              // Import Employees
              {
                path: "hr/import/employees",
                element: <ImportEmployeesEntryPage />,
              },
              {
                path: "hr/import/employees/:import_id/result",
                element: <ImportResultPage />,
              },
              {
                path: "hr/import/employees/history",
                element: <ImportHistoryPage />,
              },

              // Payroll
              { path: "hr/payroll", element: <PayrollDashboardPage /> },
              { path: "hr/payroll/create", element: <CreatePayrollRunPage /> },
              {
                path: "hr/payroll/:run_id",
                element: <PayrollRunDetailsPage />,
              },
              { path: "hr/assets", element: <HRAssetsPage /> },
              { path: "hr/assets/lookup", element: <AssetLookupPage /> },
              {
                path: "hr/assets/label-jobs",
                element: <LabelJobsHistoryPage />,
              },

              // Leave Management (HR)
              { path: "hr/leave/requests", element: <LeaveInboxPage /> },
              {
                path: "hr/leave/requests/:id",
                element: <LeaveRequestDetailsPage />,
              },
              {
                path: "hr/permission-requests",
                element: <HrPermissionRequestsPage />,
              },
              {
                path: "hr/permission-requests/:id",
                element: <PermissionRequestDetailPage role="hr" />,
              },
              // Annual Leave settlement queue; ":id" is the deep link carried by
              // the HR year-end notification.
              {
                path: "hr/annual-leave-payments",
                element: <AnnualLeaveSettlementsPage />,
              },
              {
                path: "hr/annual-leave-payments/:id",
                element: <AnnualLeaveSettlementsPage />,
              },
              { path: "hr/loan-requests", element: <LoanInboxPage /> },
              {
                path: "hr/loan-requests/:id",
                element: <HrLoanRequestDetailsPage />,
              },
              {
                path: "hr/contract-decisions",
                element: <ContractDecisionsPage />,
              },
              {
                path: "hr/contract-decisions/:id",
                element: <ContractDecisionsPage />,
              },
              {
                path: "hr/contract-ratings",
                element: <ContractRatingsPage />,
              },
              {
                path: "hr/contract-ratings/:id",
                element: <ContractRatingsPage />,
              },
              {
                path: "hr/workflow/delegations",
                element: <DelegationRulesPage />,
              },

              // Announcements (HR)
              {
                path: "hr/announcements",
                element: <AnnouncementsManagementPage />,
              },
              {
                path: "hr/announcements/create",
                element: <CreateAnnouncementPage />,
              },
              {
                path: "hr/announcements/:id/edit",
                element: <EditAnnouncementPage />,
              },

              // Existing pages
              {
                path: "hr/attendance",
                element: <AttendancePreviewPage role="hr" />,
              },
              {
                path: "hr/attendance-correction-requests",
                element: <Navigate to="/hr/attendance" replace />,
              },
              { path: "hr/leave-balances", element: <HrLeaveBalancesPage /> },
            ],
          },

          // Employee (placeholders)
          {
            element: (
              <RequireRole
                roles={[
                  "Employee",
                  "SystemAdmin",
                  "HRManager",
                  "Manager",
                  "CEO",
                  "CFO",
                ]}
              />
            ),
            children: [
              {
                // Blocks the whole employee self-service surface behind an
                // outstanding self-rating (see RequireCompletedSelfRating's
                // own docstring for why the scope stops at /employee/*).
                element: <RequireCompletedSelfRating />,
                children: [
                  {
                    path: "employee",
                    element: <Navigate to="/employee/dashboard" replace />,
                  },
                  {
                    path: "employee/home",
                    element: <Navigate to="/employee/dashboard" replace />,
                  },
                  { path: "employee/dashboard", element: <DashboardPage /> },
                  {
                    path: "employee/permission-requests/new",
                    element: <PermissionRequestFormPage />,
                  },
                  {
                    path: "employee/contract-ratings/:id",
                    element: <EmployeeRatingFormPage />,
                  },
                  {
                    path: "employee/permission-requests",
                    element: <MyPermissionRequestsPage />,
                  },
                  {
                    path: "employee/permission-requests/:id",
                    element: <PermissionRequestDetailPage role="employee" />,
                  },
                  { path: "employee/profile", element: <MyProfilePage /> },
                  {
                    path: "employee/attendance",
                    element: <EmployeeAttendancePage />,
                  },
                  {
                    path: "employee/attendance-corrections",
                    element: <Navigate to="/employee/attendance" replace />,
                  },
                  { path: "employee/leaves", element: <EmployeeLeavesPage /> },
                  {
                    path: "employee/payslips",
                    element: <EmployeePayslipsListPage />,
                  },
                  {
                    path: "employee/payslips/:id",
                    element: <EmployeePayslipDetailsPage />,
                  },

                  // Employee Leave
                  {
                    path: "employee/leave/request",
                    element: <RequestLeavePage />,
                  },
                  {
                    path: "employee/leave/requests",
                    element: <MyLeaveRequestsPage />,
                  },
                  {
                    path: "employee/leave/requests/:id",
                    element: <EmployeeLeaveRequestDetailsPage />,
                  },
                  {
                    path: "employee/delegated-approvals",
                    element: <DelegatedLeaveInboxPage />,
                  },
                  {
                    path: "employee/delegated-approvals/:id",
                    element: <EmployeeLeaveRequestDetailsPage />,
                  },
                  {
                    path: "employee/leave/balance",
                    element: <MyLeaveBalancePage />,
                  },
                  {
                    path: "employee/loans/request",
                    element: <RequestLoanPage />,
                  },
                  { path: "employee/loans", element: <MyLoanRequestsPage /> },
                  {
                    path: "employee/loans/:id",
                    element: <EmployeeLoanRequestDetailsPage />,
                  },
                  { path: "employee/assets", element: <MyAssetsPage /> },

                  // Announcements
                  {
                    path: "employee/announcements",
                    element: <AnnouncementsPage />,
                  },
                ],
              },
            ],
          },

          // Manager Routes — capability driven: any user the backend reports
          // manager access for (assigned direct reports) reaches these pages.
          {
            element: (
              <RequireManagerAccess
                allowRoles={["CEO", "CFO", "SystemAdmin"]}
              />
            ),
            children: [
              {
                // A manager is still an employee. Their own self-rating must
                // be completed before their manager privileges, followed by
                // any pending direct-report evaluation.
                element: <RequireCompletedSelfRating />,
                children: [
                  {
                    element: <RequireCompletedManagerRating />,
                    children: [
                      {
                        path: "manager",
                        element: <Navigate to="/manager/dashboard" replace />,
                      },
                      {
                        path: "manager/dashboard",
                        element: <ManagerDashboardPage />,
                      },
                      {
                        path: "manager/team-requests",
                        element: <ManagerTeamRequestsPage />,
                      },
                      {
                        path: "manager/permission-requests",
                        element: <ManagerPermissionRequestsPage />,
                      },
                      {
                        path: "manager/permission-requests/:id",
                        element: <PermissionRequestDetailPage role="manager" />,
                      },
                      {
                        path: "manager/attendance",
                        element: <ManagerAttendancePage />,
                      },
                      {
                        path: "manager/attendance-corrections",
                        element: <Navigate to="/manager/attendance" replace />,
                      },
                      { path: "manager/team", element: <ManagerTeamPage /> },
                      {
                        path: "manager/team/:id",
                        element: <ManagerEmployeeProfilePage />,
                      },
                      {
                        path: "manager/contract-ratings/:id",
                        element: <ManagerRatingFormPage />,
                      },
                      {
                        path: "manager/leave/requests/:id",
                        element: <ManagerLeaveRequestDetailsPage />,
                      },
                      {
                        path: "manager/loan-requests",
                        element: <ManagerLoanRequestsPage />,
                      },
                      {
                        path: "manager/loan-requests/:id",
                        element: <ManagerLoanRequestDetailsPage />,
                      },
                      {
                        path: "manager/announcements",
                        element: <AnnouncementsPage />,
                      },
                      {
                        path: "manager/announcements/create",
                        element: <CreateTeamAnnouncementPage />,
                      },
                    ],
                  },
                ],
              },
            ],
          },

          // Admin Announcements
          {
            element: <RequireRole roles={["SystemAdmin"]} />,
            children: [
              { path: "admin/announcements", element: <AnnouncementsPage /> },
            ],
          },

          // CEO Routes
          {
            element: <RequireRole roles={["CEO", "SystemAdmin"]} />,
            children: [
              {
                path: "ceo",
                element: <Navigate to="/ceo/dashboard" replace />,
              },
              { path: "ceo/dashboard", element: <CEODashboardPage /> },
              { path: "ceo/leave/requests", element: <CEOLeaveInboxPage /> },
              {
                path: "ceo/leave/requests/:id",
                element: <Navigate to="/ceo/leave/requests" replace />,
              },
              // The queue itself is scoped to pending_ceo; ":id" only exists so
              // the notification deep link resolves to the queue.
              {
                path: "ceo/annual-leave-payments",
                element: <CEOAnnualLeaveSettlementsPage />,
              },
              {
                path: "ceo/annual-leave-payments/:id",
                element: <CEOAnnualLeaveSettlementsPage />,
              },
              {
                path: "ceo/team-requests",
                element: <ManagerTeamRequestsPage />,
              },
              { path: "ceo/team", element: <CEOTeamPage /> },
              { path: "ceo/announcements", element: <AnnouncementsPage /> },
              {
                path: "ceo/announcements/create",
                element: <CreateTeamAnnouncementPage />,
              },
              { path: "ceo/profile", element: <UserProfilePage /> },
            ],
          },

          // CEO Loan Approver Routes (role OR profile-based approver)
          {
            element: <RequireCEOApprover />,
            children: [
              { path: "ceo/loan-requests", element: <CEOLoanRequestsPage /> },
              {
                path: "ceo/loan-requests/:id",
                element: <CEOLoanRequestDetailsPage />,
              },
              {
                path: "ceo/attendance",
                element: <AttendancePreviewPage role="ceo" />,
              },
              {
                path: "ceo/assets/damage-reports",
                element: <CEOAssetDamageReportsPage />,
              },
              {
                path: "ceo/assets/return-requests",
                element: <CEOAssetReturnRequestsPage />,
              },
              {
                path: "ceo/employees/deletion-requests",
                element: <CEOEmployeeDeletionInboxPage />,
              },
              {
                path: "ceo/employees/deletion-requests/:id",
                element: <CEOEmployeeDeletionDetailPage />,
              },
              {
                path: "ceo/contract-decisions",
                element: <ContractDecisionsPage />,
              },
              {
                path: "ceo/contract-decisions/:id",
                element: <ContractDecisionsPage />,
              },
              {
                path: "ceo/contract-ratings",
                element: <ContractRatingsPage />,
              },
              {
                path: "ceo/contract-ratings/:id",
                element: <ContractRatingsPage />,
              },
              // Job Offers — the CEO approval gate before a candidate is told
              {
                path: "ceo/job-offers",
                element: <CEOJobOffersInboxPage />,
              },
              {
                path: "ceo/job-offers/:id",
                element: <CEOJobOfferDetailPage />,
              },
            ],
          },

          // CFO Routes (role OR profile-based approver)
          {
            element: <RequireCFOApprover />,
            children: [
              {
                path: "cfo",
                element: <Navigate to="/cfo/dashboard" replace />,
              },
              { path: "cfo/dashboard", element: <CFODashboardPage /> },
              { path: "cfo/loan-requests", element: <CFOLoanRequestsPage /> },
              {
                path: "cfo/loan-requests/:id",
                element: <CFOLoanRequestDetailsPage />,
              },
              { path: "cfo/profile", element: <UserProfilePage /> },
            ],
          },

          // Finance Approver Routes (accountant profile based)
          {
            element: <RequireFinanceApprover />,
            children: [
              { path: "finance/loan-requests", element: <LoanInboxPage /> },
              {
                path: "finance/loan-requests/:id",
                element: <HrLoanRequestDetailsPage />,
              },
            ],
          },

          // Unified pending inbox + notification inbox (all authenticated roles)
          {
            element: (
              <RequireRole
                roles={[
                  "SystemAdmin",
                  "HRManager",
                  "Manager",
                  "CEO",
                  "CFO",
                  "Employee",
                ]}
              />
            ),
            children: [
              { path: "pending-inbox", element: <PendingInboxPage /> },
              { path: "notifications", element: <NotificationsPage /> },
              // Personal profile: reachable even without manager capability.
              { path: "manager/profile", element: <UserProfilePage /> },
            ],
          },
        ],
      },
    ],
  },

  // 404
  { path: "*", element: <NotFound404Page /> },
];
