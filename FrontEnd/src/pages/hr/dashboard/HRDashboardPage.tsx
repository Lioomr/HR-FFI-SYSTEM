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
import { getPendingRequests } from "../../../services/api/pendingRequestsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import AnnouncementWidget from "../../../components/announcements/AnnouncementWidget";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";

export default function HRDashboardPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const user = useAuthStore((state) => state.user);
    const isHeadOffice = isHeadOfficeOrganization(user);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [summary, setSummary] = useState<HRSummary | null>(null);
    const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

    const loadSummary = async () => {
        setLoading(true);
        setError(null);
        setForbidden(false);
        try {
            const [response, pendingResponse] = await Promise.all([
                getHrSummary(),
                getPendingRequests({ page: 1, page_size: 1 }),
            ]);
            if (isApiError(response)) {
                setError(response.message || t("error.loadDashboard"));
                setLoading(false);
                return;
            }
            if (!isApiError(pendingResponse)) {
                setPendingRequestsCount(pendingResponse.data.count || 0);
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
                        onClick={() => navigate("/hr/employees")}
                        animDelay={0}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        title={t("hr.dashboard.activePayroll")}
                        value={
                            summary?.latest_payroll?.latest_total_net ? (
                                <AmountWithSAR
                                    amount={(summary.latest_payroll.latest_total_net / 1000).toFixed(0)}
                                    size={20}
                                    suffix="k"
                                />
                            ) : "N/A"
                        }
                        icon={<DollarOutlined />}
                        color="#94a3b8"
                        trend={
                            summary?.latest_payroll?.trend_percentage
                                ? `${summary.latest_payroll.trend_percentage > 0 ? "+" : ""}${summary.latest_payroll.trend_percentage}%`
                                : null
                        }
                        onClick={() => navigate("/hr/payroll")}
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
                        title={t("pendingInbox.title", "Pending Requests")}
                        value={pendingRequestsCount}
                        icon={<ScheduleOutlined />}
                        color="#8b5cf6"
                        trend={null}
                        onClick={() => navigate("/pending-inbox")}
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
                            onClick={action.path && !isHeadOffice ? () => navigate(action.path!) : undefined}
                            disabled={isHeadOffice && Boolean(action.path)}
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
                                cursor: action.path && !isHeadOffice ? "pointer" : "not-allowed",
                                transition: "all 0.2s ease",
                                fontFamily: "inherit",
                                opacity: isHeadOffice && action.path ? 0.58 : 1,
                            }}
                            onMouseEnter={(e) => {
                                if (isHeadOffice && action.path) return;
                                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                                (e.currentTarget as HTMLButtonElement).style.filter = "brightness(0.95)";
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                                (e.currentTarget as HTMLButtonElement).style.filter = "none";
                            }}
                            title={isHeadOffice && action.path ? t("organization.headOffice.switchToUseAction") : undefined}
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
                            <Button type="link" onClick={() => navigate("/hr/activity")} style={{ color: "#f97316", padding: 0, fontWeight: 600 }}>
                                {t("common.viewAll")}
                            </Button>
                        </div>
                        <Table
                            dataSource={(summary?.recent_activity || []).slice(0, 5)}
                            pagination={false}
                            scroll={{ x: "max-content" }}
                            size="small"
                            columns={[
                                {
                                    title: t("hr.dashboard.actor", "Actor"),
                                    dataIndex: "employee",
                                    key: "employee",
                                    render: (text: string) => (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <Avatar
                                                size={28}
                                                style={{
                                                    background: `hsl(${(text?.charCodeAt(0) || 0) * 13 % 360}, 65%, 55%)`,
                                                    fontWeight: 700,
                                                    fontSize: 12,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {text?.[0]?.toUpperCase()}
                                            </Avatar>
                                            <span style={{ fontWeight: 500, color: "#0f172a", fontSize: 13 }}>{text}</span>
                                        </div>
                                    ),
                                },
                                {
                                    title: t("hr.dashboard.actionType"),
                                    dataIndex: "action",
                                    key: "action",
                                    render: (text: string) => <span style={{ color: "#64748b", fontSize: 13 }}>{t(`audit.action.${text}`, text.replace(/_/g, ' '))}</span>,
                                },
                                {
                                    title: t("hr.dashboard.dateTime"),
                                    dataIndex: "date",
                                    key: "date",
                                    render: (text: string) => <span style={{ color: "#94a3b8", fontSize: 13 }}>{text}</span>,
                                },
                                ...(isHeadOffice
                                    ? [
                                        {
                                            title: t("common.company", "Company"),
                                            dataIndex: "company_name",
                                            key: "company_name",
                                            render: (value?: string | null) =>
                                                value ? (
                                                    <Tag color="blue" style={{ borderRadius: 20, fontWeight: 600, fontSize: 11 }}>
                                                        {value}
                                                    </Tag>
                                                ) : (
                                                    "-"
                                                ),
                                        },
                                    ]
                                    : []),
                                {
                                    title: t("common.details", "Details"),
                                    dataIndex: "status",
                                    key: "status",
                                    render: (text: string, record: any) => {
                                        let display = text;
                                        const match = text.match(/^(.*?)( \(#.*\))?$/);
                                        if (match) {
                                            const entity = match[1];
                                            const suffix = match[2] || '';
                                            display = t(`audit.entity.${entity}`, entity) + suffix;
                                        }
                                        return (
                                            <Tag color={record.statusColor} style={{ borderRadius: 20, padding: "2px 10px", border: 0, fontWeight: 600, fontSize: 11 }}>
                                                {display}
                                            </Tag>
                                        );
                                    },
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
                                                            <Tag color={item.request_type === "ATTENDANCE" ? "gold" : item.request_type === "LOAN" ? "geekblue" : "purple"} style={{ borderRadius: 20, fontSize: 11 }}>
                                                                {item.request_type}
                                                            </Tag>
                                                            {isHeadOffice && item.company_name ? (
                                                                <Tag color="blue" style={{ borderRadius: 20, fontSize: 11, marginInlineStart: 6 }}>
                                                                    {item.company_name}
                                                                </Tag>
                                                            ) : null}
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
