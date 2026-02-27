import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Modal, Table, Tag, Tooltip, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloseCircleOutlined, EyeOutlined, PlusOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { isApiError } from "../../../services/api/apiTypes";
import { cancelLoanRequest, getMyLoanRequests, type LoanRequest, type LoanStatus } from "../../../services/api/loanApi";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";
import { getDetailedApiMessage, getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

const { confirm } = Modal;

function statusColor(status: LoanStatus) {
  switch (status) {
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "pending_manager":
      return "orange";
    case "pending_hr":
      return "gold";
    case "pending_finance":
      return "gold";
    case "pending_cfo":
      return "purple";
    case "pending_ceo":
      return "volcano";
    case "pending_disbursement":
      return "geekblue";
    case "deducted":
      return "cyan";
    case "cancelled":
      return "default";
    default:
      return "blue";
  }
}

export default function MyLoanRequestsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LoanRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyLoanRequests({ page, page_size: pageSize });
      if (isApiError(res)) {
        notification.error({ message: t("loans.myRequests.failedLoad"), description: getDetailedApiMessage(t, res.message) });
      } else {
        setItems(res.data.items || []);
        setTotal(res.data.count || 0);
      }
    } catch (err: unknown) {
      notification.error({ message: t("loans.myRequests.failedLoad"), description: getDetailedHttpErrorMessage(t, err) });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function onCancel(id: number) {
    confirm({
      title: t("loans.myRequests.cancelTitle"),
      content: t("loans.myRequests.cancelConfirm"),
      okText: t("loans.myRequests.cancelBtn"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: async () => {
        setCancellingId(id);
        try {
          const res = await cancelLoanRequest(id);
          if (isApiError(res)) {
            notification.error({ message: t("loans.myRequests.cancelFailed"), description: getDetailedApiMessage(t, res.message) });
          } else {
            notification.success({ message: t("loans.myRequests.cancelSuccess") });
            loadData();
          }
        } catch (err: unknown) {
          notification.error({ message: t("loans.myRequests.cancelFailed"), description: getDetailedHttpErrorMessage(t, err) });
        } finally {
          setCancellingId(null);
        }
      },
    });
  }

  const columns: ColumnsType<LoanRequest> = [
    {
      title: t("loans.list.colAmount"),
      key: "requested_amount",
      render: (_, record) => <AmountWithSAR amount={record.requested_amount || 0} />,
    },
    {
      title: t("loans.list.colReason"),
      key: "reason",
      dataIndex: "reason",
      ellipsis: true,
    },
    {
      title: t("loans.list.colStatus"),
      key: "status",
      dataIndex: "status",
      render: (status: LoanStatus) => {
        const statusMap: Record<string, string> = {
          submitted: "status.submitted",
          pending_manager: "status.pendingManager",
          pending_hr: "status.pendingHr",
          pending_finance: "status.pendingFinance",
          pending_cfo: "status.pendingCfo",
          pending_ceo: "status.pendingCeo",
          pending_disbursement: "status.pendingDisbursement",
          approved: "status.approved",
          rejected: "status.rejected",
          cancelled: "status.cancelled",
          deducted: "status.deducted",
        };
        const label = t(statusMap[status] || "status.unknown");
        return <Tag color={statusColor(status)}>{label}</Tag>;
      },
    },
    {
      title: t("loans.list.colCreated"),
      key: "created_at",
      dataIndex: "created_at",
      render: (value?: string) => (value ? new Date(value).toLocaleDateString() : "-"),
    },
    {
      title: t("common.actions"),
      key: "actions",
      render: (_, record) => {
        const isPending =
          record.status === "submitted" ||
          record.status === "pending_manager" ||
          record.status === "pending_hr" ||
          record.status === "pending_finance" ||
          record.status === "pending_cfo" ||
          record.status === "pending_ceo";
        return (
          <div style={{ display: "flex", gap: 8 }}>
            <Tooltip title={t("loans.list.viewDetails")}>
              <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/employee/loans/${record.id}`)} />
            </Tooltip>
            {isPending ? (
              <Tooltip title={t("loans.list.cancelReq")}>
                <Button
                  danger
                  size="small"
                  icon={<CloseCircleOutlined />}
                  loading={cancellingId === record.id}
                  onClick={() => onCancel(record.id)}
                />
              </Tooltip>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        title={t("loans.myRequests.title")}
        subtitle={t("loans.myRequests.subtitle")}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/employee/loans/request")}>
            {t("loans.myRequests.newRequest")}
          </Button>
        }
      />
      <Card style={{ borderRadius: 16 }}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              if (nextSize !== pageSize) setPageSize(nextSize || 10);
            },
          }}
        />
      </Card>
    </div>
  );
}
