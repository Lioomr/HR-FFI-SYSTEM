import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Grid, Segmented, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import HiringRequestStatusTag from "../../components/hiringRequests/HiringRequestStatusTag";
import SARIcon from "../../components/icons/SARIcon";
import Unauthorized403Page from "../Unauthorized403Page";

import { isApiError } from "../../services/api/apiTypes";
import { isForbidden } from "../../services/api/httpErrors";
import {
  listHiringRequests,
  type HiringRequest,
  type HiringRequestStatus,
} from "../../services/api/hiringRequestsApi";
import { useI18n } from "../../i18n/useI18n";
import { formatNumber } from "../../utils/currency";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;
const { useBreakpoint } = Grid;

const PAGE_SIZE = 20;

/**
 * The CEO only ever sees requests awaiting a decision plus the ones they have
 * already decided — the backend scopes the list that way — so the tabs mirror
 * exactly those states.
 */
const STATUS_TABS: HiringRequestStatus[] = ["submitted", "approved", "rejected"];

export default function CEOHiringRequestsInboxPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;

  const [statusFilter, setStatusFilter] = useState<HiringRequestStatus>("submitted");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HiringRequest[]>([]);
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
      try {
        const response = await listHiringRequests({
          status: statusFilter,
          page,
          page_size: PAGE_SIZE,
        });
        if (isApiError(response)) {
          setError(response.message || t("hiringRequests.loadFailed"));
          return;
        }
        const rows = response.data?.items;
        if (!Array.isArray(rows)) {
          setError(t("hiringRequests.loadFailed"));
          return;
        }
        setItems(rows);
        setTotal(typeof response.data.count === "number" ? response.data.count : rows.length);
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError((err as Error)?.message || t("hiringRequests.loadFailed"));
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
    () => STATUS_TABS.map((value) => ({ label: t(`hiringRequests.status.${value}`), value })),
    [t],
  );

  const columns: ColumnsType<HiringRequest> = [
    {
      title: t("hiringRequests.col.reference"),
      key: "reference",
      width: 150,
      render: (_, record) => <Text strong>{record.reference_number || "—"}</Text>,
    },
    {
      title: t("hiringRequests.col.candidate"),
      key: "candidate",
      render: (_, record) => (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text strong>{record.candidate_full_name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.nationality || record.candidate_email || "—"}
          </Text>
        </div>
      ),
    },
    {
      title: t("hiringRequests.col.company"),
      key: "company",
      render: (_, record) => <Text>{record.company_name || "—"}</Text>,
    },
    {
      title: t("hiringRequests.col.salary"),
      key: "salary",
      width: 140,
      render: (_, record) => (
        <Space size={4} style={{ whiteSpace: "nowrap" }}>
          <Text strong>{formatNumber(record.proposed_salary)}</Text>
          <SARIcon size={13} color="#475569" />
        </Space>
      ),
    },
    {
      title: t("hiringRequests.col.requestedBy"),
      key: "requested_by",
      render: (_, record) => <Text>{record.requested_by_name || "—"}</Text>,
    },
    {
      title: t("hiringRequests.col.submittedAt"),
      key: "submitted_at",
      width: 170,
      render: (_, record) => <Text>{formatDateTimeShort(record.submitted_at, "—")}</Text>,
    },
    {
      title: t("hiringRequests.col.status"),
      key: "status",
      width: 130,
      render: (_, record) => (
        <HiringRequestStatusTag status={record.status} fallbackLabel={record.status_label} />
      ),
    },
    {
      title: t("hiringRequests.col.actions"),
      key: "actions",
      width: 130,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        <Button
          type="primary"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/ceo/hiring-requests/${record.id}`);
          }}
          aria-label={`${t("hiringRequests.action.review")}: ${record.candidate_full_name}`}
          style={{ borderRadius: 8, fontWeight: 600 }}
        >
          {t("hiringRequests.action.review")}
        </Button>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  return (
    <ApprovalQueuePage
      title={t("hiringRequests.ceo.title")}
      subtitle={t("hiringRequests.ceo.subtitle")}
      pendingCount={statusFilter === "submitted" ? total : undefined}
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      emptyTitle={t("hiringRequests.ceo.emptyTitle")}
      emptyDescription={t("hiringRequests.ceo.emptyDescription")}
      onRetry={() => load()}
      onRefresh={() => load({ isRefresh: true })}
      refreshing={refreshing}
      filters={
        <Segmented
          value={statusFilter}
          options={segmentedOptions}
          onChange={(value) => {
            setStatusFilter(value as HiringRequestStatus);
            setPage(1);
          }}
        />
      }
    >
      <Table<HiringRequest>
        rowKey="id"
        columns={columns}
        dataSource={items}
        scroll={{ x: 1100 }}
        onRow={(record) => ({
          onClick: () => navigate(`/ceo/hiring-requests/${record.id}`),
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
    </ApprovalQueuePage>
  );
}
