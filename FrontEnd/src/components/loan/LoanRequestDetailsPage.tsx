import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Input, Space, Tag, Typography, notification } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, FileTextOutlined, CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons";

const { Text, Title } = Typography;

import PageHeader from "../ui/PageHeader";
import { isApiError } from "../../services/api/apiTypes";
import type { LoanRequest } from "../../services/api/loanApi";
import { formatNumber } from "../../utils/currency";
import { useI18n } from "../../i18n/useI18n";
import LoanApprovalMap from "../loans/LoanApprovalMap";

type Props = {
  title: string;
  backPath: string;
  fetchOne: (id: string | number) => Promise<any>;
  approve: (id: string | number, comment?: string) => Promise<any>;
  reject?: (id: string | number, comment: string) => Promise<any>;
  extraAction?: {
    label: string;
    successMessage: string;
    failedMessage: string;
    requireComment?: boolean;
    handler: (id: string | number, comment?: string) => Promise<any>;
    danger?: boolean;
  };
  canActWhenStatus: string | string[];
  approveLabel?: string;
  rejectLabel?: string;
  approveSuccessMessage?: string;
  rejectSuccessMessage?: string;
  approveFailedMessage?: string;
  rejectFailedMessage?: string;
  requireRejectComment?: boolean;
};

export default function LoanRequestDetailsPage({
  title,
  backPath,
  fetchOne,
  approve,
  reject,
  extraAction,
  canActWhenStatus,
  approveLabel,
  rejectLabel,
  approveSuccessMessage,
  rejectSuccessMessage,
  approveFailedMessage,
  rejectFailedMessage,
  requireRejectComment = true,
}: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const isRtl = language === 'ar';
  const [item, setItem] = useState<LoanRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const res = await fetchOne(id);
        if (isApiError(res)) {
          notification.error({ message: t("loans.myRequests.failedLoad"), description: res.message });
          return;
        }
        const payload = (res as any)?.data ?? res;
        setItem(payload as LoanRequest);
      } catch {
        notification.error({ message: t("loans.myRequests.failedLoad") });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchOne, id, t]);

  async function handleApprove() {
    if (!id) return;
    setSubmitting(true);
    try {
      const res = await approve(id, comment || undefined);
      if (isApiError(res)) {
        notification.error({ message: approveFailedMessage || t("loans.inbox.approveFailed"), description: res.message });
        return;
      }
      const payload = (res as any)?.data ?? res;
      setItem(payload as LoanRequest);
      notification.success({ message: approveSuccessMessage || t("loans.inbox.requestApproved") });
    } catch {
      notification.error({ message: approveFailedMessage || t("loans.inbox.approveFailed") });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!reject) return;
    if (!id) return;
    if (requireRejectComment && !comment.trim()) {
      notification.warning({ message: t("loans.inbox.commentRequired") });
      return;
    }
    setSubmitting(true);
    try {
      const res = await reject(id, comment.trim());
      if (isApiError(res)) {
        notification.error({ message: rejectFailedMessage || t("loans.inbox.rejectFailed"), description: res.message });
        return;
      }
      const payload = (res as any)?.data ?? res;
      setItem(payload as LoanRequest);
      notification.success({ message: rejectSuccessMessage || t("loans.inbox.requestRejected") });
    } catch {
      notification.error({ message: rejectFailedMessage || t("loans.inbox.rejectFailed") });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExtraAction() {
    if (!extraAction || !id) return;
    if (extraAction.requireComment && !comment.trim()) {
      notification.warning({ message: t("loans.inbox.commentRequired") });
      return;
    }
    setSubmitting(true);
    try {
      const res = await extraAction.handler(id, comment.trim() || undefined);
      if (isApiError(res)) {
        notification.error({ message: extraAction.failedMessage, description: res.message });
        return;
      }
      const payload = (res as any)?.data ?? res;
      setItem(payload as LoanRequest);
      notification.success({ message: extraAction.successMessage });
    } catch {
      notification.error({ message: extraAction.failedMessage });
    } finally {
      setSubmitting(false);
    }
  }

  const getStatusLabel = (status: string) => {
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

  const canAct = Array.isArray(canActWhenStatus)
    ? !!item?.status && canActWhenStatus.includes(item.status)
    : item?.status === canActWhenStatus;

  return (
    <div>
      <Button icon={isRtl ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} type="link" onClick={() => navigate(backPath)} style={{ paddingInlineStart: 0 }}>
        {t("loans.details.back")}
      </Button>
      <PageHeader
        title={title}
        breadcrumb={t("loans.inbox.reviewSubtitle")}
      />
      <Card loading={loading} style={{ borderRadius: 16 }}>
        {!item ? null : (
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <LoanApprovalMap request={item} t={t} />

            <Descriptions
              column={2}
              layout="vertical"
              bordered
              style={{ borderRadius: 8, overflow: 'hidden' }}
            >
              <Descriptions.Item label={t("payroll.runDetails.colEmployee")}>{item.employee?.full_name || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("settings.editProfile.lblEmail")}>{item.employee?.email || "-"}</Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colAmount")}>
                <Text strong style={{ fontSize: 18, color: '#f97316' }}>
                  {formatNumber(item.requested_amount || 0)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.request.formLoanType")}>
                {getLoanTypeLabel(item.loan_type)}
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colStatus")}>
                <Tag style={{ borderRadius: 4, padding: '2px 10px', fontSize: 13, fontWeight: 600 }}>
                  {getStatusLabel(item.status as string)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.request.formInstallmentMonths")}>
                {item.loan_type === "installment" ? item.installment_months || "-" : "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.request.monthlyDeductionLabel")}>
                {formatNumber(monthlyDeduction)}
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.details.targetDeductionPeriod")}>
                {item.target_deduction_period ||
                  (item.target_deduction_year && item.target_deduction_month
                    ? `${item.target_deduction_year}-${String(item.target_deduction_month).padStart(2, "0")}`
                    : "-")}
              </Descriptions.Item>
              <Descriptions.Item label={t("loans.list.colReason")} span={2}>{item.reason || "-"}</Descriptions.Item>
            </Descriptions>

            <div>
              <div style={{ marginBottom: 12 }}>
                <Title level={5} style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>
                  {t("loans.details.historyTitle")}
                </Title>
              </div>

              <div style={{ position: 'relative', paddingLeft: 4 }}>
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
            </div>

            <div style={{ padding: 20, background: '#fafafa', borderRadius: 16, border: '1px solid #f0f0f0' }}>
              <Title level={5} style={{ marginBottom: 12 }}>{t("loans.inbox.decisionComment")}</Title>
              <Input.TextArea
                rows={3}
                placeholder={t("loans.inbox.commentPlaceholder") || "Enter your decision note..."}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ borderRadius: 8 }}
              />
              <Space style={{ marginTop: 16 }}>
                <Button type="primary" size="large" onClick={handleApprove} loading={submitting} disabled={!canAct} style={{ minWidth: 120 }}>
                  {approveLabel || t("loans.inbox.btnApprove")}
                </Button>
                {reject ? (
                  <Button danger size="large" onClick={handleReject} loading={submitting} disabled={!canAct} style={{ minWidth: 120 }}>
                    {rejectLabel || t("loans.inbox.btnReject")}
                  </Button>
                ) : null}
                {extraAction ? (
                  <Button
                    type={extraAction.danger ? "default" : "dashed"}
                    danger={extraAction.danger}
                    size="large"
                    onClick={handleExtraAction}
                    loading={submitting}
                    disabled={!canAct}
                    style={{ minWidth: 140 }}
                  >
                    {extraAction.label}
                  </Button>
                ) : null}
              </Space>
            </div>
          </Space>
        )}
      </Card>
    </div>
  );
}
