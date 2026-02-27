import LoanRequestsTablePage from "../../../components/loan/LoanRequestsTablePage";
import { getDisbursementLoanRequests, getHRLoanRequests } from "../../../services/api/loanApi";
import { useI18n } from "../../../i18n/useI18n";

export default function LoanInboxPage() {
  const { t } = useI18n();
  const isFinancePath = window.location.pathname.startsWith("/finance/");
  return (
    <LoanRequestsTablePage
      title={isFinancePath ? t("loans.inbox.disbursementTitle") : t("loans.inbox.financeApproveTitle")}
      subtitle={isFinancePath ? t("loans.inbox.disbursementSubtitle") : t("loans.inbox.financeApproveSubtitle")}
      detailsBasePath={isFinancePath ? "/finance/loan-requests" : "/hr/loan-requests"}
      defaultStatus={isFinancePath ? "pending_disbursement" : "pending_hr"}
      fetcher={isFinancePath ? getDisbursementLoanRequests : getHRLoanRequests}
    />
  );
}
