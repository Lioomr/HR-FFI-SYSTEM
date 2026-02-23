import LoanRequestsTablePage from "../../../components/loan/LoanRequestsTablePage";
import { getFinanceLoanRequests } from "../../../services/api/loanApi";
import { useI18n } from "../../../i18n/useI18n";

export default function LoanInboxPage() {
  const { t } = useI18n();
  return (
    <LoanRequestsTablePage
      title={t("loans.inbox.financeApproveTitle")}
      subtitle={t("loans.inbox.financeApproveSubtitle")}
      detailsBasePath={window.location.pathname.startsWith("/finance/") ? "/finance/loan-requests" : "/hr/loan-requests"}
      defaultStatus="pending_finance"
      fetcher={getFinanceLoanRequests}
    />
  );
}
