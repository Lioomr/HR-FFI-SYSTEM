import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Col,
  Grid,
  Input,
  Modal,
  Row,
  Space,
  Typography,
  notification,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import PageHeader from "../ui/PageHeader";
import LoadingState from "../ui/LoadingState";
import ErrorState from "../ui/ErrorState";
import DashboardPanel from "../hr/dashboard/DashboardPanel";
import ApprovalActions from "../ceo/ApprovalActions";
import ApprovalStatusTag from "../ceo/ApprovalStatusTag";
import RejectReasonModal from "../ceo/RejectReasonModal";
import { approvalStatusLabel } from "../ceo/approvalStatusLabel";
import TeamMemberCell from "../manager/TeamMemberCell";
import LoanApprovalMap from "../loans/LoanApprovalMap";
import LoanDecisionTimeline from "./LoanDecisionTimeline";
import { isApiError } from "../../services/api/apiTypes";
import type { LoanRequest } from "../../services/api/loanApi";
import { formatNumber } from "../../utils/currency";
import { formatDateOnly } from "../../utils/dateTime";
import { requestAgeLabel } from "../../utils/requestAge";
import { useI18n } from "../../i18n/useI18n";

const { useBreakpoint } = Grid;

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
};

/** One labelled fact inside a detail panel. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#94a3b8",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: "#0f172a", overflowWrap: "anywhere" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * The loan decision screen shared by the manager, HR, CFO and CEO reviews.
 *
 * The request summary sits on the left and the approval trail on the right, and
 * every decision is taken through a dialog so a rejection always carries a
 * written reason. The caller's `canActWhenStatus` mirrors the backend rule; the
 * backend stays authoritative.
 */
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
}: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const isRtl = language === "ar";

  const [item, setItem] = useState<LoanRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveComment, setApproveComment] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraComment, setExtraComment] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOne(id);
      if (isApiError(res)) {
        setError(res.message || t("loans.myRequests.failedLoad"));
        return;
      }
      setItem(((res as any)?.data ?? res) as LoanRequest);
    } catch (err: any) {
      setError(err?.message || t("loans.myRequests.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [fetchOne, id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const employeeName =
    item?.employee?.full_name || item?.employee?.email || "—";

  const canAct = Array.isArray(canActWhenStatus)
    ? Boolean(item?.status) && canActWhenStatus.includes(item!.status)
    : item?.status === canActWhenStatus;

  const loanTypeLabel = (loanType?: string) =>
    loanType === "installment"
      ? t("loans.request.loanTypeInstallment")
      : t("loans.request.loanTypeOpen");

  const monthlyDeduction =
    item?.loan_type === "installment" && (item?.installment_months || 0) > 0
      ? Number(item?.requested_amount || 0) /
        Number(item?.installment_months || 1)
      : Number(item?.requested_amount || 0);

  const targetPeriod =
    item?.target_deduction_period ||
    (item?.target_deduction_year && item?.target_deduction_month
      ? `${item.target_deduction_year}-${String(item.target_deduction_month).padStart(2, "0")}`
      : "—");

  async function submitApprove() {
    if (!id) return;
    setSubmitting(true);
    try {
      const res = await approve(id, approveComment.trim() || undefined);
      if (isApiError(res)) {
        notification.error({
          message: approveFailedMessage || t("loans.inbox.approveFailed"),
          description: res.message,
        });
        return;
      }
      setItem(((res as any)?.data ?? res) as LoanRequest);
      notification.success({
        message: approveSuccessMessage || t("loans.inbox.requestApproved"),
      });
      setApproveOpen(false);
      setApproveComment("");
    } catch {
      notification.error({
        message: approveFailedMessage || t("loans.inbox.approveFailed"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReject(reason: string) {
    if (!reject || !id) return;
    setSubmitting(true);
    try {
      const res = await reject(id, reason);
      if (isApiError(res)) {
        notification.error({
          message: rejectFailedMessage || t("loans.inbox.rejectFailed"),
          description: res.message,
        });
        return;
      }
      setItem(((res as any)?.data ?? res) as LoanRequest);
      notification.success({
        message: rejectSuccessMessage || t("loans.inbox.requestRejected"),
      });
      setRejectOpen(false);
    } catch {
      notification.error({
        message: rejectFailedMessage || t("loans.inbox.rejectFailed"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitExtraAction() {
    if (!extraAction || !id) return;
    const trimmed = extraComment.trim();
    if (extraAction.requireComment && !trimmed) {
      setExtraError(t("loans.inbox.commentRequired"));
      return;
    }
    setExtraError(null);
    setSubmitting(true);
    try {
      const res = await extraAction.handler(id, trimmed || undefined);
      if (isApiError(res)) {
        notification.error({
          message: extraAction.failedMessage,
          description: res.message,
        });
        return;
      }
      setItem(((res as any)?.data ?? res) as LoanRequest);
      notification.success({ message: extraAction.successMessage });
      setExtraOpen(false);
      setExtraComment("");
    } catch {
      notification.error({ message: extraAction.failedMessage });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState title={t("loading.generic")} />;
  if (error)
    return (
      <ErrorState
        title={t("common.error")}
        description={error}
        onRetry={load}
      />
    );
  if (!item)
    return (
      <ErrorState
        title={t("common.error")}
        description={t("loans.myRequests.failedLoad")}
        onRetry={load}
      />
    );

  const gutter: [number, number] = isMobile ? [12, 12] : [20, 20];

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
      <Button
        type="link"
        icon={
          isRtl ? (
            <ArrowRightOutlined aria-hidden />
          ) : (
            <ArrowLeftOutlined aria-hidden />
          )
        }
        onClick={() => navigate(backPath)}
        style={{ paddingInlineStart: 0, marginBottom: 8, fontWeight: 600 }}
      >
        {t("loans.details.back")}
      </Button>

      <PageHeader
        title={title}
        subtitle={employeeName}
        secondarySubtitle={requestAgeLabel(t, item.created_at)}
        tags={
          <ApprovalStatusTag
            label={approvalStatusLabel(item.status as string, t)}
            status={item.status as string}
          />
        }
        actions={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={load}
            aria-label={t("common.refresh")}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            {t("common.refresh")}
          </Button>
        }
      />

      <Row gutter={gutter} align="top">
        <Col xs={24} lg={14}>
          <Space
            direction="vertical"
            size={isMobile ? 12 : 20}
            style={{ width: "100%" }}
          >
            <DashboardPanel
              title={t("loans.details.employeeSection")}
              animDelay={0}
            >
              <TeamMemberCell
                name={employeeName}
                secondary={item.employee?.email}
                size={44}
              />
            </DashboardPanel>

            <DashboardPanel
              title={t("loans.details.requestSection")}
              animDelay={60}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile
                    ? "1fr"
                    : "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 18,
                }}
              >
                <Field label={t("loans.list.colAmount")}>
                  <span
                    className="tabular-nums"
                    style={{ fontSize: 20, fontWeight: 800, color: "#c2410c" }}
                  >
                    {formatNumber(item.requested_amount || 0)}
                  </span>
                </Field>
                <Field label={t("loans.request.formLoanType")}>
                  {loanTypeLabel(item.loan_type)}
                </Field>
                <Field label={t("loans.request.formInstallmentMonths")}>
                  <span className="tabular-nums">
                    {item.loan_type === "installment"
                      ? item.installment_months || "—"
                      : "—"}
                  </span>
                </Field>
                <Field label={t("loans.request.monthlyDeductionLabel")}>
                  <span className="tabular-nums">
                    {formatNumber(monthlyDeduction)}
                  </span>
                </Field>
                <Field label={t("loans.details.targetDeductionPeriod")}>
                  <span className="tabular-nums">{targetPeriod}</span>
                </Field>
                <Field label={t("loans.list.colCreated")}>
                  <span className="tabular-nums">
                    {formatDateOnly(item.created_at, "—")}
                  </span>
                </Field>
              </div>

              <div style={{ marginTop: 18 }}>
                <Field label={t("loans.list.colReason")}>
                  <Typography.Paragraph
                    style={{ margin: 0, whiteSpace: "pre-wrap" }}
                  >
                    {item.reason || "—"}
                  </Typography.Paragraph>
                </Field>
              </div>
            </DashboardPanel>

            <DashboardPanel
              title={t("loans.details.decisionSection")}
              animDelay={120}
            >
              {canAct ? (
                <Space size={8} wrap>
                  <ApprovalActions
                    size="middle"
                    subjectLabel={employeeName}
                    approveLabel={approveLabel}
                    rejectLabel={rejectLabel}
                    approveLoading={submitting && approveOpen}
                    disabled={submitting}
                    rejectDisabled={!reject}
                    onApprove={() => setApproveOpen(true)}
                    onReject={() => setRejectOpen(true)}
                  />
                  {extraAction && (
                    <Button
                      danger={extraAction.danger}
                      disabled={submitting}
                      onClick={() => {
                        setExtraError(null);
                        setExtraOpen(true);
                      }}
                      style={{ borderRadius: 8, fontWeight: 600 }}
                    >
                      {extraAction.label}
                    </Button>
                  )}
                </Space>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  style={{ borderRadius: 10 }}
                  message={t("loans.details.decisionClosed")}
                />
              )}
            </DashboardPanel>
          </Space>
        </Col>

        <Col xs={24} lg={10}>
          <Space
            direction="vertical"
            size={isMobile ? 12 : 20}
            style={{ width: "100%", marginTop: isMobile ? 12 : 0 }}
          >
            <DashboardPanel
              title={t("loans.details.approvalTrail")}
              animDelay={160}
            >
              <LoanApprovalMap request={item} t={t} />
            </DashboardPanel>

            <DashboardPanel
              title={t("loans.details.historyTitle")}
              animDelay={200}
            >
              <LoanDecisionTimeline entries={item.decision_history} t={t} />
            </DashboardPanel>
          </Space>
        </Col>
      </Row>

      {/* Approve — the decision note is optional here, unlike a rejection. */}
      <Modal
        open={approveOpen}
        title={approveLabel || t("loans.inbox.btnApprove")}
        okText={approveLabel || t("common.approve")}
        okButtonProps={{
          loading: submitting,
          "aria-label": approveLabel || t("common.approve"),
        }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: submitting }}
        onOk={submitApprove}
        onCancel={() => {
          if (!submitting) setApproveOpen(false);
        }}
        closable={!submitting}
        maskClosable={!submitting}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text strong>
            {employeeName} — {formatNumber(item.requested_amount || 0)}
          </Typography.Text>
          <div>
            <Typography.Text style={{ display: "block", marginBottom: 6 }}>
              {t("loans.inbox.decisionComment")}
            </Typography.Text>
            <Input.TextArea
              rows={3}
              autoFocus
              maxLength={500}
              showCount
              disabled={submitting}
              value={approveComment}
              aria-label={t("loans.inbox.decisionComment")}
              placeholder={t("loans.inbox.commentPlaceholder")}
              onChange={(event) => setApproveComment(event.target.value)}
            />
          </div>
        </Space>
      </Modal>

      <RejectReasonModal
        open={rejectOpen}
        title={rejectLabel || t("loans.inbox.btnReject")}
        subject={employeeName}
        confirmText={rejectLabel || t("common.reject")}
        loading={submitting}
        onCancel={() => setRejectOpen(false)}
        onSubmit={submitReject}
      />

      {extraAction && (
        <Modal
          open={extraOpen}
          title={extraAction.label}
          okText={extraAction.label}
          okButtonProps={{
            loading: submitting,
            danger: extraAction.danger,
            "aria-label": extraAction.label,
          }}
          cancelText={t("common.cancel")}
          cancelButtonProps={{ disabled: submitting }}
          onOk={submitExtraAction}
          onCancel={() => {
            if (!submitting) setExtraOpen(false);
          }}
          closable={!submitting}
          maskClosable={!submitting}
          destroyOnHidden
        >
          <Typography.Text style={{ display: "block", marginBottom: 6 }}>
            {t("loans.inbox.decisionComment")}
            {extraAction.requireComment ? " *" : ""}
          </Typography.Text>
          <Input.TextArea
            rows={3}
            autoFocus
            maxLength={500}
            showCount
            disabled={submitting}
            value={extraComment}
            aria-label={t("loans.inbox.decisionComment")}
            placeholder={t("loans.inbox.commentPlaceholder")}
            onChange={(event) => {
              setExtraComment(event.target.value);
              if (extraError) setExtraError(null);
            }}
          />
          {extraError && (
            <Alert
              type="error"
              showIcon
              message={extraError}
              style={{ marginTop: 12, borderRadius: 10 }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
