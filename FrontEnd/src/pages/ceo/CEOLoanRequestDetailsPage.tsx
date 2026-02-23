import LoanRequestDetailsPage from "../../components/loan/LoanRequestDetailsPage";
import { approveCEOLoanRequest, getCEOLoanRequest, rejectCEOLoanRequest } from "../../services/api/loanApi";
import { useI18n } from "../../i18n/useI18n";

export default function CEOLoanRequestDetailsPage() {
  const { t } = useI18n();
  return (
    <LoanRequestDetailsPage
      title={t("loans.inbox.ceoDecisionTitle")}
      backPath="/ceo/loan-requests"
      fetchOne={getCEOLoanRequest}
      approve={approveCEOLoanRequest}
      reject={rejectCEOLoanRequest}
      canActWhenStatus="pending_ceo"
    />
  );
}
