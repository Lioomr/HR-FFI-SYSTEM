import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  notification,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import PageHeader from "../../../components/ui/PageHeader";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import { useI18n } from "../../../i18n/useI18n";
import { isApiError } from "../../../services/api/apiTypes";
import {
  CANCELLATION_KINDS,
  confirmCancellationRequest,
  declineCancellationRequest,
  listCancellationRequests,
  type CancellationKind,
  type CancellationRequestItem,
  type CancellationStatus,
} from "../../../services/api/cancellationRequestsApi";
import { getHttpStatus } from "../../../services/api/httpErrors";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";
import { getFieldApiError } from "../../../utils/formErrors";
import { formatDateTime } from "../../../utils/dateTime";

type TabStatus = Extract<
  CancellationStatus,
  "pending" | "confirmed" | "declined"
>;
const TABS: TabStatus[] = ["pending", "confirmed", "declined"];
const PAGE_SIZE = 20;
const STATUS_COLOR: Record<CancellationStatus, string> = {
  pending: "orange",
  confirmed: "green",
  declined: "red",
  withdrawn: "default",
};
const TARGET = { minHeight: 44 } as const;

type PendingAction = {
  item: CancellationRequestItem;
  type: "confirm" | "decline";
};

export default function CancellationRequestsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<TabStatus>("pending");
  const [kind, setKind] = useState<CancellationKind | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CancellationRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await listCancellationRequests({
        status,
        kind,
        page,
        page_size: PAGE_SIZE,
      });
      if (seq !== requestSeq.current) return;
      if (isApiError(response)) {
        setLoadError(response.message || t("cancellationRequests.loadFailed"));
        return;
      }
      setItems(response.data.items ?? []);
      setTotal(response.data.count ?? 0);
    } catch (error: unknown) {
      if (seq !== requestSeq.current) return;
      setLoadError(
        getDetailedHttpErrorMessage(
          t,
          error,
          "cancellationRequests.loadFailed",
        ),
      );
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [status, kind, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAction = (
    item: CancellationRequestItem,
    type: PendingAction["type"],
  ) => {
    setAction({ item, type });
    setComment("");
    setCommentError(null);
  };

  const closeAction = () => {
    if (inFlight.current) return;
    setAction(null);
    setComment("");
    setCommentError(null);
  };

  const submit = async () => {
    if (!action || inFlight.current) return;
    const trimmed = comment.trim();
    if (action.type === "decline" && !trimmed) {
      setCommentError(t("cancellationRequests.commentRequired"));
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setCommentError(null);
    try {
      const response =
        action.type === "confirm"
          ? await confirmCancellationRequest(
              action.item.id,
              trimmed || undefined,
            )
          : await declineCancellationRequest(action.item.id, trimmed);
      if (isApiError(response)) {
        const fieldMessage = getFieldApiError(response, "comment");
        if (fieldMessage) {
          setCommentError(fieldMessage);
          return;
        }
        notification.error({
          message: t("cancellationRequests.actionFailed"),
          description: response.message,
        });
        setAction(null);
        await load();
        return;
      }
      notification.success({
        message:
          action.type === "confirm"
            ? t("cancellationRequests.confirmSuccess")
            : t("cancellationRequests.declineSuccess"),
      });
      setAction(null);
      setComment("");
      await load();
    } catch (error: unknown) {
      const status422 = getHttpStatus(error) === 422;
      const fieldMessage = status422
        ? getFieldApiError(error, "comment")
        : undefined;
      if (fieldMessage) {
        setCommentError(fieldMessage);
      } else {
        notification.error({
          message: t("cancellationRequests.actionFailed"),
          description: getDetailedHttpErrorMessage(t, error),
        });
        setAction(null);
        // 404/422: the request is no longer pending, so show the fresh list.
        await load();
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<CancellationRequestItem> = [
    {
      title: t("cancellationRequests.col.employee"),
      dataIndex: "employee_name",
      key: "employee",
    },
    {
      title: t("cancellationRequests.col.kind"),
      dataIndex: "kind",
      key: "kind",
      render: (value: CancellationKind) =>
        t(`cancellationRequests.kind.${value}`, value),
    },
    {
      title: t("cancellationRequests.col.request"),
      key: "request",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Link
            to={record.detail_path}
            aria-label={`${t("cancellationRequests.openRequest")}: ${
              record.reference_no || `#${record.request_id}`
            }`}
          >
            {record.reference_no || `#${record.request_id}`}
          </Link>
          <Typography.Text type="secondary">
            {record.request_title}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("cancellationRequests.col.reason"),
      dataIndex: "reason",
      key: "reason",
      render: (value: string) => (
        <Typography.Paragraph
          style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 360 }}
          ellipsis={{ rows: 3, expandable: true, symbol: "…" }}
        >
          {value}
        </Typography.Paragraph>
      ),
    },
    {
      title: t("cancellationRequests.col.requestedAt"),
      dataIndex: "requested_at",
      key: "requested_at",
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("cancellationRequests.col.decision"),
      key: "decision",
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Tag
            color={STATUS_COLOR[record.status]}
            style={{ marginInlineEnd: 0 }}
          >
            {t(`cancellationRequests.status.${record.status}`, record.status)}
          </Tag>
          {record.decided_at ? (
            <Typography.Text type="secondary">
              {formatDateTime(record.decided_at)}
              {record.decided_by_name
                ? ` ${t("cancellationRequests.decidedBy", { name: record.decided_by_name })}`
                : ""}
            </Typography.Text>
          ) : null}
          {record.decision_note ? (
            <Typography.Text>{record.decision_note}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: t("cancellationRequests.col.actions"),
      key: "actions",
      render: (_, record) => {
        if (record.status !== "pending") return null;
        if (record.can_decide === false) {
          return (
            <Typography.Text type="secondary">
              {t("cancellationRequests.ownRequest")}
            </Typography.Text>
          );
        }
        return (
          <Space wrap>
            <Button
              type="primary"
              style={TARGET}
              aria-label={`${t("cancellationRequests.confirm")}: ${record.employee_name}`}
              onClick={() => openAction(record, "confirm")}
            >
              {t("cancellationRequests.confirm")}
            </Button>
            <Button
              danger
              style={TARGET}
              aria-label={`${t("cancellationRequests.decline")}: ${record.employee_name}`}
              onClick={() => openAction(record, "decline")}
            >
              {t("cancellationRequests.decline")}
            </Button>
          </Space>
        );
      },
    },
  ];

  const isDecline = action?.type === "decline";

  return (
    <div>
      <PageHeader
        title={t("cancellationRequests.title")}
        subtitle={t("cancellationRequests.subtitle")}
      />
      <Space wrap size={12} style={{ marginBottom: 16 }}>
        <Segmented
          aria-label={t("cancellationRequests.title")}
          value={status}
          onChange={(value) => {
            setStatus(value as TabStatus);
            setPage(1);
          }}
          options={TABS.map((tab) => ({
            value: tab,
            label: t(`cancellationRequests.tab.${tab}`),
          }))}
        />
        <Select<CancellationKind>
          allowClear
          value={kind}
          placeholder={t("cancellationRequests.filter.allKinds")}
          aria-label={t("cancellationRequests.filter.kind")}
          style={{ minWidth: 220 }}
          onChange={(value) => {
            setKind(value);
            setPage(1);
          }}
          options={CANCELLATION_KINDS.map((value) => ({
            value,
            label: t(`cancellationRequests.kind.${value}`, value),
          }))}
        />
      </Space>
      {loadError ? (
        <Alert
          showIcon
          type="error"
          style={{ marginBottom: 16 }}
          message={t("cancellationRequests.loadFailed")}
          description={loadError}
          action={
            <Button style={TARGET} onClick={() => void load()}>
              {t("common.refresh")}
            </Button>
          }
        />
      ) : null}
      <ResponsiveTable<CancellationRequestItem>
        mobileCard={{
          titleKey: "employee",
          extraKey: "decision",
          actionsKey: "actions",
        }}
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        scroll={{ x: 900 }}
        locale={{ emptyText: t("cancellationRequests.empty") }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: (next) => setPage(next),
        }}
      />
      <Modal
        open={action !== null}
        title={
          isDecline
            ? t("cancellationRequests.declineTitle")
            : t("cancellationRequests.confirmTitle")
        }
        onOk={() => void submit()}
        onCancel={closeAction}
        okText={
          isDecline
            ? t("cancellationRequests.decline")
            : t("cancellationRequests.confirm")
        }
        cancelText={t("common.cancel")}
        okType={isDecline ? "danger" : "primary"}
        confirmLoading={submitting}
        cancelButtonProps={{ disabled: submitting, style: TARGET }}
        okButtonProps={{ style: TARGET }}
        closable={!submitting}
        maskClosable={!submitting}
        keyboard={!submitting}
        destroyOnClose
      >
        {action ? (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text strong>
              {action.item.employee_name} - {action.item.request_title}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {isDecline
                ? t("cancellationRequests.declineHint")
                : t("cancellationRequests.confirmHint")}
            </Typography.Paragraph>
            <Typography.Paragraph
              style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
            >
              {action.item.reason}
            </Typography.Paragraph>
            <label htmlFor="cancellation-decision-comment">
              {isDecline
                ? t("cancellationRequests.commentLabel")
                : t("cancellationRequests.commentOptional")}
            </label>
            <Input.TextArea
              id="cancellation-decision-comment"
              aria-label={
                isDecline
                  ? t("cancellationRequests.commentLabel")
                  : t("cancellationRequests.commentOptional")
              }
              aria-required={isDecline}
              rows={3}
              maxLength={1000}
              showCount
              value={comment}
              disabled={submitting}
              status={commentError ? "error" : undefined}
              onChange={(event) => {
                setComment(event.target.value);
                if (commentError) setCommentError(null);
              }}
            />
            {commentError ? (
              <Typography.Text type="danger" role="alert">
                {commentError}
              </Typography.Text>
            ) : null}
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
