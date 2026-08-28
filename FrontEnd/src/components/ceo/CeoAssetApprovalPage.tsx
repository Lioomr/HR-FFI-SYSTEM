import { useCallback, useEffect, useState } from "react";
import { Grid, Input, Modal, Table, Typography, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ReactNode } from "react";

import { useI18n } from "../../i18n/useI18n";
import { isApiError, type ApiResponse } from "../../services/api/apiTypes";
import ApprovalActions from "./ApprovalActions";
import ApprovalQueuePage from "./ApprovalQueuePage";
import ApprovalStatusTag from "./ApprovalStatusTag";
import RejectReasonModal from "./RejectReasonModal";
import { approvalStatusLabel } from "./approvalStatusLabel";

const { useBreakpoint } = Grid;
const PAGE_SIZE = 20;

/** Note recorded against an approval when the CEO adds none of their own. */
const DEFAULT_APPROVAL_NOTE = "Approved by CEO";

/** The fields both CEO asset queues share. */
export interface CeoAssetRecord {
  id: number;
  asset_code: string;
  asset_name: string;
  employee_name?: string;
  employee_email?: string;
  status: string;
}

type ListPayload<T> = { items: T[]; count?: number } | T[];

/**
 * Damage reports and return requests are the same review task over different
 * records, so both queues render from here: one table shape, one approve
 * dialog, one rejection dialog.
 */
export default function CeoAssetApprovalPage<T extends CeoAssetRecord>({
  title,
  subtitle,
  emptyTitle,
  rejectTitle,
  detailColumn,
  fetcher,
  approve,
  reject,
  expandedRowRender,
}: {
  title: string;
  subtitle: string;
  emptyTitle: string;
  rejectTitle: string;
  /** The one column that differs between the two queues. */
  detailColumn: { title: string; render: (record: T) => ReactNode };
  fetcher: (params: {
    status?: string;
    page?: number;
    page_size?: number;
  }) => Promise<ApiResponse<ListPayload<T>>>;
  approve: (
    id: number | string,
    comment?: string,
  ) => Promise<ApiResponse<unknown>>;
  reject: (
    id: number | string,
    comment: string,
  ) => Promise<ApiResponse<unknown>>;
  expandedRowRender?: (record: T) => ReactNode;
}) {
  const { t } = useI18n();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [approving, setApproving] = useState<T | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [rejecting, setRejecting] = useState<T | null>(null);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(
    async (
      targetPage = 1,
      { isRefresh = false }: { isRefresh?: boolean } = {},
    ) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetcher({
          status: "PENDING_CEO",
          page: targetPage,
          page_size: PAGE_SIZE,
        });
        if (isApiError(res)) {
          setError(res.message || t("common.error.genericDetailed"));
          return;
        }
        const payload = res.data;
        const rows = Array.isArray(payload) ? payload : (payload?.items ?? []);
        const count = Array.isArray(payload)
          ? payload.length
          : (payload?.count ?? rows.length);
        setItems(rows);
        setTotal(count);
      } catch (err: any) {
        setError(err?.message || t("common.error.genericDetailed"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetcher, t],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const subjectLabel = (record: T) => record.employee_name || record.asset_code;

  const submitApprove = async () => {
    if (!approving) return;
    const row = approving;
    setProcessing(true);
    // Optimistic: close the modal and drop the row immediately; restore it on failure.
    setApproving(null);
    setApprovalNote("");
    setItems((current) => current.filter((item) => item.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    try {
      const res = await approve(
        row.id,
        approvalNote.trim() || DEFAULT_APPROVAL_NOTE,
      );
      if (isApiError(res)) {
        setItems((current) =>
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
      notification.success({ message: t("ceo.approvals.approveSuccess") });
      // Retain the immediate optimistic feedback, then reconcile the queue
      // and its server-owned count in case another decision happened too.
      await load(page);
    } catch {
      setItems((current) =>
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
    setItems((current) => current.filter((item) => item.id !== row.id));
    setTotal((current) => Math.max(0, current - 1));
    try {
      const res = await reject(row.id, reason);
      if (isApiError(res)) {
        setItems((current) =>
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
      notification.success({ message: t("ceo.approvals.rejectSuccess") });
      // Retain the immediate optimistic feedback, then reconcile the queue
      // and its server-owned count in case another decision happened too.
      await load(page);
    } catch {
      setItems((current) =>
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

  const columns: ColumnsType<T> = [
    {
      title: t("assets.assetCode"),
      key: "asset",
      render: (_, record) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "#0f172a" }}>
            {record.asset_code}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {record.asset_name}
          </div>
        </div>
      ),
    },
    {
      title: t("common.employee"),
      key: "employee",
      render: (_, record) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "#0f172a" }}>
            {record.employee_name || "—"}
          </div>
          {record.employee_email && (
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {record.employee_email}
            </div>
          )}
        </div>
      ),
    },
    {
      title: detailColumn.title,
      key: "detail",
      render: (_, record) => (
        <Typography.Paragraph
          style={{ marginBottom: 0, maxWidth: 360 }}
          ellipsis={{ rows: 2, tooltip: true }}
        >
          {detailColumn.render(record) || "—"}
        </Typography.Paragraph>
      ),
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
      title: t("common.actions"),
      key: "actions",
      width: isNarrow ? 200 : 210,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        <ApprovalActions
          subjectLabel={subjectLabel(record)}
          approveLoading={processing && approving?.id === record.id}
          disabled={processing}
          onApprove={() => {
            setApproving(record);
            setApprovalNote("");
          }}
          onReject={() => setRejecting(record)}
        />
      ),
    },
  ];

  return (
    <>
      <ApprovalQueuePage
        title={title}
        subtitle={subtitle}
        pendingCount={total}
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        emptyTitle={emptyTitle}
        emptyDescription={t("ceo.approvals.emptyDescription")}
        onRetry={() => load(1)}
        onRefresh={() => load(page, { isRefresh: true })}
        refreshing={refreshing}
      >
        <Table
          rowKey="id"
          dataSource={items}
          columns={columns}
          scroll={{ x: 900 }}
          expandable={expandedRowRender ? { expandedRowRender } : undefined}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            hideOnSinglePage: true,
            style: { paddingInline: 16 },
            onChange: (nextPage) => setPage(nextPage),
          }}
        />
      </ApprovalQueuePage>

      <Modal
        open={Boolean(approving)}
        title={t("ceo.approvals.approveTitle")}
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
          setApprovalNote("");
        }}
        closable={!processing}
        maskClosable={!processing}
        destroyOnHidden
      >
        {approving && (
          <>
            <Typography.Paragraph strong style={{ marginBottom: 12 }}>
              {approving.asset_code} — {subjectLabel(approving)}
            </Typography.Paragraph>
            <Typography.Text
              type="secondary"
              style={{ display: "block", marginBottom: 8 }}
            >
              {t("ceo.approvals.approveNoteLabel")}
            </Typography.Text>
            <Input.TextArea
              rows={3}
              autoFocus
              value={approvalNote}
              maxLength={500}
              disabled={processing}
              placeholder={t("ceo.approvals.approveNotePlaceholder")}
              aria-label={t("ceo.approvals.approveNoteLabel")}
              onChange={(event) => setApprovalNote(event.target.value)}
            />
          </>
        )}
      </Modal>

      <RejectReasonModal
        open={Boolean(rejecting)}
        title={rejectTitle}
        subject={
          rejecting
            ? `${rejecting.asset_code} — ${subjectLabel(rejecting)}`
            : undefined
        }
        loading={processing}
        onCancel={() => setRejecting(null)}
        onSubmit={submitReject}
      />
    </>
  );
}
