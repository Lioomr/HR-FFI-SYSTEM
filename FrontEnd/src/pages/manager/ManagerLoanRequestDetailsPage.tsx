import LoanRequestDetailsPage from "../../components/loan/LoanRequestDetailsPage";
import {
  approveManagerLoanRequest,
  getManagerLoanRequest,
  rejectManagerLoanRequest,
} from "../../services/api/loanApi";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerLoanRequestDetailsPage() {
  const { t } = useI18n();
  return (
    <LoanRequestDetailsPage
      title={t("loans.inbox.managerReviewTitle")}
      backPath="/manager/team-requests?tab=loans"
      fetchOne={getManagerLoanRequest}
      approve={approveManagerLoanRequest}
      reject={rejectManagerLoanRequest}
      canActWhenStatus="pending_manager"
      // The manager loan endpoint only returns the manager's own team, the
      // same rows the manager list links to /manager/team/:id.
      employeeProfilePath={(employeeProfileId) =>
        `/manager/team/${employeeProfileId}`
      }
      approveLabel={t("loans.inbox.btnRecommendApprove")}
      rejectLabel={t("loans.inbox.btnRecommendReject")}
      approveSuccessMessage={t("loans.inbox.managerRecommendedApprove")}
      rejectSuccessMessage={t("loans.inbox.managerRecommendedReject")}
    />
  );
}
