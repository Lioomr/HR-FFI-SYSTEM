import LoanRequestsTablePage from "../../components/loan/LoanRequestsTablePage";
import { getManagerLoanRequests } from "../../services/api/loanApi";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerLoanRequestsPage() {
  const { t } = useI18n();
  return (
    <LoanRequestsTablePage
      title={t("loans.inbox.managerRequestsTitle")}
      subtitle={t("loans.inbox.managerRequestsSubtitle")}
      detailsBasePath="/manager/loan-requests"
      fetcher={getManagerLoanRequests}
    />
  );
}
