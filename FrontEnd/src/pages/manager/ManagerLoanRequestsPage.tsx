import LoanRequestsTablePage from "../../components/loan/LoanRequestsTablePage";
import { getManagerLoanRequests } from "../../services/api/loanApi";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerLoanRequestsPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useI18n();
  return (
    <LoanRequestsTablePage
      title={t("loans.inbox.managerRequestsTitle")}
      subtitle={t("loans.inbox.managerRequestsSubtitle")}
      detailsBasePath="/manager/loan-requests"
      employeeProfilePath={(employeeProfileId) =>
        `/manager/team/${employeeProfileId}`
      }
      embedded={embedded}
      fetcher={getManagerLoanRequests}
    />
  );
}
