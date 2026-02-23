import LoanRequestDetailsPage from "../../../components/loan/LoanRequestDetailsPage";
import {
  approveFinanceLoanRequest,
  getFinanceLoanRequest,
  rejectFinanceLoanRequest,
} from "../../../services/api/loanApi";
import { useI18n } from "../../../i18n/useI18n";

export default function HrLoanRequestDetailsPage() {
  const { t } = useI18n();
  const backPath = window.location.pathname.startsWith("/finance/") ? "/finance/loan-requests" : "/hr/loan-requests";

  return (
    <LoanRequestDetailsPage
      title={t("loans.inbox.financeReviewTitle")}
      backPath={backPath}
      fetchOne={getFinanceLoanRequest}
      approve={approveFinanceLoanRequest}
      reject={rejectFinanceLoanRequest}
      canActWhenStatus="pending_finance"
    />
  );
}
