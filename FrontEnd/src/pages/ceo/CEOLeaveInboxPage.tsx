import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Grid,
  Input,
  Modal,
  Space,
  Table,
  Tooltip,
  Typography,
  notification,
} from "antd";
import { DownloadOutlined, EyeOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import ApprovalActions from "../../components/ceo/ApprovalActions";
import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import ApprovalStatusTag from "../../components/ceo/ApprovalStatusTag";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import { approvalStatusLabel } from "../../components/ceo/approvalStatusLabel";
import LeaveApprovalMap from "../../components/leaves/LeaveApprovalMap";
import RequestObligationsPanel from "../../components/requests/RequestObligationsPanel";
import { useI18n } from "../../i18n/useI18n";
import { openOrDownloadBlob } from "../../utils/download";
import { isApiError } from "../../services/api/apiTypes";
import {
  approveCEOLeaveRequest,
  getCEOLeaveRequests,
  getLeaveRequestDocumentBlob,
  rejectCEOLeaveRequest,
  type LeaveRequest,
} from "../../services/api/leaveApi";

const { useBreakpoint } = Grid;
const PAGE_SIZE = 20;

export default function CEOLeaveInboxPage() {
  const { t } = useI18n();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [approving, setApproving] = useState<LeaveRequest | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverError, setWaiverError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [processing, setProcessing] = useState(false);
  const [documentLoading, setDocumentLoading] = useState<number | null>(null);

  const loadData = useCallback(
    async (
      targetPage = 1,
      { isRefresh = false }: { isRefresh?: boolean } = {},
    ) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await getCEOLeaveRequests({
          page: targetPage,
          page_size: PAGE_SIZE,
        });
        if (isApiError(res)) {
          setError(res.message);
          return;
        }
        setRequests(res.data?.items ?? []);
        setTotal(res.data?.count ?? 0);
      } catch (e: any) {
        setError(e?.message || t("common.tryAgain"));
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

  const employeeName = (record: LeaveRequest) =>
    record.employee?.full_name || `#${record.employee?.id ?? record.id}`;

  // ── Approve, with the CEO waiver requirement kept intact ──────────────────
  const blockerCount = approving?.obligations_summary?.blocking_open || 0;

  const closeApprove = () => {
    if (processing) return;
    setApproving(null);
    setWaiverReason("");
    setWaiverError(null);
  };

  const submitApprove = async () => {
    if (!approving) return;
    const trimmedWaiver = waiverReason.trim();
    if (blockerCount > 0 && !trimmedWaiver) {
      setWaiverError(
        t("obligations.waiverRequired", "Waiver reason is required."),
      );
      return;
    }
    setWaiverError(null);
    setProcessing(true);
    const row = approving;
    // Optimistic: close the modal and drop the row from the inbox immediately;
    // restore it and re-open the row's context if the approval fails.
    setApproving(null);
    setWaiverReason("");
    setRequests((current) => current.filter((item) => item.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    try {
      const res = await approveCEOLeaveRequest(
        row.id,
        undefined,
        trimmedWaiver || undefined,
      );
      if (isApiError(res)) {
        setRequests((current) =>
          current.some((item) => item.id === row.id)
            ? current
            : [row, ...current],
        );
        setTotal((current) => current + 1);
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
        return;
      }
      notification.success({
        message: t(
          "leave.ceoApproveSuccess",
          "Approved and sent to HR for completion.",
        ),
      });
    } catch {
      setRequests((current) =>
        current.some((item) => item.id === row.id)
          ? current
          : [row, ...current],
      );
      setTotal((current) => current + 1);
      notification.error({
        message: t("common.error"),
        description: t("common.tryAgain"),
      });
    } finally {
      setProcessing(false);
    }
  };

  const submitReject = async (reason: string) => {
    if (!rejecting) return;
    const row = rejecting;
    setProcessing(true);
    // Optimistic: close the modal and drop the row immediately; restore it on failure.
    setRejecting(null);
    setRequests((current) => current.filter((item) => item.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    try {
      const res = await rejectCEOLeaveRequest(row.id, reason);
      if (isApiError(res)) {
        setRequests((current) =>
          current.some((item) => item.id === row.id)
            ? current
            : [row, ...current],
        );
        setTotal((current) => current + 1);
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
        return;
      }
      notification.success({ message: t("leave.rejected") });
    } catch {
      setRequests((current) =>
        current.some((item) => item.id === row.id)
          ? current
          : [row, ...current],
      );
      setTotal((current) => current + 1);
      notification.error({
        message: t("common.error"),
        description: t("common.tryAgain"),
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleDocumentBlobAction = async (id: number, download: boolean) => {
    setDocumentLoading(id);
    try {
      const blob = await getLeaveRequestDocumentBlob(id, download);
      openOrDownloadBlob(blob, `leave_request_${id}_document`, download);
    } catch {
      notification.error({
        message: t("common.error"),
        description: t("common.tryAgain"),
      });
    } finally {
      setDocumentLoading(null);
    }
  };

  const columns: ColumnsType<LeaveRequest> = [
    {
      title: t("ceo.leaveApprovals.employee"),
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
      title: t("leave.type"),
      key: "leave_type",
      render: (_, record) => record.leave_type?.name || "—",
    },
    {
      title: t("ceo.leaveApprovals.period"),
      key: "period",
      render: (_, record) => (
        <span className="tabular-nums">
          {record.start_date} → {record.end_date}
        </span>
      ),
    },
    {
      title: t("leave.days"),
      dataIndex: "days",
      key: "days",
      width: 80,
      align: "center",
    },
    {
      title: t("common.status"),
      key: "status",
      width: 150,
      render: (_, record) => (
        <ApprovalStatusTag
          label={approvalStatusLabel(record.status, t)}
          status={record.status}
        />
      ),
    },
    {
      title: t("ceo.leaveApprovals.document"),
      key: "document",
      width: 110,
      render: (_, record) =>
        record.document ? (
          <Space size={4}>
            <Tooltip title={t("common.view")}>
              <Button
                size="small"
                icon={<EyeOutlined aria-hidden />}
                loading={documentLoading === record.id}
                onClick={() => handleDocumentBlobAction(record.id, false)}
                aria-label={`${t("common.view")}: ${employeeName(record)}`}
              />
            </Tooltip>
            <Tooltip title={t("common.download")}>
              <Button
                size="small"
                icon={<DownloadOutlined aria-hidden />}
                loading={documentLoading === record.id}
                onClick={() => handleDocumentBlobAction(record.id, true)}
                aria-label={`${t("common.download")}: ${employeeName(record)}`}
              />
            </Tooltip>
          </Space>
        ) : (
          <span style={{ color: "#94a3b8" }}>—</span>
        ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: isNarrow ? 200 : 210,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        <ApprovalActions
          subjectLabel={employeeName(record)}
          approveLoading={processing && approving?.id === record.id}
          disabled={processing}
          onApprove={() => {
            setApproving(record);
            setWaiverReason("");
            setWaiverError(null);
          }}
          onReject={() => setRejecting(record)}
        />
      ),
    },
  ];

  return (
    <>
      <ApprovalQueuePage
        title={t("ceo.leaveApprovals.title")}
        subtitle={t("ceo.leaveApprovals.subtitle")}
        pendingCount={total}
        loading={loading}
        error={error}
        isEmpty={requests.length === 0}
        emptyTitle={t("ceo.leaveApprovals.noRequests")}
        emptyDescription={t("ceo.approvals.emptyDescription")}
        onRetry={() => loadData(1)}
        onRefresh={() => loadData(page, { isRefresh: true })}
        refreshing={refreshing}
      >
        <Table
          columns={columns}
          dataSource={requests}
          rowKey="id"
          scroll={{ x: 960 }}
          expandable={{
            expandedRowRender: (record) => (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <LeaveApprovalMap request={record} t={t} />
                <RequestObligationsPanel
                  parentType="leave_request"
                  parentId={record.id}
                  leaveRequest={record}
                  onChanged={() => loadData(page)}
                />
              </Space>
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

      {/* Approve — carries the blocking-obligation waiver when required */}
      <Modal
        open={Boolean(approving)}
        title={t("ceo.leaveApprovals.approveTitle")}
        okText={t("common.approve")}
        okButtonProps={{
          loading: processing,
          "aria-label": t("common.approve"),
        }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: processing }}
        onOk={submitApprove}
        onCancel={closeApprove}
        closable={!processing}
        maskClosable={!processing}
        destroyOnHidden
      >
        {approving && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Text strong>
              {employeeName(approving)} — {approving.days} {t("leave.days")}
            </Typography.Text>
            {blockerCount > 0 && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  style={{ borderRadius: 10 }}
                  message={t(
                    "obligations.ceoWaiverRequired",
                    { count: blockerCount },
                    "{count} blocking obligation(s) remain. Enter a CEO waiver reason to approve.",
                  )}
                />
                <Form layout="vertical" style={{ width: "100%" }}>
                  <Form.Item
                    label={t("obligations.waiverReason", "Waiver reason")}
                    required
                    validateStatus={waiverError ? "error" : undefined}
                    help={waiverError || undefined}
                    style={{ marginBottom: 0 }}
                  >
                    <Input.TextArea
                      rows={3}
                      autoFocus
                      value={waiverReason}
                      disabled={processing}
                      aria-label={t(
                        "obligations.waiverReason",
                        "Waiver reason",
                      )}
                      onChange={(event) => {
                        setWaiverReason(event.target.value);
                        if (waiverError) setWaiverError(null);
                      }}
                    />
                  </Form.Item>
                </Form>
              </>
            )}
          </Space>
        )}
      </Modal>

      <RejectReasonModal
        open={Boolean(rejecting)}
        title={t("ceo.leaveApprovals.rejectTitle")}
        subject={rejecting ? employeeName(rejecting) : undefined}
        confirmText={t("ceo.leaveApprovals.rejectConfirm")}
        loading={processing}
        onCancel={() => setRejecting(null)}
        onSubmit={submitReject}
      />
    </>
  );
}
