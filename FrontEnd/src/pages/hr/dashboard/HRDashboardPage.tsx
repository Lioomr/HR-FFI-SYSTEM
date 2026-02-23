import { useEffect, useState } from "react";
import { Col, Row, Button, Table, Avatar, Space, Tag } from "antd";
import {
    TeamOutlined,
    DollarOutlined,
    FileExclamationOutlined,
    ScheduleOutlined,
    UserAddOutlined,
    UploadOutlined,
    PlayCircleOutlined,
    FileTextOutlined,
    UserOutlined
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import StatCard from "../../../components/ui/StatCard";
import Unauthorized403Page from "../../Unauthorized403Page";
import { getHrSummary } from "../../../services/api/hrSummaryApi";
import type { HRSummary } from "../../../services/api/hrSummaryApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import AnnouncementWidget from "../../../components/announcements/AnnouncementWidget";
import SARIcon from "../../../components/icons/SARIcon";
import { useI18n } from "../../../i18n/useI18n";

export default function HRDashboardPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [summary, setSummary] = useState<HRSummary | null>(null);

    const loadSummary = async () => {
        setLoading(true);
        setError(null);
        setForbidden(false);
        try {
            const response = await getHrSummary();
            if (isApiError(response)) {
                setError(response.message || t("error.loadDashboard"));
                setLoading(false);
                return;
            }
            setSummary(response.data);
            setLoading(false);
        } catch (err: any) {
            if (isForbidden(err)) { setForbidden(true); setLoading(false); return; }
            setError(err.message || t("error.loadDashboard"));
            setLoading(false);
        }
    };

    useEffect(() => { loadSummary(); }, []);

    if (forbidden) return <Unauthorized403Page />;
    if (loading) return <LoadingState title={t("loading.dashboard")} />;
    if (error) return <ErrorState title={t("error.loadDashboard")} description={error} onRetry={loadSummary} />;

    // ─── Quick Action data ──────────────────────────────────────────────────────
    const quickActions = [
        { label: t("hr.dashboard.addEmployee"), icon: <UserAddOutlined />, color: "#f97316", bgColor: "#fff4e6", path: "/hr/employees/create" },
        { label: t("hr.dashboard.uploadExcel"), icon: <UploadOutlined />, color: "#94a3b8", bgColor: "#f1f5f9", path: "/hr/import/employees" },
        { label: t("hr.dashboard.runPayroll"), icon: <PlayCircleOutlined />, color: "#10b981", bgColor: "#d1fae5", path: "/hr/payroll" },
        { label: t("hr.dashboard.reports"), icon: <FileTextOutlined />, color: "#f59e0b", bgColor: "#fef3c7", path: undefined },
    ];

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto" }}>

            {/* ─── Stat Cards ───────────────────────────────────────────────────── */}
            <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title={t("hr.dashboard.totalEmployees")}
                        value={(summary?.total_employees || 0).toLocaleString()}
                        icon={<TeamOutlined />}
                        color="#f97316"
                        trend="+5%"
                        animDelay={0}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title={t("hr.dashboard.activePayroll")}
                        value={
                            summary?.latest_payroll?.latest_total_net ? (
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    {(summary.latest_payroll.latest_total_net / 1000).toFixed(0)}k
                                    <SARIcon size={20} />
                                </span>
                            ) : "N/A"
                        }
                        icon={<DollarOutlined />}
                        color="#94a3b8"
                        trend={
                            summary?.latest_payroll?.trend_percentage
                                ? `${summary.latest_payroll.trend_percentage > 0 ? "+" : ""}${summary.latest_payroll.trend_percentage}%`
                                : null
                        }
                        animDelay={80}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title={t("hr.dashboard.expiringDocs")}
                        value={summary?.expiring_docs || 0}
                        icon={<FileExclamationOutlined />}
                        color="#f59e0b"
                        trend={null}
                        onClick={() => navigate("/hr/employees/expiries")}
                        animDelay={160}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title={t("hr.dashboard.pendingLeave")}
                        value={summary?.pending_leaves || 0}
                        icon={<ScheduleOutlined />}
                        color="#8b5cf6"
                        trend={null}
                        onClick={() => navigate("/hr/leave/requests")}
                        animDelay={240}
                    />
                </Col>
            </Row>

            {/* ─── Quick Actions ──────────────────────────────────────────────────── */}
            <div
                style={{
                    background: "white",
                    borderRadius: 16,
                    padding: "20px 24px",
                    marginBottom: 28,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    animation: "fadeInUp 0.5s ease 0.3s both",
                }}
            >
                <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", marginBottom: 16 }}>
                    {t("hr.dashboard.quickActions")}
                </div>
                <Space size={12} wrap>
                    {quickActions.map((action, i) => (
                        <button
                            key={i}
                            onClick={action.path ? () => navigate(action.path!) : undefined}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 10,
                                background: action.bgColor,
                                color: action.color,
                                border: "none",
                                borderRadius: 12,
                                padding: "10px 20px",
                                fontWeight: 600,
                                fontSize: 14,
                                cursor: action.path ? "pointer" : "default",
                                transition: "all 0.2s ease",
                                fontFamily: "inherit",
                            }}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                                (e.currentTarget as HTMLButtonElement).style.filter = "brightness(0.95)";
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                                (e.currentTarget as HTMLButtonElement).style.filter = "none";
                            }}
                        >
                            <span style={{ fontSize: 16 }}>{action.icon}</span>
                            {action.label}
                        </button>
                    ))}
                </Space>
            </div>

            {/* ─── Main Grid ─────────────────────────────────────────────────────── */}
            <Row gutter={[20, 20]}>
                {/* Recent Activity */}
                <Col xs={24} lg={16}>
                    <div
                        style={{
                            background: "white",
                            borderRadius: 16,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                            overflow: "hidden",
                            animation: "fadeInUp 0.5s ease 0.35s both",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "18px 24px",
                                borderBottom: "1px solid #f1f5f9",
                            }}
                        >
                            <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                                {t("hr.dashboard.recentActivity")}
                            </span>
                            <Button type="link" style={{ color: "#f97316", padding: 0, fontWeight: 600 }}>
                                {t("common.viewAll")}
                            </Button>
                        </div>
                        <Table
                            dataSource={summary?.recent_activity || []}
                            pagination={false}
                            scroll={{ x: 600 }}
                            size="middle"
                            columns={[
                                {
                                    title: t("hr.dashboard.employee"),
                                    dataIndex: "employee",
                                    key: "employee",
                                    render: (text: string) => (
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <Avatar
                                                size={32}
                                                style={{
                                                    background: `hsl(${(text?.charCodeAt(0) || 0) * 13 % 360}, 65%, 55%)`,
                                                    fontWeight: 700,
                                                    fontSize: 13,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {text?.[0]?.toUpperCase()}
                                            </Avatar>
                                            <span style={{ fontWeight: 500, color: "#0f172a" }}>{text}</span>
                                        </div>
                                    ),
                                },
                                {
                                    title: t("hr.dashboard.actionType"),
                                    dataIndex: "action",
                                    key: "action",
                                    render: (text: string) => <span style={{ color: "#64748b", fontSize: 13 }}>{text}</span>,
                                },
                                {
                                    title: t("hr.dashboard.dateTime"),
                                    dataIndex: "date",
                                    key: "date",
                                    render: (text: string) => <span style={{ color: "#94a3b8", fontSize: 13 }}>{text}</span>,
                                },
                                {
                                    title: t("common.status"),
                                    dataIndex: "status",
                                    key: "status",
                                    render: (text: string, record: any) => (
                                        <Tag color={record.statusColor} style={{ borderRadius: 20, padding: "2px 10px", border: 0, fontWeight: 600, fontSize: 11 }}>
                                            {text}
                                        </Tag>
                                    ),
                                },
                            ]}
                        />
                    </div>
                </Col>

                {/* Sidebar */}
                <Col xs={24} lg={8}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <div style={{ animation: "fadeInUp 0.5s ease 0.4s both" }}>
                            <AnnouncementWidget role="hr" />
                        </div>

                        <div
                            style={{
                                background: "white",
                                borderRadius: 16,
                                overflow: "hidden",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                                animation: "fadeInUp 0.5s ease 0.45s both",
                            }}
                        >
                            <div style={{ padding: "18px 20px", borderBottom: "1px solid #f1f5f9" }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                                    {t("hr.dashboard.pendingApprovals")}
                                </span>
                            </div>

                            <div style={{ padding: 16 }}>
                                {(summary?.pending_approvals || []).length === 0 ? (
                                    <div style={{ textAlign: "center", color: "#94a3b8", padding: "20px 0", fontSize: 14 }}>
                                        {t("common.noPendingApprovals")}
                                    </div>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                        {summary?.pending_approvals?.map((item) => (
                                            <div
                                                key={item.id}
                                                style={{
                                                    padding: 14,
                                                    borderRadius: 12,
                                                    background: "#f8faff",
                                                    border: "1px solid #e8edf5",
                                                }}
                                            >
                                                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                                                    <Avatar src={item.avatar} size={36} icon={<UserOutlined />} />
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                                            <span style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
                                                            <span style={{ fontSize: 11, color: "#94a3b8" }}>{item.time}</span>
                                                        </div>
                                                        <div style={{ marginTop: 4 }}>
                                                            <Tag color={item.request_type === "ATTENDANCE" ? "gold" : "purple"} style={{ borderRadius: 20, fontSize: 11 }}>
                                                                {item.request_type}
                                                            </Tag>
                                                        </div>
                                                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{item.action}</div>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="primary"
                                                    size="small"
                                                    block
                                                    style={{ borderRadius: 8 }}
                                                    onClick={() => navigate(item.review_path)}
                                                >
                                                    {t("common.review")}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </Col>
            </Row>
        </div>
    );
}
