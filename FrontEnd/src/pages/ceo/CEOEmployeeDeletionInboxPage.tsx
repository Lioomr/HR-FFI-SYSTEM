import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Grid, Segmented, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import ApprovalStatusTag, { type ApprovalStatusTone } from "../../components/ceo/ApprovalStatusTag";
import Unauthorized403Page from "../Unauthorized403Page";

import {
  listEmployeeArchiveRequests,
  type EmployeeArchiveRequest,
  type EmployeeArchiveStatus,
} from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import { isForbidden } from "../../services/api/httpErrors";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;
const { useBreakpoint } = Grid;

const STATUS_TABS: EmployeeArchiveStatus[] = ["PENDING_CEO", "REJECTED", "EXECUTED"];

const STATUS_TONE: Record<EmployeeArchiveStatus, ApprovalStatusTone> = {
  PENDING_CEO: "pending",
  REJECTED: "rejected",
  EXECUTED: "approved",
};

const PAGE_SIZE = 20;

export default function CEOEmployeeDeletionInboxPage() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;

  const [statusFilter, setStatusFilter] = useState<EmployeeArchiveStatus>("PENDING_CEO");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<EmployeeArchiveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setForbidden(false);
      try {
        const response = await listEmployeeArchiveRequests({
          status: statusFilter,
          page,
          page_size: PAGE_SIZE,
        });
        if (isApiError(response)) {
          setError(response.message || t("employees.removalInbox.errorGeneric"));
          return;
        }
        setItems(response.data.items || []);
        setTotal(
          typeof response.data.count === "number"
            ? response.data.count
            : (response.data.items || []).length,
        );
      } catch (err: any) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError(err?.message || t("employees.removalInbox.errorGeneric"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, page, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const segmentedOptions = useMemo(
    () =>
      STATUS_TABS.map((status) => ({
        label: t(`employees.removalInbox.status.${status}`),
        value: status,
      })),
    [t],
  );

  const employeeName = (record: EmployeeArchiveRequest) => {
    const snapshot = record.request_snapshot || {};
    const localized =
      language === "ar"
        ? snapshot.full_name_ar || snapshot.full_name || snapshot.full_name_en
        : snapshot.full_name_en || snapshot.full_name || snapshot.full_name_ar;
    return localized || snapshot.employee_id || `#${record.id}`;
  };

  const columns: ColumnsType<EmployeeArchiveRequest> = [
    {
      title: t("employees.removalInbox.colEmployee"),
      key: "employee",
      render: (_, record) => {
        const snapshot = record.request_snapshot || {};
        return (
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Text strong>{employeeName(record)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {snapshot.email || snapshot.target_user_email || snapshot.employee_id || "—"}
            </Text>
          </div>
        );
      },
    },
    {
      title: t("employees.removalInbox.colDepartment"),
      key: "department",
      render: (_, record) => <Text>{record.request_snapshot?.department_name || "—"}</Text>,
    },
    {
      title: t("employees.removalInbox.colCompany"),
      key: "company",
      render: (_, record) => <Text>{record.company_name || "—"}</Text>,
    },
    {
      title: t("employees.removalInbox.colRequestedBy"),
      key: "requested_by",
      render: (_, record) => <Text>{record.requested_by_name || "—"}</Text>,
    },
    {
      title: t("employees.removalInbox.colReason"),
      dataIndex: "reason",
      key: "reason",
      render: (value: string) => (
        <Typography.Paragraph
          style={{ marginBottom: 0, maxWidth: 320 }}
          ellipsis={{ rows: 2, tooltip: value || undefined }}
        >
          {value || "—"}
        </Typography.Paragraph>
      ),
    },
    {
      title: t("employees.removalInbox.colCreatedAt"),
      dataIndex: "created_at",
      key: "created_at",
      width: 170,
      render: (value: string) => formatDateTimeShort(value),
    },
    {
      title: t("employees.removalInbox.colStatus"),
      dataIndex: "status",
      key: "status",
      width: 160,
      render: (value: EmployeeArchiveStatus) => (
        <ApprovalStatusTag
          label={t(`employees.removalInbox.status.${value}`)}
          tone={STATUS_TONE[value] || "neutral"}
        />
      ),
    },
    {
      title: t("employees.removalInbox.colAction"),
      key: "action",
      width: 130,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        <Button
          type="primary"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/ceo/employees/deletion-requests/${record.id}`);
          }}
          aria-label={`${t("employees.removalInbox.review")}: ${employeeName(record)}`}
          style={{ borderRadius: 8, fontWeight: 600 }}
        >
          {t("employees.removalInbox.review")}
        </Button>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  return (
    <ApprovalQueuePage
      title={t("employees.removalInbox.title")}
      subtitle={t("employees.removalInbox.subtitle")}
      pendingCount={statusFilter === "PENDING_CEO" ? total : undefined}
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      emptyTitle={t("employees.removalInbox.empty")}
      emptyDescription={t("ceo.approvals.emptyFilteredDescription")}
      onRetry={() => load()}
      onRefresh={() => load({ isRefresh: true })}
      refreshing={refreshing}
      filters={
        <Segmented
          options={segmentedOptions}
          value={statusFilter}
          aria-label={t("common.status")}
          onChange={(value) => {
            setStatusFilter(value as EmployeeArchiveStatus);
            setPage(1);
          }}
        />
      }
    >
      <Table
        rowKey="id"
        dataSource={items}
        columns={columns}
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          onChange: (next) => setPage(next),
          showSizeChanger: false,
          hideOnSinglePage: true,
          style: { paddingInline: 16 },
        }}
        onRow={(record) => ({
          onClick: () => navigate(`/ceo/employees/deletion-requests/${record.id}`),
          style: { cursor: "pointer" },
        })}
      />
    </ApprovalQueuePage>
  );
}
