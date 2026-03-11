import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Tag, Typography, notification } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, FileTextOutlined, CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons";

const { Text, Title } = Typography;

import PageHeader from "../../../components/ui/PageHeader";
import { isApiError } from "../../../services/api/apiTypes";
import { getMyLoanRequest, type LoanRequest, type LoanStatus } from "../../../services/api/loanApi";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";
import LoanApprovalMap from "../../../components/loans/LoanApprovalMap";

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
  const { t, language } = useI18n();
  const isRtl = language === 'ar';
  const { id = "" } = useParams();
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<LoanRequest | null>(null);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const res = await getMyLoanRequest(id);
        if (isApiError(res)) {
          notification.error({ message: t("loans.myRequests.failedLoad"), description: res.message });
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
  }, [id, t]);

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
    return status.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  };

  const getStageLabel = (stage: string) => {
    const translated = t(`loans.history.stage.${stage}`);
    if (translated !== `loans.history.stage.${stage}`) return translated;
    return stage.replace(/_/g, " ");
  };
  const getLoanTypeLabel = (loanType?: string) => {
    if (loanType === "installment") return t("loans.request.loanTypeInstallment");
    return t("loans.request.loanTypeOpen");
  };
  const monthlyDeduction =
    item?.loan_type === "installment" && (item?.installment_months || 0) > 0
      ? Number(item?.requested_amount || 0) / Number(item?.installment_months || 1)
      : Number(item?.requested_amount || 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <Button type="link" icon={isRtl ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} onClick={() => navigate("/employee/loans")} style={{ paddingInlineStart: 0 }}>
        {t("loans.details.back")}
      </Button>
      <PageHeader
        title={t("loans.details.titlePrefix") + " #" + id}
        breadcrumb={t("loans.details.subtitle")}
      />
      <Card loading={loading} style={{ borderRadius: 16 }}>
        {!item ? null : (
          <>
            <div style={{ marginBottom: 24 }}>
              <LoanApprovalMap request={item} t={t} />
            </div>

            <Descriptions
              column={{ xs: 1, sm: 2 }}
              layout="vertical"
              bordered
              style={{ borderRadius: 8, overflow: 'hidden' }}
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
                <Tag color={statusColor(item.status)} style={{ borderRadius: 4, padding: '2px 10px', fontSize: 13, fontWeight: 600 }}>
                  {getStatusLabel(item.status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.request.formInstallmentMonths")}>
                {item.loan_type === "installment" ? item.installment_months || "-" : "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.request.monthlyDeductionLabel")}>
                <AmountWithSAR amount={monthlyDeduction} />
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.details.targetDeductionPeriod")}>
                {item.target_deduction_period ||
                  (item.target_deduction_year && item.target_deduction_month
                    ? `${item.target_deduction_year}-${String(item.target_deduction_month).padStart(2, "0")}`
                    : "-")}
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colReason")} span={2}>{item.reason || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colCreated")}>
                {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
              </Descriptions.Item>
              {item.approved_amount && (
                <Descriptions.Item label={t("loans.details.approvedAmount") || "Approved Amount"}>
                  <AmountWithSAR amount={item.approved_amount} fontWeight="bold" />
                </Descriptions.Item>
              )}
            </Descriptions>

            <div style={{ marginTop: 28, marginBottom: 12 }}>
              <Title level={5} style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>
                {t("loans.details.historyTitle")}
              </Title>
            </div>

            <div style={{ position: 'relative', paddingLeft: 4 }}>
              {/* Vertical flow line */}
              <div style={{ position: 'absolute', left: 15, top: 8, bottom: 12, width: 2, background: 'linear-gradient(to bottom, #f97316 0%, #e2e8f0 25%)', opacity: 0.35, borderRadius: 2 }} />

              {(item.decision_history || []).map((entry, index) => {
                const isFirst = index === 0;
                const stageLower = entry.stage.toLowerCase();
                const noteLower = (entry.note || '').toLowerCase();

                let dotColor = '#94a3b8';
                let icon = <CheckCircleFilled style={{ fontSize: 12 }} />;

                if (stageLower.includes('submit')) {
                  dotColor = '#3b82f6'; icon = <FileTextOutlined style={{ fontSize: 12 }} />;
                } else if (stageLower.includes('deduct')) {
                  dotColor = '#06b6d4'; icon = <CheckCircleFilled style={{ fontSize: 12 }} />;
                } else if (stageLower.includes('reject') || noteLower.includes('reject')) {
                  dotColor = '#ef4444'; icon = <CloseCircleFilled style={{ fontSize: 12 }} />;
                } else if (stageLower.includes('approve') || noteLower.includes('approv')) {
                  dotColor = '#10b981'; icon = <CheckCircleFilled style={{ fontSize: 12 }} />;
                } else if (stageLower.includes('cancel')) {
                  dotColor = '#6b7280'; icon = <CloseCircleFilled style={{ fontSize: 12 }} />;
                }

                return (
                  <div key={index} style={{ display: 'flex', gap: 14, marginBottom: 14, position: 'relative', animation: `fadeInUp 0.4s ease-out ${index * 0.07}s both` }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#fff', border: `2px solid ${dotColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, flexShrink: 0, marginTop: 2, boxShadow: isFirst ? `0 0 8px ${dotColor}30` : 'none' }}>
                      <div style={{ color: dotColor, lineHeight: 0 }}>{icon}</div>
                    </div>

                    <div className="glass" style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: isFirst ? '1px solid rgba(249,115,22,0.15)' : '1px solid rgba(226,232,240,0.6)', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', transition: 'transform 0.15s ease', cursor: 'default' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Text strong style={{ fontSize: 12, letterSpacing: '0.01em', color: isFirst ? '#f97316' : '#475569' }}>
                            {getStageLabel(entry.stage)}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#94a3b8' }}>·</Text>
                          <Text style={{ fontSize: 11, color: '#64748b' }}>{entry.actor_email || "System"}</Text>
                        </div>
                        <Text type="secondary" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                          {entry.at ? new Date(entry.at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ""}
                        </Text>
                      </div>
                      {entry.note && (
                        <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(249,115,22,0.04)', borderRadius: 6, fontSize: 12, color: '#475569', borderLeft: '2px solid rgba(249,115,22,0.15)' }}>
                          {entry.note}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
