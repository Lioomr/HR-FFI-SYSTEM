// Central registry of route-level page components loaded via React.lazy().
//
// Splitting these into their own chunks means a user who only ever touches
// (say) the payroll pages no longer has to download the CEO/CFO/admin/HR
// screens too. Keep this file as the single place that decides which pages
// are code-split so route tests that assert route->component identity can
// import the same lazy-wrapped reference instead of the raw page module.
//
// Do NOT add `src/i18n/translations.ts` related work here — unrelated to
// this file and explicitly off-limits.
import { lazy } from "react";

// ─── Admin ──────────────────────────────────────────────────────────────────
export const AdminDashboardPage = lazy(
  () => import("../pages/admin/AdminDashboardPage"),
);
export const AdminUsersListPage = lazy(
  () => import("../pages/admin/AdminUsersListPage"),
);
export const AdminUserCreatePage = lazy(
  () => import("../pages/admin/AdminUserCreatePage"),
);
export const AdminInvitesPage = lazy(
  () => import("../pages/admin/AdminInvitesPage"),
);
export const AdminAuditLogsPage = lazy(
  () => import("../pages/admin/AdminAuditLogsPage"),
);
export const AdminWhatsAppIntegrationPage = lazy(
  () => import("../pages/admin/AdminWhatsAppIntegrationPage"),
);
export const AdminSettingsPage = lazy(
  () => import("../pages/admin/AdminSettingsPage"),
);
export const AdminWorkLocationsPage = lazy(
  () => import("../pages/admin/AdminWorkLocationsPage"),
);
export const BioTimeSettingsPage = lazy(
  () => import("../pages/admin/BioTimeSettingsPage"),
);
export const DelegationRulesPage = lazy(
  () => import("../pages/hr/DelegationRulesPage"),
);

// ─── Shared profile ─────────────────────────────────────────────────────────
export const UserProfilePage = lazy(
  () => import("../pages/shared/UserProfilePage"),
);
export const MyProfilePage = lazy(
  () => import("../pages/employee/MyProfilePage"),
);

// ─── HR: reference data ─────────────────────────────────────────────────────
export const DepartmentsPage = lazy(
  () => import("../pages/hr/reference/DepartmentsPage"),
);
export const PositionsPage = lazy(
  () => import("../pages/hr/reference/PositionsPage"),
);
export const TaskGroupsPage = lazy(
  () => import("../pages/hr/reference/TaskGroupsPage"),
);
export const SponsorsPage = lazy(
  () => import("../pages/hr/reference/SponsorsPage"),
);
export const RentTypesPage = lazy(
  () => import("../pages/hr/reference/RentTypesPage"),
);

// ─── HR: employees ──────────────────────────────────────────────────────────
export const EmployeesListPage = lazy(
  () => import("../pages/hr/employees/EmployeesListPage"),
);
export const CreateEmployeePage = lazy(
  () => import("../pages/hr/employees/CreateEmployeePage"),
);
export const ViewEmployeePage = lazy(
  () => import("../pages/hr/employees/ViewEmployeePage"),
);
export const EditEmployeePage = lazy(
  () => import("../pages/hr/employees/EditEmployeePage"),
);
export const ExpiringDocumentsPage = lazy(
  () => import("../pages/hr/employees/ExpiringDocumentsPage"),
);

// ─── HR: dashboard / import ─────────────────────────────────────────────────
export const HRDashboardPage = lazy(
  () => import("../pages/hr/dashboard/HRDashboardPage"),
);
export const RecentActivityPage = lazy(
  () => import("../pages/hr/dashboard/RecentActivityPage"),
);
export const ImportEmployeesEntryPage = lazy(
  () => import("../pages/hr/import/ImportEmployeesEntryPage"),
);
export const ImportResultPage = lazy(
  () => import("../pages/hr/import/ImportResultPage"),
);
export const ImportHistoryPage = lazy(
  () => import("../pages/hr/import/ImportHistoryPage"),
);

// ─── HR: payroll ────────────────────────────────────────────────────────────
export const PayrollDashboardPage = lazy(
  () => import("../pages/hr/payroll/PayrollDashboardPage"),
);
export const CreatePayrollRunPage = lazy(
  () => import("../pages/hr/payroll/CreatePayrollRunPage"),
);
export const PayrollRunDetailsPage = lazy(
  () => import("../pages/hr/payroll/PayrollRunDetailsPage"),
);

// ─── HR: assets / rents / templates ─────────────────────────────────────────
export const HRAssetsPage = lazy(() => import("../pages/hr/assets/HRAssetsPage"));
export const AssetLookupPage = lazy(
  () => import("../pages/hr/assets/AssetLookupPage"),
);
export const LabelJobsHistoryPage = lazy(
  () => import("../pages/hr/assets/LabelJobsHistoryPage"),
);
export const HRRentsPage = lazy(() => import("../pages/hr/rents/HRRentsPage"));
export const TemplateLibraryPage = lazy(
  () => import("../pages/hr/templates/TemplateLibraryPage"),
);

// ─── HR: job offers ─────────────────────────────────────────────────────────
export const JobOffersListPage = lazy(
  () => import("../pages/hr/job-offers/JobOffersListPage"),
);
export const JobOfferFormPage = lazy(
  () => import("../pages/hr/job-offers/JobOfferFormPage"),
);
export const JobOfferDetailPage = lazy(
  () => import("../pages/hr/job-offers/JobOfferDetailPage"),
);

// ─── HR: starting work acknowledgments ──────────────────────────────────────
export const StartingWorkAcknowledgmentsListPage = lazy(
  () =>
    import(
      "../pages/hr/starting-work-acknowledgments/StartingWorkAcknowledgmentsListPage"
    ),
);
export const StartingWorkAcknowledgmentDetailPage = lazy(
  () =>
    import(
      "../pages/hr/starting-work-acknowledgments/StartingWorkAcknowledgmentDetailPage"
    ),
);

// ─── Employee: payslips ─────────────────────────────────────────────────────
export const EmployeePayslipsListPage = lazy(
  () => import("../pages/employee/payslips/EmployeePayslipsListPage"),
);
export const EmployeePayslipDetailsPage = lazy(
  () => import("../pages/employee/payslips/EmployeePayslipDetailsPage"),
);

// ─── Employee: leave / loan / assets / attendance ───────────────────────────
export const EmployeeLeavesPage = lazy(
  () => import("../pages/employee/EmployeeLeavesPage"),
);
export const RequestLeavePage = lazy(
  () => import("../pages/employee/leave/RequestLeavePage"),
);
export const MyLeaveRequestsPage = lazy(
  () => import("../pages/employee/leave/MyLeaveRequestsPage"),
);
export const MyLeaveBalancePage = lazy(
  () => import("../pages/employee/leave/MyLeaveBalancePage"),
);
export const EmployeeLeaveRequestDetailsPage = lazy(
  () => import("../pages/employee/leave/EmployeeLeaveRequestDetailsPage"),
);
export const DelegatedLeaveInboxPage = lazy(
  () => import("../pages/employee/leave/DelegatedLeaveInboxPage"),
);
export const RequestLoanPage = lazy(
  () => import("../pages/employee/loan/RequestLoanPage"),
);
export const MyLoanRequestsPage = lazy(
  () => import("../pages/employee/loan/MyLoanRequestsPage"),
);
export const EmployeeLoanRequestDetailsPage = lazy(
  () => import("../pages/employee/loan/LoanRequestDetailsPage"),
);
export const MyAssetsPage = lazy(
  () => import("../pages/employee/assets/MyAssetsPage"),
);
export const EmployeeAttendancePage = lazy(
  () => import("../pages/employee/AttendancePage"),
);
export const DashboardPage = lazy(
  () => import("../pages/employee/DashboardPage"),
);

// ─── HR: leave / loan inboxes ───────────────────────────────────────────────
export const LeaveInboxPage = lazy(
  () => import("../pages/hr/leave/LeaveInboxPage"),
);
export const AnnualLeaveSettlementsPage = lazy(
  () => import("../pages/hr/leave/AnnualLeaveSettlementsPage"),
);
export const LeaveRequestDetailsPage = lazy(
  () => import("../pages/hr/leave/LeaveRequestDetailsPage"),
);
export const LoanInboxPage = lazy(() => import("../pages/hr/loan/LoanInboxPage"));
export const HrLoanRequestDetailsPage = lazy(
  () => import("../pages/hr/loan/LoanRequestDetailsPage"),
);
export const HrLeaveBalancesPage = lazy(
  () => import("../pages/hr/HrLeaveBalancesPage"),
);
export const AttendancePolicyPage = lazy(
  () => import("../pages/hr/AttendancePolicyPage"),
);

// ─── Manager ────────────────────────────────────────────────────────────────
export const ManagerDashboardPage = lazy(
  () => import("../pages/manager/ManagerDashboardPage"),
);
export const ManagerTeamRequestsPage = lazy(
  () => import("../pages/manager/ManagerTeamRequestsPage"),
);
export const ManagerLeaveRequestDetailsPage = lazy(
  () => import("../pages/manager/ManagerLeaveRequestDetailsPage"),
);
export const ManagerTeamPage = lazy(
  () => import("../pages/manager/ManagerTeamPage"),
);
export const CreateTeamAnnouncementPage = lazy(
  () => import("../pages/manager/CreateTeamAnnouncementPage"),
);
export const ManagerLoanRequestsPage = lazy(
  () => import("../pages/manager/ManagerLoanRequestsPage"),
);
export const ManagerLoanRequestDetailsPage = lazy(
  () => import("../pages/manager/ManagerLoanRequestDetailsPage"),
);
export const ManagerEmployeeProfilePage = lazy(
  () => import("../pages/manager/ManagerEmployeeProfilePage"),
);
export const ManagerAttendancePage = lazy(
  () => import("../pages/manager/ManagerAttendancePage"),
);

// ─── Permission requests (shared, multiple exports from one module) ────────
export const PermissionRequestDetailPage = lazy(() =>
  import("../pages/shared/permission/PermissionRequestPages").then((m) => ({
    default: m.PermissionRequestDetailPage,
  })),
);
export const PermissionRequestFormPage = lazy(() =>
  import("../pages/shared/permission/PermissionRequestPages").then((m) => ({
    default: m.PermissionRequestFormPage,
  })),
);
export const HrPermissionRequestsPage = lazy(() =>
  import("../pages/shared/permission/PermissionRequestPages").then((m) => ({
    default: m.HrPermissionRequestsPage,
  })),
);
export const ManagerPermissionRequestsPage = lazy(() =>
  import("../pages/shared/permission/PermissionRequestPages").then((m) => ({
    default: m.ManagerPermissionRequestsPage,
  })),
);
export const MyPermissionRequestsPage = lazy(() =>
  import("../pages/shared/permission/PermissionRequestPages").then((m) => ({
    default: m.MyPermissionRequestsPage,
  })),
);

// ─── Announcements ──────────────────────────────────────────────────────────
export const AnnouncementsManagementPage = lazy(
  () => import("../pages/hr/announcements/AnnouncementsManagementPage"),
);
export const CreateAnnouncementPage = lazy(
  () => import("../pages/hr/announcements/CreateAnnouncementPage"),
);
export const EditAnnouncementPage = lazy(
  () => import("../pages/hr/announcements/EditAnnouncementPage"),
);
export const AnnouncementsPage = lazy(
  () => import("../pages/announcements/AnnouncementsPage"),
);

// ─── CEO ────────────────────────────────────────────────────────────────────
export const CEODashboardPage = lazy(
  () => import("../pages/ceo/CEODashboardPage"),
);
export const CEOLeaveInboxPage = lazy(
  () => import("../pages/ceo/CEOLeaveInboxPage"),
);
export const CEOAnnualLeaveSettlementsPage = lazy(
  () => import("../pages/ceo/CEOAnnualLeaveSettlementsPage"),
);
export const CEOTeamPage = lazy(() => import("../pages/ceo/CEOTeamPage"));
export const CEOLoanRequestsPage = lazy(
  () => import("../pages/ceo/CEOLoanRequestsPage"),
);
export const CEOLoanRequestDetailsPage = lazy(
  () => import("../pages/ceo/CEOLoanRequestDetailsPage"),
);
export const CEOAssetDamageReportsPage = lazy(
  () => import("../pages/ceo/CEOAssetDamageReportsPage"),
);
export const CEOAssetReturnRequestsPage = lazy(
  () => import("../pages/ceo/CEOAssetReturnRequestsPage"),
);
export const CEOEmployeeDeletionInboxPage = lazy(
  () => import("../pages/ceo/CEOEmployeeDeletionInboxPage"),
);
export const CEOEmployeeDeletionDetailPage = lazy(
  () => import("../pages/ceo/CEOEmployeeDeletionDetailPage"),
);
export const CEOJobOffersInboxPage = lazy(
  () => import("../pages/ceo/CEOJobOffersInboxPage"),
);
export const CEOJobOfferDetailPage = lazy(
  () => import("../pages/ceo/CEOJobOfferDetailPage"),
);

// ─── CFO ────────────────────────────────────────────────────────────────────
export const CFODashboardPage = lazy(
  () => import("../pages/cfo/CFODashboardPage"),
);
export const CFOLoanRequestsPage = lazy(
  () => import("../pages/cfo/CFOLoanRequestsPage"),
);
export const CFOLoanRequestDetailsPage = lazy(
  () => import("../pages/cfo/CFOLoanRequestDetailsPage"),
);

// ─── Shared: attendance preview / pending inbox / notifications ────────────
export const AttendancePreviewPage = lazy(
  () => import("../pages/shared/AttendancePreviewPage"),
);
export const PendingInboxPage = lazy(
  () => import("../pages/shared/PendingInboxPage"),
);
export const NotificationsPage = lazy(
  () => import("../pages/shared/NotificationsPage"),
);
export const ContractDecisionsPage = lazy(
  () => import("../pages/shared/ContractDecisionsPage"),
);

// ─── Public / rarely-visited entry points ──────────────────────────────────
export const RegisterInvitePage = lazy(
  () => import("../pages/RegisterInvitePage"),
);
export const JobOfferResponsePage = lazy(
  () => import("../pages/public/JobOfferResponsePage"),
);
export const Unauthorized403Page = lazy(
  () => import("../pages/Unauthorized403Page"),
);
