import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined } from "@ant-design/icons";

import ApprovalQueuePage from "../ceo/ApprovalQueuePage";
import ApprovalStatusTag from "../ceo/ApprovalStatusTag";
import { approvalStatusLabel } from "../ceo/approvalStatusLabel";
import TeamMemberCell from "../manager/TeamMemberCell";
import LoanApprovalMap from "../loans/LoanApprovalMap";
import type {
  ApiResponse,
  PaginatedResponse,
} from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import type { LoanRequest, LoanStatus } from "../../services/api/loanApi";
import { formatNumber } from "../../utils/currency";
import { formatDateOnly } from "../../utils/dateTime";
import { requestAgeLabel } from "../../utils/requestAge";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";
import { isHeadOfficeOrganization } from "../../utils/organizationContext";

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

const PAGE_SIZE = 20;

const STATUS_OPTIONS: LoanStatus[] = [
  "submitted",
  "pending_manager",
  "pending_hr",
  "pending_finance",
  "pending_cfo",
  "pending_ceo",
  "pending_disbursement",
  "approved",
  "rejected",
  "cancelled",
  "deducted",
];

/**
 * The loan approval queue shared by the manager, HR, CFO and CEO reviews.
 *
 * It uses the same page chrome, status pill and employee cell as every other
 * approval queue, so a reviewer who works two of these areas reads one layout.
 */
export default function LoanRequestsTablePage({
  title,
  subtitle,
  detailsBasePath,
  defaultStatus,
  fetcher,
}: Props) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const isHeadOffice = isHeadOfficeOrganization(user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LoanStatus | undefined>(
    defaultStatus,
  );
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<LoanRequest[]>([]);

  const load = useCallback(
    async (
      targetPage: number,
      { isRefresh = false }: { isRefresh?: boolean } = {},
    ) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetcher({
          status: statusFilter,
          page: targetPage,
          page_size: PAGE_SIZE,
        });
        if (isApiError(res)) {
          setError(res.message || t("loans.myRequests.failedLoad"));
          return;
        }
        setItems(res.data?.items ?? []);
        setTotal(res.data?.count ?? 0);
      } catch (err: any) {
        setError(err?.message || t("loans.myRequests.failedLoad"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetcher, statusFilter, t],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const employeeName = (record: LoanRequest) =>
    record.employee?.full_name ||
    record.employee?.email ||
    t("manager.requests.unknown");

  const columns: ColumnsType<LoanRequest> = [
    {
      title: t("payroll.runDetails.colEmployee"),
      key: "employee",
      render: (_, record) => (
        <TeamMemberCell
          name={employeeName(record)}
          secondary={record.employee?.email}
        />
      ),
    },
    {
      title: t("loans.list.colAmount"),
      key: "requested_amount",
      width: 150,
      align: "end",
      render: (_, record) => (
        <span
          className="tabular-nums"
          style={{ fontWeight: 700, color: "#0f172a" }}
        >
          {formatNumber(record.requested_amount || 0)}
        </span>
      ),
    },
    {
      title: t("loans.list.colStatus"),
      key: "status",
      width: 170,
      render: (_, record) => (
        <ApprovalStatusTag
          label={approvalStatusLabel(record.status as string, t)}
          status={record.status as string}
        />
      ),
    },
    ...(isHeadOffice
      ? [
          {
            title: t("common.company", "Company"),
            key: "company_name",
            dataIndex: "company_name",
            width: 150,
            render: (value?: string) =>
              value ? <Tag color="blue">{value}</Tag> : "—",
          } as ColumnsType<LoanRequest>[number],
        ]
      : []),
    {
      title: t("loans.list.colCreated"),
      key: "created_at",
      dataIndex: "created_at",
      width: 140,
      render: (value?: string) => (
        <span className="tabular-nums">{formatDateOnly(value, "—")}</span>
      ),
    },
    {
      title: t("manager.requests.waiting"),
      key: "age",
      width: 140,
      render: (_, record) => (
        <span
          className="tabular-nums"
          style={{ color: "#64748b", whiteSpace: "nowrap" }}
        >
          {requestAgeLabel(t, record.created_at)}
        </span>
      ),
    },
    {
      title: t("common.actions"),
      key: "action",
      width: 130,
      render: (_, record) => (
        <Button
          size="small"
          icon={<EyeOutlined aria-hidden />}
          onClick={() => navigate(`${detailsBasePath}/${record.id}`)}
          aria-label={`${t("common.view")}: ${employeeName(record)}`}
          style={{ borderRadius: 8, fontWeight: 600 }}
        >
          {t("common.view")}
        </Button>
      ),
    },
  ];

  return (
    <ApprovalQueuePage
      title={title}
      subtitle={subtitle}
      pendingCount={total}
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      emptyTitle={t("loans.inbox.emptyTitle")}
      emptyDescription={
        statusFilter
          ? t("loans.inbox.emptyFilteredDescription")
          : t("loans.inbox.emptyDescription")
      }
      onRetry={() => load(1)}
      onRefresh={() => load(page, { isRefresh: true })}
      refreshing={refreshing}
      filters={
        <Space size={12} wrap>
          <Typography.Text strong>{t("loans.list.colStatus")}</Typography.Text>
          <Select
            style={{ width: 240, maxWidth: "100%" }}
            allowClear
            placeholder={t("loans.inbox.allStatuses")}
            aria-label={t("loans.list.colStatus")}
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={STATUS_OPTIONS.map((status) => ({
              label: approvalStatusLabel(status, t),
              value: status,
            }))}
          />
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={items}
        expandable={{
          expandedRowRender: (record) => (
            <LoanApprovalMap request={record} t={t} />
          ),
        }}
        scroll={{ x: 1100 }}
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
  );
}
