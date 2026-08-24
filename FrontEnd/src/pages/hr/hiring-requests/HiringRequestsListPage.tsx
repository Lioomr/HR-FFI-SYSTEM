import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Grid, Input, Segmented, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EyeOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";

import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import SARIcon from "../../../components/icons/SARIcon";
import HiringRequestStatusTag from "../../../components/hiringRequests/HiringRequestStatusTag";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import {
  listHiringRequests,
  type HiringRequest,
  type HiringRequestStatus,
} from "../../../services/api/hiringRequestsApi";
import { useI18n } from "../../../i18n/useI18n";
import { formatNumber } from "../../../utils/currency";
import { formatDateOnly } from "../../../utils/dateTime";
import { toSearchParam } from "../../../utils/searchInput";

const { Text } = Typography;
const { useBreakpoint } = Grid;

const PAGE_SIZE = 25;

type StatusFilter = HiringRequestStatus | "all";

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "draft",
  "submitted",
  "approved",
  "rejected",
  "converted",
  "cancelled",
];

export default function HiringRequestsListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
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
          page,
          page_size: PAGE_SIZE,
          ...(statusFilter === "all" ? {} : { status: statusFilter }),
          ...(search ? { search } : {}),
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
    [page, statusFilter, search, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const statusOptions = useMemo(
    () => STATUS_FILTERS.map((value) => ({ label: t(`hiringRequests.status.${value}`), value })),
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
          <Text strong style={{ color: "#0f172a" }}>
            {record.candidate_full_name}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.candidate_email || record.candidate_phone_number || "—"}
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
      title: t("hiringRequests.col.status"),
      key: "status",
      width: 130,
      render: (_, record) => (
        <HiringRequestStatusTag status={record.status} fallbackLabel={record.status_label} />
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
      width: 130,
      render: (_, record) => <Text>{formatDateOnly(record.submitted_at, "—")}</Text>,
    },
    {
      title: t("hiringRequests.col.ceoDecision"),
      key: "ceo_decision",
      width: 170,
      render: (_, record) =>
        record.ceo_decision_at ? (
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Text>{formatDateOnly(record.ceo_decision_at, "—")}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.ceo_decision_by_name || "—"}
            </Text>
          </div>
        ) : (
          <Text type="secondary">{t("hiringRequests.awaitingDecision")}</Text>
        ),
    },
    {
      title: t("hiringRequests.col.actions"),
      key: "actions",
      width: 90,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        // The row itself opens the request, so the action cell keeps its clicks.
        <div onClick={(event) => event.stopPropagation()}>
          <Button
            size="small"
            icon={<EyeOutlined aria-hidden />}
            aria-label={`${t("hiringRequests.action.view")}: ${record.candidate_full_name}`}
            onClick={() => navigate(`/hr/hiring-requests/${record.id}`)}
            style={{ borderRadius: 8 }}
          />
        </div>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  const hasFilters = statusFilter !== "all" || search.length > 0;

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
      <PageHeader
        title={t("hiringRequests.title")}
        subtitle={t("hiringRequests.subtitle")}
        tags={
          total > 0 ? (
            <Tag style={{ margin: 0, borderRadius: 999, fontWeight: 700 }} color="orange">
              {t("hiringRequests.countTag", { count: String(total) })}
            </Tag>
          ) : undefined
        }
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={refreshing}
              onClick={() => load({ isRefresh: true })}
              style={{ borderRadius: 10, minHeight: 40 }}
            >
              {t("hiringRequests.action.refresh")}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => navigate("/hr/hiring-requests/new")}
              style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
            >
              {t("hiringRequests.newRequest")}
            </Button>
          </div>
        }
      />

      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <Input.Search
          allowClear
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onSearch={(value) => {
            setSearch(toSearchParam(value) || "");
            setPage(1);
          }}
          placeholder={t("hiringRequests.searchPlaceholder")}
          aria-label={t("hiringRequests.searchPlaceholder")}
          style={{ maxWidth: 380, flex: "1 1 260px" }}
        />
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <Segmented
            value={statusFilter}
            options={statusOptions}
            onChange={(value) => {
              setStatusFilter(value as StatusFilter);
              setPage(1);
            }}
          />
        </div>
        {hasFilters && (
          <Button
            type="link"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setStatusFilter("all");
              setPage(1);
            }}
          >
            {t("common.clearFilters")}
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingState title={t("loading.generic")} />
      ) : error ? (
        <ErrorState title={t("common.error")} description={error} onRetry={() => load()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={hasFilters ? t("hiringRequests.empty.filteredTitle") : t("hiringRequests.empty.title")}
          description={
            hasFilters
              ? t("hiringRequests.empty.filteredDescription")
              : t("hiringRequests.empty.description")
          }
          actionText={hasFilters ? undefined : t("hiringRequests.newRequest")}
          onAction={hasFilters ? undefined : () => navigate("/hr/hiring-requests/new")}
        />
      ) : (
        <div
          style={{
            background: "white",
            borderRadius: 16,
            padding: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <Table<HiringRequest>
            rowKey="id"
            columns={columns}
            dataSource={items}
            scroll={{ x: 1200 }}
            onRow={(record) => ({
              onClick: () => navigate(`/hr/hiring-requests/${record.id}`),
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
        </div>
      )}
    </div>
  );
}
