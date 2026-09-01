import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Grid,
  Modal,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  EyeOutlined,
  FilePdfOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import StartingWorkStatusTag from "../../../components/hr/StartingWorkStatusTag";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  isConflict,
  isForbidden,
} from "../../../services/api/httpErrors";
import { triggerBlobDownload } from "../../../services/api/downloads";
import {
  acknowledgmentPdfFilename,
  approveStartingWorkAcknowledgment,
  downloadStartingWorkAcknowledgmentPdf,
  listStartingWorkAcknowledgments,
  type StartingWorkAcknowledgment,
  type StartingWorkAcknowledgmentStatus,
} from "../../../services/api/startingWorkAcknowledgmentsApi";
import { useI18n } from "../../../i18n/useI18n";
import { formatDateOnly, formatDateTimeShort } from "../../../utils/dateTime";

const { Text } = Typography;
const { useBreakpoint } = Grid;

const PAGE_SIZE = 25;

/**
 * HR opens this inbox to clear the queue, so the pending tab is the landing
 * state; the other two are there to look decisions back up.
 */
const STATUS_FILTERS: StartingWorkAcknowledgmentStatus[] = [
  "pending_hr",
  "approved",
  "rejected",
];

export const DEFAULT_STATUS_FILTER: StartingWorkAcknowledgmentStatus =
  "pending_hr";

export default function StartingWorkAcknowledgmentsListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();

  const [statusFilter, setStatusFilter] =
    useState<StartingWorkAcknowledgmentStatus>(DEFAULT_STATUS_FILTER);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<StartingWorkAcknowledgment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await listStartingWorkAcknowledgments({
          page,
          page_size: PAGE_SIZE,
          status: statusFilter,
        });
        if (isApiError(response)) {
          setError(response.message || t("startingWork.loadFailed"));
          return;
        }
        // A misrouted request (proxy serving the SPA shell, a gateway error
        // page) resolves without throwing but carries no envelope. Fail into
        // the translated error state rather than letting a raw TypeError from
        // the destructure reach the user.
        const records = response.data?.items;
        if (!Array.isArray(records)) {
          setError(t("startingWork.loadFailed"));
          return;
        }
        setItems(records);
        setTotal(
          typeof response.data.count === "number"
            ? response.data.count
            : records.length,
        );
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError((err as Error)?.message || t("startingWork.loadFailed"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, statusFilter, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const statusOptions = useMemo(
    () =>
      STATUS_FILTERS.map((value) => ({
        label: t(`startingWork.status.${value}`),
        value,
      })),
    [t],
  );

  /**
   * Surfaces what the API said, and treats a 409 as a stale view: another HR
   * user may have decided the acknowledgement between this list loading and
   * the click, so reloading shows the real state.
   */
  const reportActionError = useCallback(
    (err: unknown, fallbackKey: string): string => {
      const detail = getHttpErrorMessage(err) || t(fallbackKey);
      if (isConflict(err)) void load({ isRefresh: true });
      return detail;
    },
    [load, t],
  );

  const handleApprove = useCallback(
    (record: StartingWorkAcknowledgment) => {
      modal.confirm({
        title: t("startingWork.approve.confirmTitle"),
        content: t("startingWork.approvalAfterRejectionExplanation"),
        okText: t("startingWork.action.approve"),
        cancelText: t("common.cancel"),
        onOk: async () => {
          setBusyId(record.id);
          try {
            const response = await approveStartingWorkAcknowledgment(record.id);
            if (isApiError(response)) {
              messageApi.error(
                response.message || t("startingWork.approve.failed"),
              );
              return;
            }
            messageApi.success(
              response.message || t("startingWork.approve.success"),
            );
            await load({ isRefresh: true });
          } catch (err: unknown) {
            messageApi.error(
              reportActionError(err, "startingWork.approve.failed"),
            );
          } finally {
            setBusyId(null);
          }
        },
      });
    },
    [modal, messageApi, t, load, reportActionError],
  );

  const handleDownload = useCallback(
    async (record: StartingWorkAcknowledgment) => {
      setBusyId(record.id);
      try {
        const blob = await downloadStartingWorkAcknowledgmentPdf(record);
        triggerBlobDownload(blob, acknowledgmentPdfFilename(record));
        messageApi.success(t("startingWork.pdf.success"));
      } catch (err: unknown) {
        messageApi.error(reportActionError(err, "startingWork.pdf.failed"));
      } finally {
        setBusyId(null);
      }
    },
    [messageApi, t, reportActionError],
  );

  const columns: ColumnsType<StartingWorkAcknowledgment> = [
    {
      title: t("startingWork.col.employee"),
      key: "employee",
      render: (_, record) => (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text strong style={{ color: "#0f172a" }}>
            {record.employee?.name || "—"}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.reference_number || "—"}
          </Text>
        </div>
      ),
    },
    {
      title: t("startingWork.col.employeeId"),
      key: "employee_id",
      width: 140,
      render: (_, record) => <Text>{record.employee?.employee_id || "—"}</Text>,
    },
    {
      title: t("startingWork.col.firstBiotimeDate"),
      dataIndex: "first_biotime_attendance_date",
      key: "first_biotime_attendance_date",
      width: 160,
      render: (value: string) => <Text>{formatDateOnly(value, "—")}</Text>,
    },
    {
      title: t("startingWork.col.status"),
      key: "status",
      width: 260,
      render: (_, record) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <StartingWorkStatusTag
            status={record.status}
            fallbackLabel={record.status_label}
          />
          {/* Pending is not merely "not decided yet": payroll is holding this
              first attendance day until HR clears it. */}
          {record.status === "pending_hr" && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("startingWork.pendingRowNote")}
            </Text>
          )}
          {record.status === "rejected" && record.rejection_reason && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {`${t("startingWork.field.rejectionReason")}: ${record.rejection_reason}`}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: t("startingWork.col.affectedAttendance"),
      dataIndex: "affected_attendance_count",
      key: "affected_attendance_count",
      width: 150,
      render: (value: number) => <Text strong>{value ?? 0}</Text>,
    },
    {
      title: t("startingWork.col.generatedAt"),
      dataIndex: "generated_at",
      key: "generated_at",
      width: 180,
      render: (value: string) => <Text>{formatDateTimeShort(value, "—")}</Text>,
    },
    {
      title: t("startingWork.col.actions"),
      key: "actions",
      width: 160,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        // The row itself opens the acknowledgement, so the action cell has to
        // keep its clicks to itself or every button would also navigate.
        <Space size={4} wrap onClick={(event) => event.stopPropagation()}>
          <Tooltip title={t("startingWork.action.view")}>
            <Button
              size="small"
              icon={<EyeOutlined aria-hidden />}
              aria-label={`${t("startingWork.action.view")}: ${record.employee?.name}`}
              onClick={() =>
                navigate(`/hr/starting-work-acknowledgments/${record.id}`)
              }
              style={{ borderRadius: 8 }}
            />
          </Tooltip>
          {record.actions?.can_download && (
            <Tooltip title={t("startingWork.action.download")}>
              <Button
                size="small"
                icon={<FilePdfOutlined aria-hidden />}
                loading={busyId === record.id}
                aria-label={`${t("startingWork.action.download")}: ${record.employee?.name}`}
                onClick={() => handleDownload(record)}
                style={{ borderRadius: 8 }}
              />
            </Tooltip>
          )}
          {/* Also the path back from a rejection: the backend re-opens
              can_approve once HR has corrected the attendance. */}
          {record.actions?.can_approve && (
            <Tooltip title={t("startingWork.action.approve")}>
              <Button
                size="small"
                type="primary"
                icon={<CheckCircleOutlined aria-hidden />}
                loading={busyId === record.id}
                aria-label={`${t("startingWork.action.approve")}: ${record.employee?.name}`}
                onClick={() => handleApprove(record)}
                style={{ borderRadius: 8 }}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  const isDefaultFilter = statusFilter === DEFAULT_STATUS_FILTER;

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
      {messageContext}
      {modalContext}

      <PageHeader
        title={t("startingWork.title")}
        subtitle={t("startingWork.subtitle")}
        tags={
          total > 0 ? (
            <Tag
              style={{ margin: 0, borderRadius: 999, fontWeight: 700 }}
              color="orange"
            >
              {t("startingWork.countTag", { count: String(total) })}
            </Tag>
          ) : undefined
        }
        actions={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            loading={refreshing}
            onClick={() => load({ isRefresh: true })}
            style={{ borderRadius: 10, minHeight: 40 }}
          >
            {t("startingWork.action.refresh")}
          </Button>
        }
      />

      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <Segmented
            aria-label={t("startingWork.filterStatus")}
            value={statusFilter}
            options={statusOptions}
            onChange={(value) => {
              setStatusFilter(value as StartingWorkAcknowledgmentStatus);
              setPage(1);
            }}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState title={t("loading.generic")} />
      ) : error ? (
        <ErrorState
          title={t("common.error")}
          description={error}
          onRetry={() => load()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            isDefaultFilter
              ? t("startingWork.empty.title")
              : t("startingWork.empty.filteredTitle")
          }
          description={
            isDefaultFilter
              ? t("startingWork.empty.description")
              : t("startingWork.empty.filteredDescription")
          }
        />
      ) : (
        <div
          style={{
            background: "white",
            borderRadius: 16,
            padding: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <Table<StartingWorkAcknowledgment>
            rowKey="id"
            columns={columns}
            dataSource={items}
            scroll={{ x: 1200 }}
            onRow={(record) => ({
              onClick: () =>
                navigate(`/hr/starting-work-acknowledgments/${record.id}`),
              style: { cursor: "pointer" },
            })}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              onChange: (nextPage) => setPage(nextPage),
            }}
          />
        </div>
      )}
    </div>
  );
}
