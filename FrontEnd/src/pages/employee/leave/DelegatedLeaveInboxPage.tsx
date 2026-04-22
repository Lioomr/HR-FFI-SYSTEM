import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Card, Grid, Input, Modal, Space, Table, Tag, Tooltip, Typography, notification } from "antd";
import type { ColumnsType } from "antd/es/table";

import LeaveApprovalMap from "../../../components/leaves/LeaveApprovalMap";
import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import { isApiError } from "../../../services/api/apiTypes";
import {
  approveDelegatedLeaveRequest,
  getMyDelegatedLeaveRequests,
  rejectDelegatedLeaveRequest,
  type LeaveRequest,
} from "../../../services/api/leaveApi";
import { getDetailedApiMessage, getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

const { Text } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

function statusColor(status?: string) {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "pending_delegate":
      return "gold";
    case "pending_hr":
      return "purple";
    case "pending_ceo":
      return "volcano";
    case "cancelled":
      return "default";
    default:
      return "blue";
  }
}

export default function DelegatedLeaveInboxPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [data, setData] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyDelegatedLeaveRequests({ page, page_size: pageSize });
      if (isApiError(res)) {
        notification.error({ message: t("common.error"), description: getDetailedApiMessage(t, res.message) });
        return;
      }
      setData(res.data.items || []);
      setTotal(res.data.count || 0);
    } catch (err: unknown) {
      notification.error({ message: t("common.error"), description: getDetailedHttpErrorMessage(t, err) });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const statusLabel = (status?: string) => {
    const key = `leave.status.${(status || "").toLowerCase()}`;
    const translated = t(key);
    return translated === key ? (status || "").replace(/_/g, " ") : translated;
  };

  const translateLeaveType = (name?: string) => {
    if (!name) return "-";
    const key = `leave.type.${name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "")}`;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  const canAct = (record: LeaveRequest) =>
    record.status === "pending_delegate" &&
    record.workflow?.current_stage === "delegate" &&
    record.workflow?.can_approve;

  const handleApprove = async (record: LeaveRequest) => {
    setActionId(record.id);
    try {
      const res = await approveDelegatedLeaveRequest(record.id);
      if (isApiError(res)) {
        notification.error({ message: t("leave.approveFail"), description: getDetailedApiMessage(t, res.message) });
        return;
      }
      notification.success({ message: t("leave.approveSuccess") });
      loadData();
    } catch (err: unknown) {
      notification.error({ message: t("common.error"), description: getDetailedHttpErrorMessage(t, err) });
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectionReason.trim()) {
      notification.error({ message: t("leave.reasonReqTitle"), description: t("leave.reasonReqDesc") });
      return;
    }
    setActionId(rejectTarget.id);
    try {
      const res = await rejectDelegatedLeaveRequest(rejectTarget.id, rejectionReason);
      if (isApiError(res)) {
        notification.error({ message: t("leave.rejectFail"), description: getDetailedApiMessage(t, res.message) });
        return;
      }
      notification.success({ message: t("leave.rejectSuccess") });
      setRejectTarget(null);
      setRejectionReason("");
      loadData();
    } catch (err: unknown) {
      notification.error({ message: t("common.error"), description: getDetailedHttpErrorMessage(t, err) });
    } finally {
      setActionId(null);
    }
  };

  const columns: ColumnsType<LeaveRequest> = [
    {
      title: t("common.employee"),
      key: "employee",
      width: 190,
      render: (_, record) => record.employee?.full_name || record.employee?.email || "-",
    },
    {
      title: t("leave.type"),
      key: "leave_type",
      width: 170,
      render: (_, record) => translateLeaveType(record.leave_type?.name),
    },
    {
      title: t("leave.period"),
      key: "period",
      width: 210,
      render: (_, record) => `${record.start_date} ${t("common.to")} ${record.end_date}`,
    },
    {
      title: t("leave.days"),
      dataIndex: "days",
      key: "days",
      align: "center",
      width: 90,
      responsive: ["md"],
    },
    {
      title: t("leave.delegationNote"),
      dataIndex: "delegation_note",
      key: "delegation_note",
      ellipsis: true,
      responsive: ["lg"],
      render: (value) => value || "-",
    },
    {
      title: t("common.status"),
      dataIndex: "status",
      key: "status",
      width: 150,
      render: (status) => <Tag color={statusColor(status)}>{statusLabel(status)}</Tag>,
    },
    {
      title: t("common.actions"),
      key: "actions",
      align: "center",
      fixed: screens.lg ? "right" : undefined,
      width: isMobile ? 150 : 210,
      render: (_, record) => (
        <Space size={8} wrap>
          <Tooltip title={t("common.details")}>
            <Button
              icon={<EyeOutlined />}
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/employee/delegated-approvals/${record.id}`);
              }}
            />
          </Tooltip>
          {canAct(record) ? (
            <>
              <Tooltip title={t("common.reject")}>
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  size="small"
                  loading={actionId === record.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRejectTarget(record);
                  }}
                />
              </Tooltip>
              <Tooltip title={t("common.approve")}>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  size="small"
                  loading={actionId === record.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleApprove(record);
                  }}
                />
              </Tooltip>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  const pendingCount = data.filter((item) => canAct(item)).length;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <PageHeader
        title={t("leave.delegatedInboxTitle", "Delegated Approval Inbox")}
        subtitle={t("leave.delegatedInboxSubtitle", "Leave requests assigned to you for coverage confirmation.")}
        tags={pendingCount > 0 ? <Tag color="gold">{t("leave.delegatedPendingCount", { count: pendingCount }, `${pendingCount} pending`)}</Tag> : undefined}
        actions={
          <Button icon={<SyncOutlined />} onClick={loadData} loading={loading} block={isMobile}>
            {t("common.refresh", "Refresh")}
          </Button>
        }
      />

      <Card style={{ borderRadius: 16 }}>
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          size={isMobile ? "small" : "middle"}
          scroll={{ x: 900 }}
          locale={{
            emptyText: (
              <Text type="secondary">
                {t("leave.delegatedInboxEmpty", "No delegated leave approvals assigned to you.")}
              </Text>
            ),
          }}
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
            expandedRowRender: (record) => <LeaveApprovalMap request={record} t={t} />,
            rowExpandable: () => true,
          }}
          onRow={(record) => ({
            onClick: () => navigate(`/employee/delegated-approvals/${record.id}`),
            style: { cursor: "pointer" },
          })}
        />
      </Card>

      <Modal
        title={t("leave.rejectTitle")}
        open={Boolean(rejectTarget)}
        onOk={handleReject}
        onCancel={() => {
          setRejectTarget(null);
          setRejectionReason("");
        }}
        okText={t("leave.rejectBtn")}
        okType="danger"
        confirmLoading={Boolean(rejectTarget && actionId === rejectTarget.id)}
      >
        <TextArea
          rows={4}
          placeholder={t("leave.rejectPlaceholder")}
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
        />
      </Modal>
    </div>
  );
}
