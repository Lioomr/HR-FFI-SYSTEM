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
      backPath="/manager/loan-requests"
      fetchOne={getManagerLoanRequest}
      approve={approveManagerLoanRequest}
      reject={rejectManagerLoanRequest}
      canActWhenStatus="pending_manager"
    />
  );
}
