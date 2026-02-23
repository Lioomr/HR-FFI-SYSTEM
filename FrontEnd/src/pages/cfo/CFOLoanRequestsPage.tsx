import LoanRequestsTablePage from "../../components/loan/LoanRequestsTablePage";
import { getCFOLoanRequests } from "../../services/api/loanApi";
import { useI18n } from "../../i18n/useI18n";

export default function CFOLoanRequestsPage() {
  const { t } = useI18n();
  return (
    <LoanRequestsTablePage
      title={t("loans.inbox.cfoRequestsTitle")}
      subtitle={t("loans.inbox.cfoRequestsSubtitle")}
      detailsBasePath="/cfo/loan-requests"
      defaultStatus="pending_cfo"
      fetcher={getCFOLoanRequests}
    />
  );
}

