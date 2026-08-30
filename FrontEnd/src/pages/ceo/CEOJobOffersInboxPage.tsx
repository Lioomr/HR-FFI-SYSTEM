import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Grid, Segmented, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import ApprovalQueuePage from "../../components/ceo/ApprovalQueuePage";
import JobOfferApprovalStatusTag from "../../components/jobOffers/JobOfferApprovalStatusTag";
import SARIcon from "../../components/icons/SARIcon";
import Unauthorized403Page from "../Unauthorized403Page";

import { isApiError } from "../../services/api/apiTypes";
import { isForbidden } from "../../services/api/httpErrors";
import {
  listJobOffers,
  type JobOffer,
  type JobOfferApprovalStatus,
} from "../../services/api/jobOffersApi";
import { useI18n } from "../../i18n/useI18n";
import { formatNumber } from "../../utils/currency";
import { formatDateTimeShort } from "../../utils/dateTime";

const { Text } = Typography;
const { useBreakpoint } = Grid;

const PAGE_SIZE = 20;

/**
 * The CEO sees offers awaiting a decision plus the ones they have already
 * decided — the backend scopes the list that way — so the tabs mirror exactly
 * those states, and the inbox opens on the only one that needs action.
 */
const STATUS_TABS: JobOfferApprovalStatus[] = [
  "pending_ceo",
  "approved",
  "changes_requested",
  "rejected",
];

export default function CEOJobOffersInboxPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;

  const [statusFilter, setStatusFilter] =
    useState<JobOfferApprovalStatus>("pending_ceo");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<JobOffer[]>([]);
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
        const response = await listJobOffers({
          approval_status: statusFilter,
          page,
          page_size: PAGE_SIZE,
        });
        if (isApiError(response)) {
          setError(response.message || t("jobOffers.loadFailed"));
          return;
        }
        const rows = response.data?.items;
        if (!Array.isArray(rows)) {
          setError(t("jobOffers.loadFailed"));
          return;
        }
        setItems(rows);
        setTotal(
          typeof response.data.count === "number"
            ? response.data.count
            : rows.length,
        );
      } catch (err: unknown) {
        if (isForbidden(err)) {
          setForbidden(true);
          return;
        }
        setError((err as Error)?.message || t("jobOffers.loadFailed"));
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
      STATUS_TABS.map((value) => ({
        label: t(`jobOffers.approval.status.${value}`),
        value,
      })),
    [t],
  );

  const columns: ColumnsType<JobOffer> = [
    {
      title: t("jobOffers.col.reference"),
      key: "reference",
      width: 150,
      render: (_, record) => (
        <Text strong>{record.reference_number || "—"}</Text>
      ),
    },
    {
      title: t("jobOffers.col.candidate"),
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
      title: t("jobOffers.col.position"),
      key: "position",
      render: (_, record) => (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text>{record.position_title || "—"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.department || "—"}
          </Text>
        </div>
      ),
    },
    {
      title: t("jobOffers.col.package"),
      key: "package",
      width: 150,
      render: (_, record) => (
        <Space size={4} style={{ whiteSpace: "nowrap" }}>
          <Text strong>{formatNumber(record.total_salary_package)}</Text>
          <SARIcon size={13} color="#475569" />
        </Space>
      ),
    },
    {
      title: t("jobOffers.col.submittedAt"),
      key: "submitted_at",
      width: 170,
      render: (_, record) => (
        <Text>{formatDateTimeShort(record.submitted_at, "—")}</Text>
      ),
    },
    {
      title: t("jobOffers.col.approvalStatus"),
      key: "approval_status",
      width: 150,
      render: (_, record) => (
        <JobOfferApprovalStatusTag
          status={record.approval_status}
          fallbackLabel={record.approval_status_label}
        />
      ),
    },
    {
      title: t("jobOffers.col.actions"),
      key: "actions",
      width: 130,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        <Button
          type="primary"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/ceo/job-offers/${record.id}`);
          }}
          aria-label={`${t("jobOffers.action.review")}: ${record.candidate_full_name}`}
          style={{ borderRadius: 8, fontWeight: 600 }}
        >
          {t("jobOffers.action.review")}
        </Button>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  return (
    <ApprovalQueuePage
      title={t("jobOffers.ceo.title")}
      subtitle={t("jobOffers.ceo.subtitle")}
      pendingCount={statusFilter === "pending_ceo" ? total : undefined}
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      emptyTitle={t("jobOffers.ceo.emptyTitle")}
      emptyDescription={t("jobOffers.ceo.emptyDescription")}
      onRetry={() => load()}
      onRefresh={() => load({ isRefresh: true })}
      refreshing={refreshing}
      filters={
        <Segmented
          value={statusFilter}
          options={segmentedOptions}
          onChange={(value) => {
            setStatusFilter(value as JobOfferApprovalStatus);
            setPage(1);
          }}
        />
      }
    >
      <Table<JobOffer>
        rowKey="id"
        columns={columns}
        dataSource={items}
        scroll={{ x: 1100 }}
        onRow={(record) => ({
          onClick: () => navigate(`/ceo/job-offers/${record.id}`),
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
