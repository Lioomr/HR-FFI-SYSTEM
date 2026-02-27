import LoanRequestDetailsPage from "../../components/loan/LoanRequestDetailsPage";
import {
  approveCFOLoanRequest,
  getCFOLoanRequest,
  referCFOLoanRequestToCEO,
  rejectCFOLoanRequest,
} from "../../services/api/loanApi";
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
      extraAction={{
        label: t("loans.inbox.btnReferToCEO"),
        successMessage: t("loans.inbox.referredToCEOSuccess"),
        failedMessage: t("loans.inbox.referFailed"),
        requireComment: true,
        handler: (id, comment) => referCFOLoanRequestToCEO(id, comment ?? ""),
      }}
    />
  );
}
