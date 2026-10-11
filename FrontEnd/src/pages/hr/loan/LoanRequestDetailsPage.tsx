import LoanRequestDetailsPage from "../../../components/loan/LoanRequestDetailsPage";
import {
  approveFinanceLoanRequest,
  getDisbursementLoanRequest,
  getFinanceLoanRequest,
  markLoanDisbursed,
  rejectFinanceLoanRequest,
} from "../../../services/api/loanApi";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";

const HR_ADMIN_ROLES = ["HRManager", "SystemAdmin"];

export default function HrLoanRequestDetailsPage() {
  const { t } = useI18n();
  const role = useAuthStore((state) => state.user?.role);
  // Finance approvers also reach this page (/finance/...); only HR/admin get
  // the work-paper preview, seal retry and employee profile links.
  const isHrAdmin = HR_ADMIN_ROLES.includes(role ?? "");
  const isFinancePath = window.location.pathname.startsWith("/finance/");
  const backPath = isFinancePath
    ? "/finance/loan-requests"
    : "/hr/loan-requests";

  return (
    <LoanRequestDetailsPage
      title={
        isFinancePath
          ? t("loans.inbox.disbursementReviewTitle")
          : t("loans.inbox.financeReviewTitle")
      }
      backPath={backPath}
      fetchOne={
        isFinancePath ? getDisbursementLoanRequest : getFinanceLoanRequest
      }
      approve={isFinancePath ? markLoanDisbursed : approveFinanceLoanRequest}
      reject={isFinancePath ? undefined : rejectFinanceLoanRequest}
      canActWhenStatus={
        isFinancePath
          ? "pending_disbursement"
          : ["pending_hr", "pending_finance"]
      }
      // `IsLoanOwnerOrHR` admits HRManager and SystemAdmin, so among the shared
      // review surfaces only this one offers the PDF.
      showPdfDownload
      showPdfPreview={isHrAdmin}
      employeeProfilePath={
        isHrAdmin
          ? (employeeProfileId) => `/hr/employees/${employeeProfileId}`
          : undefined
      }
      integrity={
        isHrAdmin
          ? {
              canRetrySeal: true,
              profilePath: (profileId) => `/hr/employees/${profileId}`,
            }
          : undefined
      }
      approveLabel={
        isFinancePath
          ? t("loans.inbox.btnMarkDisbursed")
          : t("loans.inbox.btnRecommendApprove")
      }
      rejectLabel={t("loans.inbox.btnRecommendReject")}
      approveSuccessMessage={
        isFinancePath
          ? t("loans.inbox.disbursementSuccess")
          : t("loans.inbox.hrRecommendedApprove")
      }
      rejectSuccessMessage={t("loans.inbox.hrRecommendedReject")}
    />
  );
}
