import BackButton from "../../../components/ui/BackButton";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Col, Descriptions, Row, Tag, notification } from "antd";

import PageHeader from "../../../components/ui/PageHeader";
import { isApiError } from "../../../services/api/apiTypes";
import {
  getMyLoanRequest,
  type LoanRequest,
  type LoanStatus,
} from "../../../services/api/loanApi";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";
import LoanApprovalMap from "../../../components/loans/LoanApprovalMap";
import LoanPdfDownloadButton from "../../../components/loan/LoanPdfDownloadButton";
import DocumentIntegrityPanel from "../../../components/documents/DocumentIntegrityPanel";
import { isDocumentFinal } from "../../../components/documents/documentTypes";
import PendingActionBanner from "../../../components/requests/PendingActionBanner";
import RequestCancellationPanel from "../../../components/requests/RequestCancellationPanel";
import EmployeeEditButton from "../../../components/requests/EmployeeEditButton";
import { formatDateTime } from "../../../utils/dateTime";

function statusColor(status: LoanStatus) {
  switch (status) {
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "pending_manager":
      return "orange";
    case "pending_hr":
      return "gold";
    case "pending_finance":
      return "gold";
    case "pending_cfo":
      return "purple";
    case "pending_ceo":
      return "volcano";
    case "pending_disbursement":
      return "geekblue";
    case "deducted":
      return "cyan";
    case "cancelled":
      return "default";
    default:
      return "blue";
  }
}

export default function EmployeeLoanRequestDetailsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { id = "" } = useParams();
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<LoanRequest | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const res = await getMyLoanRequest(id);
        if (isApiError(res)) {
          notification.error({
            message: t("loans.myRequests.failedLoad"),
            description: res.message,
          });
          return;
        }
        setItem(res.data);
      } catch {
        notification.error({ message: t("loans.myRequests.failedLoad") });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, t, reloadKey]);

  const getStatusLabel = (status: LoanStatus) => {
    if (!status) return "";
    const map: Record<string, string> = {
      submitted: "status.submitted",
      pending_manager: "status.pendingManager",
      pending_hr: "status.pendingHr",
      pending_finance: "status.pendingFinance",
      pending_cfo: "status.pendingCfo",
      pending_ceo: "status.pendingCeo",
      pending_disbursement: "status.pendingDisbursement",
      approved: "status.approved",
      rejected: "status.rejected",
      cancelled: "status.cancelled",
      deducted: "status.deducted",
    };
    const key = map[status];
    if (key) return t(key);
    return status
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
  };

  const getLoanTypeLabel = (loanType?: string) => {
    if (loanType === "installment")
      return t("loans.request.loanTypeInstallment");
    return t("loans.request.loanTypeOpen");
  };
  const monthlyDeduction =
    item?.loan_type === "installment" && (item?.installment_months || 0) > 0
      ? Number(item?.requested_amount || 0) /
        Number(item?.installment_months || 1)
      : Number(item?.requested_amount || 0);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PageHeader
        title={
          t("loans.details.titlePrefix") +
          " " +
          (item?.public_reference || "#" + id)
        }
        breadcrumb={t("loans.details.subtitle")}
        actions={
          <>
            {item ? (
              <EmployeeEditButton
                request={item}
                to={`/employee/loans/${item.id}/edit`}
                iconOnly={false}
              />
            ) : null}
            {item ? <LoanPdfDownloadButton loanId={item.id} /> : null}
            <BackButton
              onClick={() => navigate("/employee/loans")}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("loans.details.back")}
            </BackButton>
          </>
        }
      />
      {item ? (
        <div style={{ display: "grid", gap: 18, marginBottom: 18 }}>
          <PendingActionBanner workflow={item.workflow} />
          <RequestCancellationPanel
            kind="loan"
            request={item}
            onChanged={() => setReloadKey((key) => key + 1)}
          />
        </div>
      ) : null}
      <Row gutter={[18, 18]} align="top">
        <Col xs={24} xl={10}>
          {item ? (
            <LoanApprovalMap request={item} t={t} />
          ) : (
            <Card loading={loading} style={{ borderRadius: 16 }} />
          )}
        </Col>
        <Col xs={24} xl={14} style={{ display: "grid", gap: 18 }}>
          <Card loading={loading} style={{ borderRadius: 16 }}>
            {!item ? null : (
              <>
                <Descriptions
                  column={{ xs: 1, sm: 2 }}
                  layout="vertical"
                  bordered
                  style={{ borderRadius: 8, overflow: "hidden" }}
                >
                  <Descriptions.Item label={t("loans.list.colAmount")}>
                    <AmountWithSAR
                      amount={item.requested_amount || 0}
                      size={18}
                      color="#f97316"
                      fontWeight="bold"
                      style={{ fontSize: 18 }}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label={t("loans.request.formLoanType")}>
                    {getLoanTypeLabel(item.loan_type)}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("loans.list.colStatus")}>
                    <Tag
                      color={statusColor(item.status)}
                      style={{
                        borderRadius: 4,
                        padding: "2px 10px",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {getStatusLabel(item.status)}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item
                    label={t("loans.request.formInstallmentMonths")}
                  >
                    {item.loan_type === "installment"
                      ? item.installment_months || "-"
                      : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item
                    label={t("loans.request.monthlyDeductionLabel")}
                  >
                    <AmountWithSAR amount={monthlyDeduction} />
                  </Descriptions.Item>
                  <Descriptions.Item
                    label={t("loans.details.targetDeductionPeriod")}
                  >
                    {item.target_deduction_period ||
                      (item.target_deduction_year && item.target_deduction_month
                        ? `${item.target_deduction_year}-${String(item.target_deduction_month).padStart(2, "0")}`
                        : "-")}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("loans.list.colReason")} span={2}>
                    {item.reason || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("loans.list.colCreated")}>
                    {formatDateTime(item.created_at)}
                  </Descriptions.Item>
                  {item.approved_amount && (
                    <Descriptions.Item
                      label={
                        t("loans.details.approvedAmount") || "Approved Amount"
                      }
                    >
                      <AmountWithSAR
                        amount={item.approved_amount}
                        fontWeight="bold"
                      />
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </>
            )}
          </Card>

          {item ? (
            <DocumentIntegrityPanel
              documentType="loan"
              requestId={item.id}
              isFinal={isDocumentFinal("loan", item.status)}
            />
          ) : null}
        </Col>
      </Row>
    </div>
  );
}
