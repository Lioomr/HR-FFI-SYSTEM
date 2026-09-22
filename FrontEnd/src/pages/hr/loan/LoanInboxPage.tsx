import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import { DollarOutlined, UnorderedListOutlined } from "@ant-design/icons";

import LoanRequestsTablePage from "../../../components/loan/LoanRequestsTablePage";
import {
  getDisbursementLoanRequests,
  getHRLoanRequests,
} from "../../../services/api/loanApi";
import { useI18n } from "../../../i18n/useI18n";

export default function LoanInboxPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isFinancePath = window.location.pathname.startsWith("/finance/");
  return (
    <LoanRequestsTablePage
      title={
        isFinancePath
          ? t("loans.inbox.disbursementTitle")
          : t("loans.inbox.financeApproveTitle")
      }
      subtitle={
        isFinancePath
          ? t("loans.inbox.disbursementSubtitle")
          : t("loans.inbox.financeApproveSubtitle")
      }
      detailsBasePath={
        isFinancePath ? "/finance/loan-requests" : "/hr/loan-requests"
      }
      employeeProfilePath={
        isFinancePath
          ? undefined
          : (employeeProfileId) => `/hr/employees/${employeeProfileId}`
      }
      defaultStatus={isFinancePath ? "pending_disbursement" : "pending_hr"}
      fetcher={isFinancePath ? getDisbursementLoanRequests : getHRLoanRequests}
      headerActions={
        isFinancePath ? undefined : (
          <>
            <Button
              icon={<UnorderedListOutlined />}
              onClick={() => navigate("/employee/loans")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("layout.myLoans")}
            </Button>
            <Button
              type="primary"
              icon={<DollarOutlined />}
              onClick={() => navigate("/employee/loans/request")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("loans.request.title")}
            </Button>
          </>
        )
      }
    />
  );
}
