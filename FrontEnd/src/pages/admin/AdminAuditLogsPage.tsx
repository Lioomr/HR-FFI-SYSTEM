import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import { exportAuditLogs, listAuditLogs } from "../../services/api/auditApi";
import { isApiError } from "../../services/api/apiTypes";
import type { AuditLogDto } from "../../services/api/apiTypes";

const { RangePicker } = DatePicker;

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
  const [mode, setMode] = useState<UiMode>("loading");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<"All" | AuditSeverity>("All");
  const [actionType, setActionType] = useState<"All" | string>("All");
  const [dateRange, setDateRange] = useState<any>(null);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const filtered = useMemo(() => {
    if (severity === "All") return rows;
    return rows.filter((r) => r.severity === severity);
  }, [rows, severity]);

  const actionOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.map((r) => r.action))).sort();
    return unique;
  }, [rows]);

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
    loadAuditLogs(pagination.current || 1, pagination.pageSize || 10);
  }, [loadAuditLogs, pagination.current, pagination.pageSize]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, current: 1 }));
  }, [q, actionType, dateRange]);

  async function exportCsv() {
    try {
      const params: Record<string, string | number | undefined> = {
        search: q.trim() || undefined,
        action: actionType === "All" ? undefined : actionType,
      };

      if (dateRange?.[0]) {
        params.from = dateRange[0].toISOString();
      }
      if (dateRange?.[1]) {
        params.to = dateRange[1].toISOString();
      }

      const blob = await exportAuditLogs(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("Exported CSV.");
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      message.error("Failed to export CSV.");
    }
  }

  const columns: ColumnsType<AuditRow> = [
    { title: "Time", dataIndex: "timestamp", key: "timestamp", width: 190 },
    {
      title: "Actor",
      dataIndex: "actorEmail",
      key: "actorEmail",
      render: (v) => <Typography.Text strong>{v}</Typography.Text>,
      width: 200,
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
      render: (v) => <Tag>{v}</Tag>,
      width: 180,
    },
    { title: "Target", dataIndex: "target", key: "target" },
    {
      title: "Severity",
      dataIndex: "severity",
      key: "severity",
      render: (v: AuditSeverity) => severityTag(v),
      width: 120,
    },
    { title: "IP", dataIndex: "ip", key: "ip", width: 140 },
  ];

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title="Loading audit logs..." />;
  if (mode === "error") {
    return (
      <ErrorState
        title="Failed to load audit logs"
        description={error || "Please try again."}
        onRetry={() => loadAuditLogs(pagination.current || 1, pagination.pageSize || 10)}
      />
    );
  }

  if (mode === "empty" || (mode === "ok" && rows.length === 0)) {
    return (
      <EmptyState
        title="No audit logs"
        description="Audit logs will appear here once sensitive actions occur."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="Track sensitive actions (Phase 1)"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => loadAuditLogs(1, pagination.pageSize || 10)}>
              Refresh
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportCsv}>
              Export CSV
            </Button>
          </Space>
        }
      />

      <Card style={{ borderRadius: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Space wrap>
            <Input
              allowClear
              placeholder="Search actor/action/target/ip..."
              style={{ width: 280 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <Select
              value={severity}
              onChange={setSeverity}
              style={{ width: 160 }}
              options={[
                { label: "All severity", value: "All" },
                { label: "Info", value: "Info" },
                { label: "Warning", value: "Warning" },
                { label: "Critical", value: "Critical" },
              ]}
            />

            <Select
              value={actionType}
              onChange={setActionType}
              style={{ width: 200 }}
              options={[
                { label: "All actions", value: "All" },
                ...actionOptions.map((a) => ({ label: a, value: a })),
              ]}
            />

            <RangePicker onChange={(v) => setDateRange(v)} placeholder={["From", "To"]} />
          </Space>

          <Space wrap></Space>
        </Space>

        <div style={{ marginTop: 16 }}>
          <Table<AuditRow>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showSizeChanger: true,
            }}
            onChange={(pager) => {
              setPagination((prev) => ({
                ...prev,
                current: pager.current,
                pageSize: pager.pageSize,
              }));
            }}
          />
        </div>
      </Card>
    </div>
  );
}
