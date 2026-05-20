import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal, Space, Table, Tooltip, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CloseCircleOutlined,
  PlusOutlined,
  SendOutlined,
} from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import EmptyState from "../../../components/ui/EmptyState";
import AttendanceMaintenanceBanner from "../../../components/attendance/AttendanceMaintenanceBanner";
import AttendanceCorrectionStatusTag from "../../../components/attendance/AttendanceCorrectionStatusTag";
import AttendanceCorrectionFormModal from "../../../components/attendance/AttendanceCorrectionFormModal";
import AttendanceCorrectionDetails from "../../../components/attendance/AttendanceCorrectionDetails";
import {
  cancelAttendanceCorrectionRequest,
  listAttendanceCorrectionRequests,
  submitAttendanceCorrectionRequest,
  type AttendanceCorrectionRequest,
} from "../../../services/api/attendanceCorrectionsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { useI18n } from "../../../i18n/useI18n";
import { formatDateOnly, formatTimeOnly } from "../../../utils/dateTime";
import {
  getDetailedApiMessage,
  getDetailedHttpErrorMessage,
} from "../../../services/api/userErrorMessages";

const { confirm } = Modal;

export default function AttendanceCorrectionRequestsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<AttendanceCorrectionRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await listAttendanceCorrectionRequests({ page, page_size: pageSize });
      if (isApiError(res)) {
        setErrorMessage(getDetailedApiMessage(t, res.message));
        return;
      }
      setItems(res.data.results || []);
      setTotal(res.data.count || 0);
    } catch (err: unknown) {
      setErrorMessage(getDetailedHttpErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onSubmitDraft = useCallback(
    (id: number) => {
      confirm({
        title: t("attendanceCorrections.actions.submitTitle", "Submit correction request"),
        content: t(
          "attendanceCorrections.actions.submitConfirm",
          "This will send the request for approval. Continue?"
        ),
        okText: t("attendanceCorrections.form.submit", "Submit request"),
        cancelText: t("common.cancel", "Cancel"),
        onOk: async () => {
          setActionId(id);
          try {
            const res = await submitAttendanceCorrectionRequest(id);
            if (isApiError(res)) {
              notification.error({
                message: t("common.error", "Error"),
                description: getDetailedApiMessage(t, res.message),
              });
            } else {
              notification.success({
                message: t("attendanceCorrections.success.submitted", "Correction request submitted."),
              });
              load();
            }
          } catch (err: unknown) {
            notification.error({
              message: t("common.error", "Error"),
              description: getDetailedHttpErrorMessage(t, err),
            });
          } finally {
            setActionId(null);
          }
        },
      });
    },
    [load, t]
  );

  const onCancel = useCallback(
    (id: number) => {
      confirm({
        title: t("attendanceCorrections.actions.cancelTitle", "Cancel correction request"),
        content: t(
          "attendanceCorrections.actions.cancelConfirm",
          "Are you sure you want to cancel this request?"
        ),
        okText: t("common.confirm", "Confirm"),
        okType: "danger",
        cancelText: t("common.close", "Close"),
        onOk: async () => {
          setActionId(id);
          try {
            const res = await cancelAttendanceCorrectionRequest(id);
            if (isApiError(res)) {
              notification.error({
                message: t("common.error", "Error"),
                description: getDetailedApiMessage(t, res.message),
              });
            } else {
              notification.success({
                message: t("attendanceCorrections.success.cancelled", "Correction request cancelled."),
              });
              load();
            }
          } catch (err: unknown) {
            notification.error({
              message: t("common.error", "Error"),
              description: getDetailedHttpErrorMessage(t, err),
            });
          } finally {
            setActionId(null);
          }
        },
      });
    },
    [load, t]
  );

  const columns: ColumnsType<AttendanceCorrectionRequest> = useMemo(
    () => [
      {
        title: t("common.date", "Date"),
        key: "date",
        dataIndex: "date",
        width: 130,
        render: (value: string) => formatDateOnly(value, "—"),
      },
      {
        title: t("attendanceCorrections.fields.requestedCheckIn", "Requested check-in"),
        key: "in",
        dataIndex: "requested_check_in_at",
        width: 150,
        render: (value: string | null) => formatTimeOnly(value, "—"),
      },
      {
        title: t("attendanceCorrections.fields.requestedCheckOut", "Requested check-out"),
        key: "out",
        dataIndex: "requested_check_out_at",
        width: 160,
        render: (value: string | null) => formatTimeOnly(value, "—"),
      },
      {
        title: t("attendanceCorrections.fields.requestedStatus", "Requested status"),
        key: "rstatus",
        dataIndex: "requested_status",
        width: 140,
        render: (value: string) =>
          value ? t(`attendanceCorrections.statusValue.${value}`, value) : "—",
      },
      {
        title: t("common.reason", "Reason"),
        key: "reason",
        dataIndex: "reason",
        ellipsis: { showTitle: false },
        render: (value: string) => (
          <Tooltip title={value || "—"}>
            <span>{value || "—"}</span>
          </Tooltip>
        ),
      },
      {
        title: t("common.status", "Status"),
        key: "status",
        width: 150,
        render: (_: unknown, record) => <AttendanceCorrectionStatusTag status={record.status} />,
      },
      {
        title: t("common.actions", "Actions"),
        key: "actions",
        width: 240,
        fixed: "right",
        render: (_: unknown, record) => {
          const isDraft = record.status === "draft";
          const canCancel = record.workflow?.can_cancel || isDraft;
          return (
            <Space size={6}>
              {isDraft && (
                <Button
                  type="primary"
                  size="small"
                  icon={<SendOutlined />}
                  loading={actionId === record.id}
                  onClick={() => onSubmitDraft(record.id)}
                  style={{ borderRadius: 8 }}
                >
                  {t("attendanceCorrections.form.submit", "Submit")}
                </Button>
              )}
              {canCancel && (
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  loading={actionId === record.id}
                  onClick={() => onCancel(record.id)}
                  style={{ borderRadius: 8 }}
                >
                  {t("common.cancel", "Cancel")}
                </Button>
              )}
            </Space>
          );
        },
      },
    ],
    [t, actionId, onCancel, onSubmitDraft]
  );

  return (
    <div>
      <PageHeader
        title={t("attendanceCorrections.page.employeeTitle", "Attendance Corrections")}
        subtitle={t(
          "attendanceCorrections.page.employeeSubtitle",
          "Submit corrections for missing or incorrect attendance entries."
        )}
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            style={{ borderRadius: 10 }}
          >
            {t("attendanceCorrections.actions.create", "New correction request")}
          </Button>
        }
      />

      <AttendanceMaintenanceBanner />

      {loading && !items.length ? (
        <LoadingState lines={5} />
      ) : errorMessage ? (
        <ErrorState
          title={t("common.error", "Error")}
          description={errorMessage}
          onRetry={load}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("attendanceCorrections.empty.title", "No correction requests yet")}
          description={t(
            "attendanceCorrections.empty.employeeDescription",
            "Submit a correction request if your attendance for a day is missing or wrong."
          )}
          actionText={t("attendanceCorrections.actions.create", "New correction request")}
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div
          style={{
            background: "white",
            borderRadius: 14,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            overflow: "hidden",
          }}
        >
          <Table<AttendanceCorrectionRequest>
            dataSource={items}
            columns={columns}
            rowKey="id"
            loading={loading}
            expandable={{
              expandedRowRender: (record) => <AttendanceCorrectionDetails request={record} />,
            }}
            scroll={{ x: 1100 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (totalCount) =>
                t("common.totalItems", { count: totalCount }, `${totalCount} items`),
              onChange: (next, size) => {
                setPage(next);
                if (size && size !== pageSize) setPageSize(size);
              },
            }}
          />
        </div>
      )}

      <AttendanceCorrectionFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => load()}
      />
    </div>
  );
}
