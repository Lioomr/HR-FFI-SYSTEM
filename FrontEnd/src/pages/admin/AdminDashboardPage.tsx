import { useCallback, useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Table, Tag, Typography } from "antd";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import { getAdminSummary } from "../../services/api/adminApi";
import { listAuditLogs } from "../../services/api/auditApi";
import { isApiError, type AdminSummary } from "../../services/api/apiTypes";

type AuditPreview = {
  id: string | number;
  time: string;
  action: string;
  actor: string;
  severity: "Info" | "Warning" | "Critical";
};

type UiMode = "loading" | "error" | "ok";

const severityTag = (s: AuditPreview["severity"]) => {
  if (s === "Critical") return <Tag color="red">Critical</Tag>;
  if (s === "Warning") return <Tag color="gold">Warning</Tag>;
  return <Tag color="blue">Info</Tag>;
};

function inferSeverity(action: string): AuditPreview["severity"] {
  const value = action.toLowerCase();
  if (value.includes("password") || value.includes("reset")) return "Critical";
  if (value.includes("role") || value.includes("status")) return "Warning";
  return "Info";
}

export default function AdminDashboardPage() {
  const [mode, setMode] = useState<UiMode>("loading");
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [auditPreview, setAuditPreview] = useState<AuditPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const loadData = useCallback(async () => {
    setMode("loading");
    setError(null);
    setUnauthorized(false);

    try {
      const [summaryRes, auditRes] = await Promise.all([
        getAdminSummary(),
        listAuditLogs({ limit: 5 }),
      ]);

      if (isApiError(summaryRes)) {
        setError(summaryRes.message || "Failed to load admin summary.");
        setMode("error");
        return;
      }

      const auditItems = !isApiError(auditRes) ? auditRes.data.items ?? [] : [];

      setSummary(summaryRes.data);
      setAuditPreview(
        auditItems.map((item) => ({
          id: item.id,
          time: item.created_at,
          action: item.action,
          actor: item.actor_email ?? "System",
          severity: inferSeverity(item.action),
        }))
      );
      setMode("ok");
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        setUnauthorized(true);
        return;
      }
      setError("Failed to load admin dashboard.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title="Loading dashboard..." />;
  if (mode === "error") {
    return (
      <ErrorState
        title="Failed to load dashboard"
        description={error || "Please try again."}
        onRetry={loadData}
      />
    );
  }

  if (!summary) {
    return (
      <ErrorState
        title="No summary data"
        description="Please try again."
        onRetry={loadData}
      />
    );
  }

  return (
    <div>
      <PageHeader title="Admin Dashboard" subtitle="Overview (Phase 1)" />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card style={{ borderRadius: 16 }}>
            <Statistic title="Total Users" value={summary.users.total} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card style={{ borderRadius: 16 }}>
            <Statistic title="Active Invites" value={summary.invites.sent} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card style={{ borderRadius: 16 }}>
            <Statistic title="Sensitive Actions (24h)" value={summary.audit.today} />
          </Card>
        </Col>

        <Col xs={24}>
          <Card style={{ borderRadius: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Recent Audit Activity
            </Typography.Title>

            <Table
              rowKey="id"
              dataSource={auditPreview}
              pagination={false}
              columns={[
                { title: "Time", dataIndex: "time", key: "time", width: 190 },
                { title: "Action", dataIndex: "action", key: "action", render: (v) => <Tag>{v}</Tag> },
                { title: "Actor", dataIndex: "actor", key: "actor" },
                { title: "Severity", dataIndex: "severity", key: "severity", render: severityTag, width: 120 },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
