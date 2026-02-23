import LoanRequestsTablePage from "../../components/loan/LoanRequestsTablePage";
import { getCEOLoanRequests } from "../../services/api/loanApi";
import { useI18n } from "../../i18n/useI18n";

export default function CEOLoanRequestsPage() {
  const { t } = useI18n();
  return (
    <LoanRequestsTablePage
      title={t("loans.inbox.ceoRequestsTitle")}
      subtitle={t("loans.inbox.ceoRequestsSubtitle")}
      detailsBasePath="/ceo/loan-requests"
      defaultStatus="pending_ceo"
      fetcher={getCEOLoanRequests}
    />
  );
}
