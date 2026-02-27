import LoanRequestDetailsPage from "../../../components/loan/LoanRequestDetailsPage";
import {
  approveFinanceLoanRequest,
  getDisbursementLoanRequest,
  getFinanceLoanRequest,
  markLoanDisbursed,
  rejectFinanceLoanRequest,
} from "../../../services/api/loanApi";
import { useI18n } from "../../../i18n/useI18n";

export default function HrLoanRequestDetailsPage() {
  const { t } = useI18n();
  const isFinancePath = window.location.pathname.startsWith("/finance/");
  const backPath = isFinancePath ? "/finance/loan-requests" : "/hr/loan-requests";

  return (
    <LoanRequestDetailsPage
      title={isFinancePath ? t("loans.inbox.disbursementReviewTitle") : t("loans.inbox.financeReviewTitle")}
      backPath={backPath}
      fetchOne={isFinancePath ? getDisbursementLoanRequest : getFinanceLoanRequest}
      approve={isFinancePath ? markLoanDisbursed : approveFinanceLoanRequest}
      reject={isFinancePath ? undefined : rejectFinanceLoanRequest}
      canActWhenStatus={isFinancePath ? "pending_disbursement" : ["pending_hr", "pending_finance"]}
      approveLabel={isFinancePath ? t("loans.inbox.btnMarkDisbursed") : t("loans.inbox.btnRecommendApprove")}
      rejectLabel={t("loans.inbox.btnRecommendReject")}
      approveSuccessMessage={
        isFinancePath ? t("loans.inbox.disbursementSuccess") : t("loans.inbox.hrRecommendedApprove")
      }
      rejectSuccessMessage={t("loans.inbox.hrRecommendedReject")}
    />
  );
}
