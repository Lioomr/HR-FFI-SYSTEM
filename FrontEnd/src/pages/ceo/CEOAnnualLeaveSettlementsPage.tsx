import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Space, Table, Typography, notification } from "antd";
import type { ColumnsType } from "antd/es/table";

import ApprovalActions from "../../components/ceo/ApprovalActions";
import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import AnnualLeavePaymentStatusTag from "../../components/leaves/AnnualLeavePaymentStatusTag";
import {
  formatSettlementAmount,
  formatSettlementDays,
} from "../../components/leaves/annualLeaveSettlement";
import AnnualLeaveSettlementDetails from "../../components/leaves/AnnualLeaveSettlementDetails";
import { useI18n } from "../../i18n/useI18n";
import {
  approveAnnualLeavePaymentRequest,
  getAnnualLeavePaymentRequests,
  rejectAnnualLeavePaymentRequest,
  type AnnualLeavePaymentRequest,
} from "../../services/api/annualLeavePaymentsApi";
import { isApiError } from "../../services/api/apiTypes";
import { getDetailedHttpErrorMessage } from "../../services/api/userErrorMessages";
import { getFirstApiErrorMessage } from "../../utils/formErrors";

const PAGE_SIZE = 20;

/**
 * CEO decision queue for Annual Leave settlements.
 *
 * Only `pending_ceo` records are requested, matching the single stage the CEO
 * can act on. Approving a request whose resolution is `carry_forward` ends at
 * `carried_forward` rather than `approved` — the days move into the next cycle
 * and nothing is paid — so the outcome is spelled out before the decision.
 */
export default function CEOAnnualLeaveSettlementsPage() {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState<AnnualLeavePaymentRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [approving, setApproving] = useState<AnnualLeavePaymentRequest | null>(
    null,
  );
  const [rejecting, setRejecting] = useState<AnnualLeavePaymentRequest | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const loadData = useCallback(
    async (
      targetPage = 1,
      { isRefresh = false }: { isRefresh?: boolean } = {},
    ) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await getAnnualLeavePaymentRequests({
          page: targetPage,
          page_size: PAGE_SIZE,
          status: "pending_ceo",
          ordering: "-submitted_at",
        });
        if (isApiError(res)) {
          setError(res.message);
          return;
        }
        setRequests(res.data?.items ?? []);
        setTotal(res.data?.count ?? 0);
      } catch (err) {
        setError(getDetailedHttpErrorMessage(t, err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadData(page);
  }, [loadData, page]);

  const employeeName = (record: AnnualLeavePaymentRequest) =>
    record.employee_name || `#${record.employee_id ?? record.id}`;

  const submitApprove = async () => {
    if (!approving) return;
    const row = approving;
    setProcessing(true);
    setActionError(null);
    // Optimistic: drop the row from the queue immediately so it's already gone
    // by the time the modal closes; restore it if the approval fails. The modal
    // itself stays open on failure so `actionError` remains visible, matching
    // the existing inline-error UX.
    setRequests((current) => current.filter((item) => item.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    try {
      const res = await approveAnnualLeavePaymentRequest(row.id);
      if (isApiError(res)) {
        setRequests((current) =>
          current.some((item) => item.id === row.id)
            ? current
            : [row, ...current],
        );
        setTotal((current) => current + 1);
        setActionError(getFirstApiErrorMessage(res) || res.message);
        return;
      }
      notification.success({
        message:
          row.resolution === "carry_forward"
            ? t("annualPayment.carriedForwardSuccess")
            : t("annualPayment.approveSuccess"),
      });
      setApproving(null);
      // The optimistic removal above is only a display shortcut. Re-read the
      // queue so the row's settled state and the server's own count replace the
      // guess, and so a decision taken elsewhere shows up here.
      await loadData(page);
    } catch (err) {
      setRequests((current) =>
        current.some((item) => item.id === row.id)
          ? current
          : [row, ...current],
      );
      setTotal((current) => current + 1);
      setActionError(
        getFirstApiErrorMessage(err) || getDetailedHttpErrorMessage(t, err),
      );
    } finally {
      setProcessing(false);
    }
  };

  const submitReject = async (reason: string) => {
    if (!rejecting) return;
    const row = rejecting;
    setProcessing(true);
    setActionError(null);
    // Optimistic: drop the row immediately; restore it if the rejection fails.
    setRequests((current) => current.filter((item) => item.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    try {
      const res = await rejectAnnualLeavePaymentRequest(row.id, reason);
      if (isApiError(res)) {
        setRequests((current) =>
          current.some((item) => item.id === row.id)
            ? current
            : [row, ...current],
        );
        setTotal((current) => current + 1);
        setActionError(getFirstApiErrorMessage(res) || res.message);
        return;
      }
      notification.success({ message: t("annualPayment.rejectSuccess") });
      setRejecting(null);
      // As with approval: the optimistic removal is a display shortcut, the
      // re-read is what makes the queue authoritative.
      await loadData(page);
    } catch (err) {
      setRequests((current) =>
        current.some((item) => item.id === row.id)
          ? current
          : [row, ...current],
      );
      setTotal((current) => current + 1);
      setActionError(
        getFirstApiErrorMessage(err) || getDetailedHttpErrorMessage(t, err),
      );
    } finally {
      setProcessing(false);
    }
  };

  const columns: ColumnsType<AnnualLeavePaymentRequest> = [
    {
      title: t("annualPayment.employee"),
      key: "employee",
      render: (_, record) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "#0f172a" }}>
            {employeeName(record)}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>#{record.id}</div>
        </div>
      ),
    },
    {
      title: t("annualPayment.contractYear"),
      key: "cycle",
      render: (_, record) => (
        <span className="tabular-nums">
          {record.cycle_start} → {record.cycle_end}
        </span>
      ),
    },
    {
      title: t("annualPayment.eligibleDays"),
      key: "eligible_unused_days",
      align: "center",
      render: (_, record) => formatSettlementDays(record.eligible_unused_days),
    },
    {
      title: t("annualPayment.yearEndSalary"),
      key: "salary_at_year_end",
      align: "right",
      render: (_, record) => formatSettlementAmount(record.salary_at_year_end),
    },
    {
      title: t("annualPayment.paymentAmount"),
      key: "payment_amount",
      align: "right",
      render: (_, record) => formatSettlementAmount(record.payment_amount),
    },
    {
      title: t("annualPayment.resolution"),
      key: "resolution",
      width: 150,
      render: (_, record) =>
        record.resolution === "carry_forward"
          ? t("annualPayment.resolution.carryForward")
          : t("annualPayment.resolution.pay"),
    },
    {
      title: t("common.status"),
      key: "status",
      width: 150,
      render: (_, record) => (
        <AnnualLeavePaymentStatusTag status={record.status} />
      ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 210,
      render: (_, record) => (
        <ApprovalActions
          subjectLabel={employeeName(record)}
          approveLoading={processing && approving?.id === record.id}
          disabled={processing}
          onApprove={() => {
            setActionError(null);
            setApproving(record);
          }}
          onReject={() => {
            setActionError(null);
            setRejecting(record);
          }}
        />
      ),
    },
  ];

  return (
    <>
      <ApprovalQueuePage
        title={t("annualPayment.ceoTitle")}
        subtitle={t("annualPayment.ceoSubtitle")}
        pendingCount={total}
        loading={loading}
        error={error}
        isEmpty={requests.length === 0}
        emptyTitle={t("annualPayment.ceoEmpty")}
        emptyDescription={t("ceo.approvals.emptyDescription")}
        onRetry={() => loadData(1)}
        onRefresh={() => loadData(page, { isRefresh: true })}
        refreshing={refreshing}
      >
        <Table
          columns={columns}
          dataSource={requests}
          rowKey="id"
          scroll={{ x: 1180 }}
          expandable={{
            expandedRowRender: (record) => (
              <AnnualLeaveSettlementDetails request={record} showEmployee />
            ),
          }}
          pagination={{
            current: page,
            total,
            pageSize: PAGE_SIZE,
            showSizeChanger: false,
            hideOnSinglePage: true,
            style: { paddingInline: 16 },
            onChange: (nextPage) => setPage(nextPage),
          }}
        />
      </ApprovalQueuePage>

      <Modal
        open={Boolean(approving)}
        title={t("annualPayment.approveTitle")}
        okText={t("common.approve")}
        okButtonProps={{
          loading: processing,
          "aria-label": t("common.approve"),
        }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: processing }}
        onOk={submitApprove}
        onCancel={() => {
          if (processing) return;
          setApproving(null);
        }}
        closable={!processing}
        maskClosable={!processing}
        destroyOnHidden
        width="min(720px, 96vw)"
      >
        {approving && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Text strong>{employeeName(approving)}</Typography.Text>
            <Alert
              type={
                approving.resolution === "carry_forward" ? "info" : "success"
              }
              showIcon
              style={{ borderRadius: 10 }}
              message={
                approving.resolution === "carry_forward"
                  ? t("annualPayment.approveCarryForwardNotice")
                  : t("annualPayment.approvePayNotice")
              }
            />
            <AnnualLeaveSettlementDetails request={approving} showEmployee />
            {actionError && (
              <Alert
                type="error"
                showIcon
                message={actionError}
                style={{ borderRadius: 10 }}
              />
            )}
          </Space>
        )}
      </Modal>

      <RejectReasonModal
        open={Boolean(rejecting)}
        title={t("annualPayment.rejectTitle")}
        subject={rejecting ? employeeName(rejecting) : undefined}
        confirmText={t("annualPayment.rejectConfirm")}
        loading={processing}
        errorMessage={rejecting ? actionError : null}
        onCancel={() => setRejecting(null)}
        onSubmit={submitReject}
      />
    </>
  );
}
