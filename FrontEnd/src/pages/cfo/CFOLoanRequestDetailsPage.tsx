import LoanRequestDetailsPage from "../../components/loan/LoanRequestDetailsPage";
import { approveCFOLoanRequest, getCFOLoanRequest, rejectCFOLoanRequest } from "../../services/api/loanApi";
import { useI18n } from "../../i18n/useI18n";

export default function CFOLoanRequestDetailsPage() {
  const { t } = useI18n();
  return (
    <LoanRequestDetailsPage
      title={t("loans.inbox.cfoDecisionTitle")}
      backPath="/cfo/loan-requests"
      fetchOne={getCFOLoanRequest}
      approve={approveCFOLoanRequest}
      reject={rejectCFOLoanRequest}
      canActWhenStatus="pending_cfo"
    />
  );
}

