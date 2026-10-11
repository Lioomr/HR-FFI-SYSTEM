import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Grid, Tag, Tooltip, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EyeOutlined, FilePdfOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import { useI18n } from "../../../i18n/useI18n";
import {
  getMyLeaveRequests,
  getLeaveRequestPdfBlob,
  type LeaveRequest,
} from "../../../services/api/leaveApi";
import LeaveApprovalMap from "../../../components/leaves/LeaveApprovalMap";
import { isApiError } from "../../../services/api/apiTypes";
import { getHttpStatus } from "../../../services/api/httpErrors";
import {
  getDetailedApiMessage,
  getDetailedHttpErrorMessage,
} from "../../../services/api/userErrorMessages";
import { downloadBlob } from "../../../utils/download";

const { useBreakpoint } = Grid;

// Employees cannot cancel their own leave requests; HR cancels them on request.
export default function MyLeaveRequestsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyLeaveRequests({ page, page_size: pageSize });
      if (isApiError(res)) {
        notification.error({
          message: t("common.error"),
          description: getDetailedApiMessage(t, res.message),
        });
      } else {
        setData(res.data.items || []);
        setTotal(res.data.count || 0);
      }
    } catch (err: unknown) {
      notification.error({
        message: t("common.error"),
        description: getDetailedHttpErrorMessage(t, err),
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handlePdfDownload = async (record: LeaveRequest) => {
    setPdfLoadingId(record.id);
    try {
      const blob = await getLeaveRequestPdfBlob(record.id, true);
      downloadBlob(blob, `leave_request_${record.id}.pdf`);
    } catch (err: unknown) {
      const description =
        getHttpStatus(err) === 403
          ? t("leave.pdfDownloadForbidden")
          : getDetailedHttpErrorMessage(t, err);
      notification.error({ message: t("common.error"), description });
    } finally {
      setPdfLoadingId(null);
    }
  };

  const getStatusColor = (status: string) => {
    const s = status?.toLowerCase();
    switch (s) {
      case "approved":
        return "green";
      case "rejected":
        return "red";
      case "submitted":
        return "blue";
      case "pending_manager":
        return "orange";
      case "pending_hr":
        return "purple";
      case "pending":
        return "gold";
      case "cancelled":
        return "default";
      default:
        return "default";
    }
  };

  // Translate a leave type name coming from the API
  const translateLeaveType = (name?: string): string => {
    if (!name) return t("leave.title");
    const key = `leave.type.${name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z_]/g, "")}`;
    const translated = t(key);
    // If no translation key exists, fall back to original name
    return translated === key ? name : translated;
  };

  const columns: ColumnsType<LeaveRequest> = [
    {
      title: t("permissionRequests.list.reference"),
      key: "reference_no",
      render: (_, record) => record.reference_no || `#${record.id}`,
      width: 160,
    },
    {
      title: t("leave.type"),
      key: "leave_type",
      width: 160,
      render: (_, record) => translateLeaveType(record.leave_type?.name),
    },
    {
      title: t("leave.startDate"),
      dataIndex: "start_date",
      key: "start_date",
      width: 120,
      responsive: ["sm"],
    },
    {
      title: t("leave.endDate"),
      dataIndex: "end_date",
      key: "end_date",
      width: 120,
      responsive: ["sm"],
    },
    {
      title: t("leave.days"),
      dataIndex: "days",
      key: "days",
      align: "center",
      width: 72,
      responsive: ["md"],
    },
    {
      title: t("leave.reason"),
      dataIndex: "reason",
      key: "reason",
      ellipsis: true,
      responsive: ["lg"],
    },
    {
      title: t("leave.rejectionReason"),
      key: "rejection_reason",
      responsive: ["xl"],
      render: (_, record) => {
        const isRejected = (record.status || "").toLowerCase() === "rejected";
        if (!isRejected) return "-";
        return (
          record.ceo_decision_note ||
          record.hr_decision_note ||
          record.manager_decision_note ||
          record.rejection_reason ||
          "-"
        );
      },
      ellipsis: true,
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 180,
      render: (status, record) => {
        const statusKey = `leave.status.${status?.toLowerCase()}`;
        const translated = t(statusKey);
        const display =
          translated === statusKey
            ? (
                status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase()
              ).replace(/_/g, " ")
            : translated;
        return (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Tag color={getStatusColor(status)}>{display}</Tag>
            {record.source === "hr_manual" && (
              <Tag color="cyan">{t("leave.manual.badge")}</Tag>
            )}
          </div>
        );
      },
    },
    {
      title: t("common.actions"),
      key: "actions",
      align: "center",
      width: 112,
      fixed: screens.lg ? "right" : undefined,
      render: (_, record) => {
        return (
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Tooltip title={t("common.details")}>
              <Button
                aria-label={t("common.details")}
                icon={<EyeOutlined />}
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/employee/leave/requests/${record.id}`);
                }}
              />
            </Tooltip>
            <Tooltip title={t("leave.downloadRequestPdf")}>
              <Button
                aria-label={t("common.download")}
                icon={<FilePdfOutlined />}
                size="small"
                loading={pdfLoadingId === record.id}
                onClick={(event) => {
                  event.stopPropagation();
                  handlePdfDownload(record);
                }}
              />
            </Tooltip>
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      <PageHeader
        title={t("leave.requestsTitle")}
        subtitle={t("leave.requestsSubtitle")}
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate("/employee/leave/request")}
            block={isMobile}
          >
            {t("leave.newRequest")}
          </Button>
        }
      />

      <Card style={{ borderRadius: 16 }}>
        <ResponsiveTable
          mobileCard={{
            titleKey: "leave_type",
            extraKey: "status",
            expandLabel: t("leave.approvalMap.title"),
          }}
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          size={isMobile ? "small" : "middle"}
          tableLayout="fixed"
          scroll={{ x: screens.xl ? 1280 : screens.lg ? 1100 : 900 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p, ps) => {
              setPage(p);
              if (ps !== pageSize) setPageSize(ps);
            },
          }}
          expandable={{
            expandedRowRender: (record) => (
              <LeaveApprovalMap request={record} t={t} />
            ),
            rowExpandable: () => true,
          }}
          onRow={(record) => ({
            onClick: () => navigate(`/employee/leave/requests/${record.id}`),
            style: { cursor: "pointer" },
          })}
        />
      </Card>
    </div>
  );
}
