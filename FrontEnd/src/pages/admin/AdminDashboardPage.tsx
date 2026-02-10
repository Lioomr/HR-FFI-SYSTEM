import { useCallback, useEffect, useState } from "react";
import { Card, Col, Row, Button, Table, Space, Tag, Avatar } from "antd";
import {
  TeamOutlined,
  UserAddOutlined,
  SettingOutlined,
  MailOutlined,
  UserSwitchOutlined,
  BellOutlined,
  ArrowUpOutlined,
  ClusterOutlined,
  SecurityScanOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import { getAdminSummary } from "../../services/api/adminApi";
import { listAuditLogs } from "../../services/api/auditApi";
import { isApiError, type AdminSummary } from "../../services/api/apiTypes";
import { isForbidden } from "../../services/api/httpErrors";

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
  const navigate = useNavigate();
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
      // Use centralized error helper instead of hardcoded status check
      if (isForbidden(err)) {
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

  const StatCard = ({ title, value, icon, color, trend }: any) => (
    <Card bordered={false} style={{ borderRadius: 12, height: '100%' }} bodyStyle={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: '#8c8c8c', fontSize: 14, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>{value}</div>
          {trend && (
            <div style={{ color: '#52c41a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <ArrowUpOutlined /> {trend} <span style={{ color: '#bfbfbf' }}>vs last week</span>
            </div>
          )}
        </div>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${color}15`, color: color, fontSize: 20
        }}>
          {icon}
        </div>
      </div>
    </Card>
  );

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto" }}>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Admin Dashboard</h2>

      {/* Stats Row */}
      <Row gutter={[24, 24]} style={{ marginBottom: 32 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Total Users"
            value={summary.users.total.toLocaleString()}
            icon={<TeamOutlined />}
            color="#1890ff"
            trend={summary.users.total_growth_pct > 0 ? `+${summary.users.total_growth_pct}%` : `${summary.users.total_growth_pct}%`}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Active Users"
            value={summary.users.active.toLocaleString()}
            icon={<UserSwitchOutlined />}
            color="#52c41a"
            trend={null}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Pending Invites"
            value={summary.invites.sent.toLocaleString()}
            icon={<MailOutlined />}
            color="#722ed1"
            trend={null}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Audit Events (24h)"
            value={summary.audit.today.toLocaleString()}
            icon={<SecurityScanOutlined />}
            color="#faad14"
            trend={null}
          />
        </Col>
      </Row>

      {/* Quick Actions */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Quick Actions</h3>
        <Space size={16} wrap>
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            size="large"
            style={{ background: '#ff7a45', borderColor: '#ff7a45', borderRadius: 8, height: 48, paddingLeft: 24, paddingRight: 24 }}
            onClick={() => navigate('/admin/users')}
          >
            Invite Users
          </Button>
          <Button
            icon={<TeamOutlined />}
            size="large"
            style={{ borderRadius: 8, height: 48, paddingLeft: 24, paddingRight: 24 }}
            onClick={() => navigate('/admin/users')}
          >
            Manage Users
          </Button>
          <Button
            icon={<SettingOutlined />}
            size="large"
            style={{ borderRadius: 8, height: 48, paddingLeft: 24, paddingRight: 24 }}
            onClick={() => navigate('/admin/settings')}
          >
            Settings
          </Button>
        </Space>
      </div>

      <Row gutter={[24, 24]}>
        {/* Main Content: Recent Audit Activity */}
        <Col xs={24} lg={16}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Recent System Activity</h3>
            <Button type="link" onClick={() => navigate("/admin/audit")} style={{ color: '#ff7a45' }}>View All Audit Logs</Button>
          </div>
          <Card bordered={false} style={{ borderRadius: 16, overflow: 'hidden' }} bodyStyle={{ padding: 0 }}>
            <Table
              dataSource={auditPreview}
              pagination={false}
              scroll={{ x: 600 }}
              rowKey="id"
              columns={[
                {
                  title: 'ACTOR', dataIndex: 'actor', key: 'actor', render: (text) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar style={{ backgroundColor: '#f56a00' }}>{text[0]?.toUpperCase()}</Avatar>
                      <span style={{ fontWeight: 500 }}>{text}</span>
                    </div>
                  )
                },
                {
                  title: 'ACTION', dataIndex: 'action', key: 'action', render: (t) => (
                    <span style={{ fontWeight: 500 }}>{t}</span>
                  )
                },
                { title: 'TIME', dataIndex: 'time', key: 'time', render: (t) => <span style={{ color: '#8c8c8c' }}>{t}</span> },
                {
                  title: 'SEVERITY', dataIndex: 'severity', key: 'severity', render: severityTag
                },
              ]}
            />
          </Card>
        </Col>

        {/* Sidebar: Invite Statistics */}
        <Col xs={24} lg={8}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Invite Statistics</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>

            {/* Expired Invites */}
            <Card bordered={false} style={{ borderRadius: 12 }} bodyStyle={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: '#ffccc7', color: '#cf1322'
                }}>
                  <BellOutlined style={{ fontSize: 18 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: '#8c8c8c' }}>Expired Invites</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{summary.invites.expired}</div>
                </div>
              </div>
            </Card>

            {/* Accepted Invites */}
            <Card bordered={false} style={{ borderRadius: 12 }} bodyStyle={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: '#d9f7be', color: '#389e0d'
                }}>
                  <TeamOutlined style={{ fontSize: 18 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: '#8c8c8c' }}>Accepted Invites</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{summary.invites.accepted}</div>
                </div>
              </div>
            </Card>

            {/* Top Actions Breakdown */}
            {summary.audit.top_actions_today && (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 16 }}>Top Actions (Today)</h3>
                <Card bordered={false} style={{ borderRadius: 12 }} bodyStyle={{ padding: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {summary.audit.top_actions_today.slice(0, 3).map((item, idx) => (
                      <div key={idx} style={{
                        display: 'flex', justifyContent: 'space-between', padding: '12px 16px',
                        borderBottom: idx < (summary.audit.top_actions_today?.length || 0) - 1 ? '1px solid #f0f0f0' : 'none'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ClusterOutlined style={{ color: '#1890ff' }} />
                          <span>{item.action}</span>
                        </div>
                        <Tag>{item.count}</Tag>
                      </div>
                    ))}
                    {(summary.audit.top_actions_today.length === 0) && (
                      <div style={{ padding: 16, color: '#8c8c8c', textAlign: 'center' }}>No actions recorded today</div>
                    )}
                  </div>
                </Card>
              </>
            )}

          </div>
        </Col>
      </Row>
    </div>
  );
}
