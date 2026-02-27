import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Select, Space, Table, Tag, Typography, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined } from "@ant-design/icons";

import PageHeader from "../ui/PageHeader";
import type { ApiResponse, PaginatedResponse } from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import type { LoanRequest, LoanStatus } from "../../services/api/loanApi";
import { formatNumber } from "../../utils/currency";
import { useI18n } from "../../i18n/useI18n";

type Props = {
  title: string;
  subtitle: string;
  detailsBasePath: string;
  defaultStatus?: LoanStatus;
  fetcher: (params?: {
    status?: LoanStatus;
    page?: number;
    page_size?: number;
  }) => Promise<ApiResponse<PaginatedResponse<LoanRequest>>>;
};

const statusColors: Record<string, string> = {
  submitted: "blue",
  pending_manager: "orange",
  pending_hr: "gold",
  pending_finance: "gold",
  pending_cfo: "purple",
  pending_ceo: "volcano",
  pending_disbursement: "geekblue",
  approved: "green",
  rejected: "red",
  cancelled: "default",
  deducted: "cyan",
};

export default function LoanRequestsTablePage({
  title,
  subtitle,
  detailsBasePath,
  defaultStatus,
  fetcher,
}: Props) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<LoanStatus | undefined>(defaultStatus);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<LoanRequest[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetcher({ status: statusFilter, page, page_size: pageSize });
        if (isApiError(res)) {
          notification.error({ message: t("loans.myRequests.failedLoad"), description: res.message });
          return;
        }
        setItems(res.data.items || []);
        setTotal(res.data.count || 0);
      } catch {
        notification.error({ message: t("loans.myRequests.failedLoad") });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetcher, statusFilter, page, pageSize, t]);

  const getStatusLabel = (status: string) => {
    if (!status) return "";
    const map: Record<string, string> = {
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
    const key = map[status];
    if (key) return t(key);
    return status.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  };

  const columns: ColumnsType<LoanRequest> = [
    {
      title: t("payroll.runDetails.colEmployee"),
      key: "employee",
      render: (_, record) => record.employee?.full_name || record.employee?.email || "-",
    },
    {
      title: t("loans.list.colAmount"),
      key: "requested_amount",
      render: (_, record) => formatNumber(record.requested_amount || 0),
    },
    {
      title: t("loans.list.colStatus"),
      key: "status",
      dataIndex: "status",
      render: (status: LoanStatus) => <Tag color={statusColors[status as string] || "default"}>{getStatusLabel(status as string)}</Tag>,
    },
    {
      title: t("loans.list.colCreated"),
      key: "created_at",
      dataIndex: "created_at",
      render: (value?: string) => (value ? new Date(value).toLocaleDateString() : "-"),
    },
    {
      title: t("common.actions"),
      key: "action",
      align: 'center',
      render: (_, record) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`${detailsBasePath}/${record.id}`)} />
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <Card style={{ borderRadius: 16 }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space>
            <Typography.Text strong>{t("loans.list.colStatus")}</Typography.Text>
            <Select
              style={{ width: 220 }}
              allowClear
              placeholder={t("loans.inbox.allStatuses")}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              options={[
                { label: getStatusLabel("submitted"), value: "submitted" },
                { label: getStatusLabel("pending_manager"), value: "pending_manager" },
                { label: getStatusLabel("pending_hr"), value: "pending_hr" },
                { label: getStatusLabel("pending_finance"), value: "pending_finance" },
                { label: getStatusLabel("pending_cfo"), value: "pending_cfo" },
                { label: getStatusLabel("pending_ceo"), value: "pending_ceo" },
                { label: getStatusLabel("pending_disbursement"), value: "pending_disbursement" },
                { label: getStatusLabel("approved"), value: "approved" },
                { label: getStatusLabel("rejected"), value: "rejected" },
                { label: getStatusLabel("cancelled"), value: "cancelled" },
                { label: getStatusLabel("deducted"), value: "deducted" },
              ]}
            />
          </Space>
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            scroll={{ x: 800 }}
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
        </Space>
      </Card>
    </div>
  );
}
