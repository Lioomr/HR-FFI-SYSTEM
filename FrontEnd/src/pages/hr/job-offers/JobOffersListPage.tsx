import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Grid, Input, Modal, Segmented, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  EyeOutlined,
  FilePdfOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";

import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import LoadingState from "../../../components/ui/LoadingState";
import PageHeader from "../../../components/ui/PageHeader";
import JobOfferStatusTag from "../../../components/jobOffers/JobOfferStatusTag";
import Unauthorized403Page from "../../Unauthorized403Page";

import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import { triggerBlobDownload } from "../../../services/api/downloads";
import {
  cancelJobOffer,
  downloadJobOfferPdf,
  listJobOffers,
  sendJobOffer,
  type JobOffer,
  type JobOfferStatus,
} from "../../../services/api/jobOffersApi";
import { useI18n } from "../../../i18n/useI18n";
import { formatNumber } from "../../../utils/currency";
import SARIcon from "../../../components/icons/SARIcon";
import { toSearchParam } from "../../../utils/searchInput";
import { canCancel, canSend } from "./jobOfferRules";

const { Text } = Typography;
const { useBreakpoint } = Grid;

const PAGE_SIZE = 25;

type StatusFilter = JobOfferStatus | "all";

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
];

export default function JobOffersListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isNarrow = !screens.lg;
  const [messageApi, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<JobOffer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await listJobOffers({
          page,
          page_size: PAGE_SIZE,
          ...(statusFilter === "all" ? {} : { status: statusFilter }),
          ...(search ? { search } : {}),
        });
        if (isApiError(response)) {
          setError(response.message || t("jobOffers.loadFailed"));
          return;
        }
        // A misrouted request (proxy serving the SPA shell, a gateway error
        // page) resolves without throwing but carries no envelope. Fail into
        // the translated error state rather than letting a raw TypeError from
        // the destructure reach the user.
        const items = response.data?.items;
        if (!Array.isArray(items)) {
          setError(t("jobOffers.loadFailed"));
          return;
        }
        setItems(items);
        setTotal(typeof response.data.count === "number" ? response.data.count : items.length);
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
    [page, statusFilter, search, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Search is applied on submit/blur rather than per keystroke so the inbox does
  // not fire a request for every character typed into a shared list endpoint.
  const applySearch = useCallback((value: string) => {
    setSearch(toSearchParam(value) || "");
    setPage(1);
  }, []);

  const statusOptions = useMemo(
    () =>
      STATUS_FILTERS.map((value) => ({
        label: t(`jobOffers.status.${value}`),
        value,
      })),
    [t],
  );

  const handleSend = useCallback(
    (offer: JobOffer) => {
      modal.confirm({
        title: t("jobOffers.send.confirmTitle"),
        content: t("jobOffers.send.confirmBody"),
        okText: t("jobOffers.send.confirmOk"),
        cancelText: t("common.cancel"),
        onOk: async () => {
          setBusyId(offer.id);
          try {
            const response = await sendJobOffer(offer.id);
            if (isApiError(response)) {
              messageApi.error(response.message || t("jobOffers.send.failed"));
              return;
            }
            const warnings = response.data.delivery?.warnings || [];
            // A warning on one channel does not undo the send: the offer is out.
            if (warnings.length > 0) messageApi.warning(t("jobOffers.send.successWithWarnings"));
            else messageApi.success(t("jobOffers.send.success"));
            await load({ isRefresh: true });
          } catch (err: unknown) {
            messageApi.error((err as Error)?.message || t("jobOffers.send.failed"));
          } finally {
            setBusyId(null);
          }
        },
      });
    },
    [modal, messageApi, t, load],
  );

  const handleCancel = useCallback(
    (offer: JobOffer) => {
      modal.confirm({
        title: t("jobOffers.cancel.confirmTitle"),
        content: t("jobOffers.cancel.confirmBody"),
        okText: t("jobOffers.cancel.confirmOk"),
        okButtonProps: { danger: true },
        cancelText: t("jobOffers.cancel.keep"),
        onOk: async () => {
          setBusyId(offer.id);
          try {
            const response = await cancelJobOffer(offer.id);
            if (isApiError(response)) {
              messageApi.error(response.message || t("jobOffers.cancel.failed"));
              return;
            }
            messageApi.success(t("jobOffers.cancel.success"));
            await load({ isRefresh: true });
          } catch (err: unknown) {
            messageApi.error((err as Error)?.message || t("jobOffers.cancel.failed"));
          } finally {
            setBusyId(null);
          }
        },
      });
    },
    [modal, messageApi, t, load],
  );

  const handlePdf = useCallback(
    async (offer: JobOffer) => {
      setBusyId(offer.id);
      try {
        const blob = await downloadJobOfferPdf(offer.id);
        triggerBlobDownload(blob, `job_offer_${offer.id}.pdf`);
        messageApi.success(t("jobOffers.pdf.success"));
      } catch (err: unknown) {
        messageApi.error((err as Error)?.message || t("jobOffers.pdf.failed"));
      } finally {
        setBusyId(null);
      }
    },
    [messageApi, t],
  );

  const columns: ColumnsType<JobOffer> = [
    {
      title: t("jobOffers.col.candidate"),
      key: "candidate",
      render: (_, record) => (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text strong style={{ color: "#0f172a" }}>
            {record.candidate_full_name}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.candidate_email || record.candidate_phone_number || record.reference_number}
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
          {record.reference_number && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.reference_number}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: t("jobOffers.col.departmentLocation"),
      key: "department",
      render: (_, record) => (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text>{record.department || "—"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.location || "—"}
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
      title: t("jobOffers.col.status"),
      key: "status",
      width: 140,
      render: (_, record) => (
        <JobOfferStatusTag status={record.status} fallbackLabel={record.status_label} />
      ),
    },
    {
      title: t("jobOffers.col.offerDate"),
      dataIndex: "offer_date",
      key: "offer_date",
      width: 130,
      render: (value: string) => <Text>{value || "—"}</Text>,
    },
    {
      title: t("jobOffers.col.expiryDate"),
      dataIndex: "expiry_date",
      key: "expiry_date",
      width: 130,
      render: (value: string) => <Text>{value || "—"}</Text>,
    },
    {
      title: t("jobOffers.col.actions"),
      key: "actions",
      width: 190,
      fixed: isNarrow ? undefined : "right",
      render: (_, record) => (
        // The row itself opens the offer, so the action cell has to keep its
        // clicks to itself or every button would also navigate.
        <Space size={4} wrap onClick={(event) => event.stopPropagation()}>
          <Tooltip title={t("jobOffers.action.view")}>
            <Button
              size="small"
              icon={<EyeOutlined aria-hidden />}
              aria-label={`${t("jobOffers.action.view")}: ${record.candidate_full_name}`}
              onClick={() => navigate(`/hr/job-offers/${record.id}`)}
              style={{ borderRadius: 8 }}
            />
          </Tooltip>
          {canSend(record) && (
            <Tooltip title={t("jobOffers.action.sendOffer")}>
              <Button
                size="small"
                type="primary"
                icon={<SendOutlined aria-hidden />}
                loading={busyId === record.id}
                aria-label={`${t("jobOffers.action.sendOffer")}: ${record.candidate_full_name}`}
                onClick={() => handleSend(record)}
                style={{ borderRadius: 8 }}
              />
            </Tooltip>
          )}
          <Tooltip title={t("jobOffers.action.downloadPdf")}>
            <Button
              size="small"
              icon={<FilePdfOutlined aria-hidden />}
              loading={busyId === record.id}
              aria-label={`${t("jobOffers.action.downloadPdf")}: ${record.candidate_full_name}`}
              onClick={() => handlePdf(record)}
              style={{ borderRadius: 8 }}
            />
          </Tooltip>
          {canCancel(record) && (
            <Tooltip title={t("jobOffers.action.cancelOffer")}>
              <Button
                size="small"
                danger
                icon={<StopOutlined aria-hidden />}
                loading={busyId === record.id}
                aria-label={`${t("jobOffers.action.cancelOffer")}: ${record.candidate_full_name}`}
                onClick={() => handleCancel(record)}
                style={{ borderRadius: 8 }}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  if (forbidden) return <Unauthorized403Page />;

  const hasFilters = statusFilter !== "all" || search.length > 0;

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
      {messageContext}
      {modalContext}

      <PageHeader
        title={t("jobOffers.title")}
        subtitle={t("jobOffers.subtitle")}
        tags={
          total > 0 ? (
            <Tag style={{ margin: 0, borderRadius: 999, fontWeight: 700 }} color="orange">
              {t("jobOffers.countTag", { count: String(total) })}
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
              {t("jobOffers.action.refresh")}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => navigate("/hr/hiring-requests?status=approved")}
              style={{ borderRadius: 10, minHeight: 40, fontWeight: 600 }}
            >
              {t("jobOffers.createFromRequest")}
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
          onSearch={applySearch}
          placeholder={t("jobOffers.searchPlaceholder")}
          aria-label={t("jobOffers.searchPlaceholder")}
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
          title={hasFilters ? t("jobOffers.empty.filteredTitle") : t("jobOffers.empty.title")}
          description={
            hasFilters ? t("jobOffers.empty.filteredDescription") : t("jobOffers.empty.description")
          }
          actionText={hasFilters ? undefined : t("jobOffers.createFromRequest")}
          onAction={hasFilters ? undefined : () => navigate("/hr/hiring-requests?status=approved")}
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
          <Table<JobOffer>
            rowKey="id"
            columns={columns}
            dataSource={items}
            scroll={{ x: 1100 }}
            onRow={(record) => ({
              onClick: () => navigate(`/hr/job-offers/${record.id}`),
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
