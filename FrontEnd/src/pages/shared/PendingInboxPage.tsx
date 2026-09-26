import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Empty,
  Input,
  Tag,
  Tooltip,
  Typography,
  notification,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ClockCircleOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import {
  FilterChips,
  WorkspaceCard,
  WorkspaceViews,
} from "../../components/ui/workspace/Workspace";
import ResponsiveTable from "../../components/ui/ResponsiveTable";
import {
  getPendingRequests,
  type PendingRequestItem,
  type PendingRequestType,
} from "../../services/api/pendingRequestsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";
import { isHeadOfficeOrganization } from "../../utils/organizationContext";
import { formatDateTime } from "../../utils/dateTime";
import {
  PENDING_TYPE_COLORS,
  PENDING_TYPE_LABEL_KEYS,
} from "../../utils/pendingRequests";
import { formatRelativeTime } from "../../components/notifications/notificationMeta";
import { useNotificationNavigate } from "../../components/notifications/notificationUrl";

/** A request waiting longer than this is flagged in the list. */
const STALE_AFTER_MS = 3 * 86_400_000;

export default function PendingInboxPage() {
  const { t, language } = useI18n();
  const { token } = theme.useToken();
  const navigateToNotification = useNotificationNavigate();
  const user = useAuthStore((s) => s.user);
  const isHeadOffice = isHeadOfficeOrganization(user);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PendingRequestItem[]>([]);
  const [count, setCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [countsByType, setCountsByType] = useState<
    Partial<Record<PendingRequestType, number>>
  >({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [requestType, setRequestType] = useState<PendingRequestType>();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPendingRequests({
        request_type: requestType,
        search: search || undefined,
        page,
        page_size: pageSize,
      });
      if (isApiError(res)) {
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
      } else {
        const filteredCount = res.data.count ?? 0;
        setData(res.data.items ?? []);
        setCount(filteredCount);
        setTotalCount(res.data.total_count ?? filteredCount);
        setCountsByType(res.data.counts_by_type ?? {});
      }
    } catch (err: any) {
      notification.error({
        message: t("common.error"),
        description: err?.message,
      });
    } finally {
      setLoading(false);
    }
  }, [requestType, search, page, pageSize, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refetch when tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [loadData]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value.trim());
      setPage(1);
    }, 350);
  };

  const selectType = (type?: PendingRequestType) => {
    setRequestType((current) => (current === type ? undefined : type));
    setPage(1);
  };

  const typeLabel = (type: PendingRequestType, fallback?: string) =>
    t(PENDING_TYPE_LABEL_KEYS[type] ?? type, fallback ?? type);

  const paletteColor = (type: PendingRequestType) => {
    const preset = PENDING_TYPE_COLORS[type];
    return (
      (preset && (token as unknown as Record<string, string>)[`${preset}6`]) ||
      token.colorPrimary
    );
  };

  // Only types with something waiting get a chip; the biggest queue comes first.
  const typeChips = (
    Object.entries(countsByType) as [PendingRequestType, number][]
  )
    .filter(([, value]) => value > 0)
    .sort(([, a], [, b]) => b - a);

  const columns: ColumnsType<PendingRequestItem> = [
    {
      title: t("pendingInbox.col.employee"),
      key: "employee",
      render: (_, record) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar
            src={record.avatar || undefined}
            size={36}
            style={{ background: "#f97316", flexShrink: 0, fontWeight: 700 }}
          >
            {!record.avatar ? record.name.charAt(0).toUpperCase() : undefined}
          </Avatar>
          <Button
            type="link"
            style={{ padding: 0, fontWeight: 500, height: "auto" }}
            onClick={(event) => {
              event.stopPropagation();
              navigateToNotification(record.review_path);
            }}
          >
            {record.name}
          </Button>
        </div>
      ),
    },
    {
      title: t("pendingInbox.col.requestType"),
      key: "request_type",
      render: (_, record) => (
        <Tag color={PENDING_TYPE_COLORS[record.request_type] ?? "default"}>
          {typeLabel(record.request_type, record.request_type_label)}
        </Tag>
      ),
    },
    {
      title: t("pendingInbox.col.action"),
      dataIndex: "action",
      key: "action",
      render: (value: string, record) => (
        <div style={{ maxWidth: 420 }}>
          <Typography.Text strong>{value}</Typography.Text>
          {record.details ? (
            <Typography.Paragraph
              ellipsis={{ rows: 1, tooltip: record.details }}
              style={{
                margin: "3px 0 0",
                color: token.colorTextSecondary,
                fontSize: 12,
              }}
            >
              {record.details}
            </Typography.Paragraph>
          ) : null}
        </div>
      ),
    },
    ...(isHeadOffice
      ? [
          {
            title: t("common.company"),
            dataIndex: "company_name",
            key: "company_name",
            render: (val?: string | null) =>
              val ? <Tag color="blue">{val}</Tag> : "-",
          },
        ]
      : []),
    {
      title: t("pendingInbox.col.time"),
      dataIndex: "time",
      key: "time",
      render: (val: string) => {
        const stale = Date.now() - new Date(val).getTime() > STALE_AFTER_MS;
        return (
          <Tooltip title={formatDateTime(val)}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                color: stale
                  ? token.colorWarningText
                  : token.colorTextSecondary,
                fontWeight: stale ? 600 : 400,
              }}
            >
              {stale ? (
                <ClockCircleOutlined
                  aria-label={t("pendingInbox.waitingLong")}
                />
              ) : null}
              {formatRelativeTime(val, language)}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: t("common.actions"),
      key: "actions",
      align: "center",
      render: (_, record) => (
        <Button
          icon={<EyeOutlined />}
          size="small"
          type="primary"
          ghost
          onClick={(event) => {
            event.stopPropagation();
            navigateToNotification(record.review_path);
          }}
        >
          {t("common.review")}
        </Button>
      ),
    },
  ];

  const isFiltered = Boolean(search || requestType);

  return (
    <div>
      <PageHeader
        title={t("pendingInbox.title")}
        subtitle={t("pendingInbox.subtitle")}
        tags={
          <Tag color={totalCount ? "orange" : "green"}>
            {totalCount
              ? t("pendingInbox.needsAttention")
              : t("pendingInbox.allClear")}
          </Tag>
        }
        actions={
          <Button
            icon={<ReloadOutlined />}
            onClick={loadData}
            loading={loading}
          >
            {t("common.refresh", "Refresh")}
          </Button>
        }
      />

      <WorkspaceViews>
        <FilterChips
          label={t("pendingInbox.col.requestType")}
          options={[
            {
              key: "all",
              label: t("pendingInbox.filterAll"),
              count: totalCount,
              accentColor: token.colorPrimary,
              active: !requestType,
              onSelect: () => selectType(undefined),
            },
            ...typeChips.map(([type, value]) => ({
              key: type,
              label: typeLabel(type),
              count: value,
              accentColor: paletteColor(type),
              active: requestType === type,
              onSelect: () => selectType(type),
            })),
          ]}
        />
      </WorkspaceViews>

      <WorkspaceCard
        toolbar={
          <Input
            value={searchInput}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t("pendingInbox.searchPlaceholder")}
            prefix={
              <SearchOutlined style={{ color: token.colorTextTertiary }} />
            }
            allowClear
            className="ffi-toolbar__search"
          />
        }
        title={requestType ? typeLabel(requestType) : t("common.allRequests")}
        count={t("common.requestsCount", { count })}
        busy={loading && data.length > 0}
      >
        <ResponsiveTable
          mobileCard={{
            titleKey: "employee",
            extraKey: "request_type",
          }}
          dataSource={data}
          columns={columns}
          rowKey={(r) => `${r.request_type}-${r.id}`}
          // The whole row opens the request: the Review button sits behind a
          // horizontal scroll on narrow screens, so it cannot be the only way in.
          onRow={(record) => ({
            style: { cursor: "pointer" },
            onClick: () => navigateToNotification(record.review_path),
          })}
          loading={loading}
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  isFiltered ? (
                    t("pendingInbox.noMatches")
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {t("pendingInbox.empty")}
                      </div>
                      <div
                        style={{ color: token.colorTextTertiary, marginTop: 4 }}
                      >
                        {t("pendingInbox.emptyDesc")}
                      </div>
                    </div>
                  )
                }
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total: count,
            hideOnSinglePage: true,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50"],
            onChange: (p, ps) => {
              setPage(p);
              if (ps !== pageSize) setPageSize(ps ?? 20);
            },
          }}
        />
      </WorkspaceCard>
    </div>
  );
}
