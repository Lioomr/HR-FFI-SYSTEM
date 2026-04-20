import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Checkbox, DatePicker, Input, Popover, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { DownloadOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import { triggerBlobDownload } from "../../services/api/downloads";
import { exportAuditLogs, listAuditLogs } from "../../services/api/auditApi";
import { isApiError } from "../../services/api/apiTypes";
import type { AuditLogDto } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";
import { getUserPreference, saveUserPreference } from "../../services/api/preferencesApi";

const { RangePicker } = DatePicker;
const PREFERENCE_SCOPE = "tables";
const PREFERENCE_KEY = "admin-audit-logs";
const DEFAULT_VISIBLE_COLUMNS = ["timestamp", "actorEmail", "action", "target", "severity", "ip"];

type UiMode = "loading" | "empty" | "error" | "ok";

type AuditSeverity = "Info" | "Warning" | "Critical";

type AuditRow = {
  id: string | number;
  timestamp: string;
  actorEmail: string;
  action: string;
  target: string;
  severity: AuditSeverity;
  ip?: string;
};

type AuditDateRange = [Dayjs, Dayjs] | null;

function severityTag(s: AuditSeverity) {
  if (s === "Critical") return <Tag color="red">Critical</Tag>;
  if (s === "Warning") return <Tag color="gold">Warning</Tag>;
  return <Tag color="blue">Info</Tag>;
}

function inferSeverity(action: string): AuditSeverity {
  const value = action.toLowerCase();
  if (value.includes("password") || value.includes("reset")) return "Critical";
  if (value.includes("role") || value.includes("status")) return "Warning";
  return "Info";
}

function formatAuditTimestamp(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function toAuditRow(log: AuditLogDto): AuditRow {
  const target = log.entity_id
    ? `${log.entity}:${log.entity_id}`
    : log.entity || "-";

  return {
    id: log.id,
    timestamp: log.created_at,
    actorEmail: log.actor_email || "System",
    action: log.action,
    target,
    severity: inferSeverity(log.action),
    ip: log.ip_address || undefined,
  };
}

export default function AdminAuditLogsPage() {
  const { t, language } = useI18n();
  const [mode, setMode] = useState<UiMode>("loading");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<"All" | AuditSeverity>("All");
  const [actionType, setActionType] = useState<"All" | string>("All");
  const [dateRange, setDateRange] = useState<AuditDateRange>(null);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 10,
    total: 0,
  });
  const preferenceLoadedRef = useRef(false);
  const preferenceSaveTimeoutRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    if (severity === "All") return rows;
    return rows.filter((r) => r.severity === severity);
  }, [rows, severity]);

  const actionOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.map((r) => r.action))).sort();
    return unique;
  }, [rows]);

  useEffect(() => {
    let active = true;

    async function loadPreference() {
      try {
        const response = await getUserPreference(PREFERENCE_SCOPE, PREFERENCE_KEY);
        if (!active || isApiError(response)) {
          return;
        }

        const value = response.data.value || {};
        setQ(typeof value.search === "string" ? value.search : "");
        setSeverity(value.severity === "Info" || value.severity === "Warning" || value.severity === "Critical" ? value.severity : "All");
        setActionType(typeof value.actionType === "string" && value.actionType.length > 0 ? value.actionType : "All");
        setVisibleColumnKeys(
          Array.isArray(value.visibleColumns)
            ? value.visibleColumns.filter((item): item is string => typeof item === "string" && item.length > 0)
            : DEFAULT_VISIBLE_COLUMNS
        );
        setExportFormat(value.exportFormat === "xlsx" ? "xlsx" : "csv");
        setPagination((prev) => ({
          ...prev,
          current: 1,
          pageSize: typeof value.pageSize === "number" ? value.pageSize : prev.pageSize,
        }));

        if (typeof value.dateFrom === "string" && typeof value.dateTo === "string") {
          const nextFrom = dayjs(value.dateFrom);
          const nextTo = dayjs(value.dateTo);
          if (nextFrom.isValid() && nextTo.isValid()) {
            setDateRange([nextFrom, nextTo]);
          }
        }
      } catch {
        // Keep the page usable even if preference loading fails.
      } finally {
        if (active) {
          preferenceLoadedRef.current = true;
          setPreferencesReady(true);
        }
      }
    }

    loadPreference();
    return () => {
      active = false;
    };
  }, []);

  const loadAuditLogs = useCallback(
    async (page = 1, pageSize = 10) => {
      setMode("loading");
      setError(null);
      setUnauthorized(false);

      try {
        const params: Record<string, string | number | undefined> = {
          page,
          page_size: pageSize,
          search: q.trim() || undefined,
          action: actionType === "All" ? undefined : actionType,
        };

        if (dateRange?.[0]) {
          params.from = dateRange[0].toISOString();
        }
        if (dateRange?.[1]) {
          params.to = dateRange[1].toISOString();
        }

        const res = await listAuditLogs(params);
        if (isApiError(res)) {
          setError(res.message || "Failed to load audit logs.");
          setMode("error");
          return;
        }

        const items = res.data.items || [];
        const mapped = items.map(toAuditRow);
        setRows(mapped);
        setPagination((prev) => ({
          ...prev,
          current: res.data.page ?? page,
          pageSize: res.data.page_size ?? pageSize,
          total: res.data.count ?? mapped.length,
        }));
        setMode(mapped.length === 0 ? "empty" : "ok");
      } catch (err: any) {
        if (err?.response?.status === 403) {
          setUnauthorized(true);
          return;
        }
        setError("Failed to load audit logs.");
        setMode("error");
      }
    },
    [q, actionType, dateRange]
  );

  useEffect(() => {
    if (!preferencesReady) return;
    loadAuditLogs(pagination.current || 1, pagination.pageSize || 10);
  }, [preferencesReady, loadAuditLogs, pagination.current, pagination.pageSize]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, [q, actionType, dateRange, severity]);

  useEffect(() => {
    if (!preferenceLoadedRef.current) return;

    if (preferenceSaveTimeoutRef.current) {
      window.clearTimeout(preferenceSaveTimeoutRef.current);
    }

    preferenceSaveTimeoutRef.current = window.setTimeout(async () => {
      setSavingPreference(true);
      try {
        await saveUserPreference(PREFERENCE_SCOPE, PREFERENCE_KEY, {
          search: q,
          severity,
          actionType,
          pageSize: pagination.pageSize || 10,
          visibleColumns: visibleColumnKeys,
          exportFormat,
          dateFrom: dateRange?.[0]?.toISOString() || null,
          dateTo: dateRange?.[1]?.toISOString() || null,
        });
      } catch {
        // Preference persistence should not block the page.
      } finally {
        setSavingPreference(false);
      }
    }, 400);

    return () => {
      if (preferenceSaveTimeoutRef.current) {
        window.clearTimeout(preferenceSaveTimeoutRef.current);
      }
    };
  }, [q, severity, actionType, dateRange, visibleColumnKeys, exportFormat, pagination.pageSize]);

  async function exportLogs() {
    try {
      const params: Record<string, string | number | undefined> = {
        search: q.trim() || undefined,
        action: actionType === "All" ? undefined : actionType,
        file_format: exportFormat,
      };

      if (dateRange?.[0]) {
        params.from = dateRange[0].toISOString();
      }
      if (dateRange?.[1]) {
        params.to = dateRange[1].toISOString();
      }

      const blob = await exportAuditLogs(params);
      triggerBlobDownload(blob, `audit_logs_${new Date().toISOString().slice(0, 10)}.${exportFormat}`);
      message.success(`Exported ${exportFormat.toUpperCase()}.`);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      message.error(`Failed to export ${exportFormat.toUpperCase()}.`);
    }
  }

  const allColumns: ColumnsType<AuditRow> = [
    {
      title: t("admin.dashboard.time"),
      dataIndex: "timestamp",
      key: "timestamp",
      width: 220,
      render: (v: string) => (
        <Typography.Text title={v}>
          {formatAuditTimestamp(v, language)}
        </Typography.Text>
      ),
    },
    { title: t("admin.dashboard.actor"), dataIndex: "actorEmail", key: "actorEmail", render: (v) => <Typography.Text strong>{v}</Typography.Text>, width: 200 },
    { title: t("admin.dashboard.action"), dataIndex: "action", key: "action", render: (v) => <Tag>{t(`audit.action.${v}`, v)}</Tag>, width: 180 },
    { title: "Target", dataIndex: "target", key: "target" },
    { title: t("admin.dashboard.severity"), dataIndex: "severity", key: "severity", render: (v: AuditSeverity) => severityTag(v), width: 120 },
    { title: "IP", dataIndex: "ip", key: "ip", width: 140 },
  ];
  const columns = useMemo(
    () => allColumns.filter((column) => visibleColumnKeys.includes(String(column.key))),
    [allColumns, visibleColumnKeys]
  );
  const columnOptions = [
    { label: t("admin.dashboard.time"), value: "timestamp" },
    { label: t("admin.dashboard.actor"), value: "actorEmail" },
    { label: t("admin.dashboard.action"), value: "action" },
    { label: "Target", value: "target" },
    { label: t("admin.dashboard.severity"), value: "severity" },
    { label: "IP", value: "ip" },
  ];
  const columnsPopoverContent = (
    <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 12 }}>
      <Typography.Text strong>{t("common.columns", "Columns")}</Typography.Text>
      <Checkbox.Group
        options={columnOptions}
        value={visibleColumnKeys}
        onChange={(values) => {
          const selected = values.map(String);
          if (selected.length > 0) {
            setVisibleColumnKeys(selected);
          }
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {savingPreference ? t("common.saving", "Saving...") : t("common.saved", "Saved automatically")}
      </Typography.Text>
    </div>
  );

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title={t("loading.generic")} />;
  if (mode === "error") return <ErrorState title={t("admin.audit.title")} description={error || t("common.tryAgain")} onRetry={() => loadAuditLogs(pagination.current || 1, pagination.pageSize || 10)} />;
  if (mode === "empty" || (mode === "ok" && rows.length === 0)) return <EmptyState title={t("admin.audit.title")} description={t("common.noData")} />;

  return (
    <div>
      <PageHeader
        title={t("admin.audit.title")}
        subtitle={t("layout.auditLogs")}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => loadAuditLogs(1, pagination.pageSize || 10)}>{t("common.refresh")}</Button>
            <Popover content={columnsPopoverContent} trigger="click" placement="bottomRight">
              <Button icon={<SettingOutlined />}>{t("common.columns", "Columns")}</Button>
            </Popover>
            <Select
              value={exportFormat}
              onChange={setExportFormat}
              style={{ width: 110 }}
              options={[
                { label: "CSV", value: "csv" },
                { label: "XLSX", value: "xlsx" },
              ]}
            />
            <Button icon={<DownloadOutlined />} onClick={exportLogs}>{t("common.export")} {exportFormat.toUpperCase()}</Button>
          </Space>
        }
      />

      <Card style={{ borderRadius: 16 }}>
        <div className="responsive-filter-bar" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Input allowClear placeholder={t("admin.audit.searchPlaceholder")} style={{ flex: "1 1 200px", minWidth: 150 }} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={severity} onChange={setSeverity} style={{ flex: "0 1 160px", minWidth: 120 }} options={[
            { label: t("common.filter"), value: "All" },
            { label: t("status.info"), value: "Info" },
            { label: t("status.warning"), value: "Warning" },
            { label: t("status.critical"), value: "Critical" },
          ]} />
          <Select value={actionType} onChange={setActionType} style={{ flex: "0 1 200px", minWidth: 140 }} options={[
            { label: t("common.filter"), value: "All" },
            ...actionOptions.map((a) => ({ label: t(`audit.action.${a}`, a), value: a })),
          ]} />
          <RangePicker value={dateRange} onChange={(v) => setDateRange(v as AuditDateRange)} placeholder={[t("leave.startDate"), t("leave.endDate")]} style={{ flex: "0 1 280px" }} />
        </div>
        <div style={{ marginTop: 16 }}>
          <Table<AuditRow>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            scroll={{ x: 900 }}
            pagination={{ current: pagination.current, pageSize: pagination.pageSize, total: pagination.total, showSizeChanger: true }}
            onChange={(pager) => setPagination((prev) => ({ ...prev, current: pager.current, pageSize: pager.pageSize }))}
          />
        </div>
      </Card>
    </div>
  );
}
