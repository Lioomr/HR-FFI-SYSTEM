import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Select, Space, Table, Tooltip, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckOutlined, CloseOutlined, UserOutlined } from "@ant-design/icons";

import LoadingState from "../ui/LoadingState";
import ErrorState from "../ui/ErrorState";
import EmptyState from "../ui/EmptyState";
import AttendanceCorrectionStatusTag from "./AttendanceCorrectionStatusTag";
import AttendanceCorrectionDetails from "./AttendanceCorrectionDetails";
import AttendanceCorrectionRejectModal from "./AttendanceCorrectionRejectModal";
import {
  approveAttendanceCorrectionRequest,
  listAttendanceCorrectionRequests,
  rejectAttendanceCorrectionRequest,
  type AttendanceCorrectionRequest,
  type AttendanceCorrectionStatus,
  type ListAttendanceCorrectionsParams,
} from "../../services/api/attendanceCorrectionsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";
import { formatDateOnly, formatTimeOnly } from "../../utils/dateTime";
import {
  getDetailedApiMessage,
  getDetailedHttpErrorMessage,
} from "../../services/api/userErrorMessages";

type Props = {
  defaultStatus?: AttendanceCorrectionStatus;
  approverRole: "manager" | "hr";
  statusOptions?: AttendanceCorrectionStatus[];
  successMessage?: string;
};

const ALL_STATUSES: AttendanceCorrectionStatus[] = [
  "draft",
  "pending_manager",
  "pending_hr",
  "approved",
  "rejected",
  "cancelled",
];

export default function AttendanceCorrectionsApproverTable({
  defaultStatus,
  approverRole,
  statusOptions = ALL_STATUSES,
  successMessage,
}: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<AttendanceCorrectionRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<AttendanceCorrectionStatus | undefined>(defaultStatus);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AttendanceCorrectionRequest | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const params: ListAttendanceCorrectionsParams = {
        page,
        page_size: pageSize,
        status: statusFilter,
      };
      const res = await listAttendanceCorrectionRequests(params);
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
  }, [page, pageSize, statusFilter, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = useCallback(
    async (record: AttendanceCorrectionRequest) => {
      setActionId(record.id);
      try {
        const res = await approveAttendanceCorrectionRequest(record.id);
        if (isApiError(res)) {
          notification.error({
            message: t("common.error", "Error"),
            description: getDetailedApiMessage(t, res.message),
          });
          return;
        }
        notification.success({
          message:
            successMessage ||
            (approverRole === "hr"
              ? t("attendanceCorrections.success.applied", "Correction applied.")
              : t("attendanceCorrections.success.approved", "Correction approved.")),
        });
        load();
      } catch (err: unknown) {
        notification.error({
          message: t("common.error", "Error"),
          description: getDetailedHttpErrorMessage(t, err),
        });
      } finally {
        setActionId(null);
      }
    },
    [approverRole, load, successMessage, t]
  );

  const handleReject = async (notes: string) => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await rejectAttendanceCorrectionRequest(rejectTarget.id, { notes });
      if (isApiError(res)) {
        notification.error({
          message: t("common.error", "Error"),
          description: getDetailedApiMessage(t, res.message),
        });
        return;
      }
      notification.success({
        message: t("attendanceCorrections.success.rejected", "Correction request rejected."),
      });
      setRejectTarget(null);
      load();
    } catch (err: unknown) {
      notification.error({
        message: t("common.error", "Error"),
        description: getDetailedHttpErrorMessage(t, err),
      });
    } finally {
      setRejecting(false);
    }
  };

  const columns: ColumnsType<AttendanceCorrectionRequest> = useMemo(
    () => [
      {
        title: t("hr.dashboard.employee", "Employee"),
        key: "employee",
        render: (_: unknown, record) => {
          const name = record.employee_name || record.employee_email || "—";
          return (
            <Space size={10}>
              <Avatar
                size={32}
                icon={<UserOutlined />}
                style={{ backgroundColor: "#fff2e8", color: "#fa8c16" }}
              />
              <div>
                <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{name}</div>
                <div style={{ fontSize: 12, color: "#8c8c8c", lineHeight: 1.2 }}>
                  {record.employee_email || "—"}
                </div>
              </div>
            </Space>
          );
        },
      },
      {
        title: t("common.date", "Date"),
        key: "date",
        dataIndex: "date",
        width: 130,
        render: (value: string) => formatDateOnly(value, "—"),
      },
      {
        title: t("attendanceCorrections.fields.requested", "Requested"),
        key: "requested",
        render: (_: unknown, record) => {
          const inAt = formatTimeOnly(record.requested_check_in_at, "—");
          const outAt = formatTimeOnly(record.requested_check_out_at, "—");
          const statusValue = record.requested_status
            ? t(`attendanceCorrections.statusValue.${record.requested_status}`, record.requested_status)
            : "—";
          return (
            <div style={{ fontSize: 13, color: "#0f172a" }}>
              <div>
                <span style={{ color: "#64748b" }}>{t("attendanceCorrections.fields.checkInShort", "In")}:</span>{" "}
                {inAt} ·{" "}
                <span style={{ color: "#64748b" }}>{t("attendanceCorrections.fields.checkOutShort", "Out")}:</span>{" "}
                {outAt}
              </div>
              <div style={{ color: "#64748b", fontSize: 12 }}>{statusValue}</div>
            </div>
          );
        },
      },
      {
        title: t("attendanceCorrections.fields.current", "Current"),
        key: "current",
        render: (_: unknown, record) => {
          const inAt = formatTimeOnly(record.current_check_in_at, "—");
          const outAt = formatTimeOnly(record.current_check_out_at, "—");
          const statusValue = record.current_status
            ? t(`attendanceCorrections.statusValue.${String(record.current_status).toUpperCase()}`, String(record.current_status))
            : "—";
          return (
            <div style={{ fontSize: 13, color: "#0f172a" }}>
              <div>
                <span style={{ color: "#64748b" }}>{t("attendanceCorrections.fields.checkInShort", "In")}:</span>{" "}
                {inAt} ·{" "}
                <span style={{ color: "#64748b" }}>{t("attendanceCorrections.fields.checkOutShort", "Out")}:</span>{" "}
                {outAt}
              </div>
              <div style={{ color: "#64748b", fontSize: 12 }}>{statusValue}</div>
            </div>
          );
        },
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
        width: 220,
        fixed: "right",
        render: (_: unknown, record) => {
          const canApprove = Boolean(record.workflow?.can_approve);
          const canReject = Boolean(record.workflow?.can_reject);
          if (!canApprove && !canReject) {
            return <span style={{ color: "#94a3b8" }}>—</span>;
          }
          return (
            <Space size={6}>
              {canApprove && (
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  loading={actionId === record.id}
                  onClick={() => handleApprove(record)}
                  style={{ borderRadius: 8 }}
                >
                  {t("common.approve", "Approve")}
                </Button>
              )}
              {canReject && (
                <Button
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => setRejectTarget(record)}
                  style={{ borderRadius: 8 }}
                >
                  {t("common.reject", "Reject")}
                </Button>
              )}
            </Space>
          );
        },
      },
    ],
    [t, actionId, handleApprove]
  );

  const statusSelectOptions = statusOptions.map((s) => ({
    value: s,
    label: t(`attendanceCorrections.status.${toCamel(s)}`, s),
  }));

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          placeholder={t("common.status", "Status")}
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value);
            setPage(1);
          }}
          options={statusSelectOptions}
          style={{ minWidth: 200 }}
        />
      </Space>

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
            "attendanceCorrections.empty.approverDescription",
            "No attendance correction requests match the current filter."
          )}
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
            scroll={{ x: 1200 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (next, size) => {
                setPage(next);
                if (size && size !== pageSize) setPageSize(size);
              },
            }}
          />
        </div>
      )}

      <AttendanceCorrectionRejectModal
        open={Boolean(rejectTarget)}
        onCancel={() => setRejectTarget(null)}
        onConfirm={handleReject}
        loading={rejecting}
      />
    </div>
  );
}

function toCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}
