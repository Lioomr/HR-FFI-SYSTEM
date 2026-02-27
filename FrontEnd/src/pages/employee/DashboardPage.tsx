import { useEffect, useState } from "react";
import { Col, Row, Statistic } from "antd";
import {
    CalendarOutlined,
    FileTextOutlined,
    ClockCircleOutlined,
    UserOutlined,
    ArrowRightOutlined,
    ApartmentOutlined,
    IdcardOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { getEmployee } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import AnnouncementWidget from "../../components/announcements/AnnouncementWidget";
import { useI18n } from "../../i18n/useI18n";

export default function DashboardPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [employee, setEmployee] = useState<Employee | null>(null);

    useEffect(() => {
        getEmployee("me").then((res) => {
            if (res.status === "success") setEmployee(res.data);
        }).catch(() => { });
    }, []);

    const actions = [
        {
            title: t("employee.dashboard.checkInOut"),
            icon: <ClockCircleOutlined />,
            description: t("employee.dashboard.checkInDesc"),
            link: "/employee/attendance",
            btnText: t("employee.dashboard.goAttendance"),
            color: "#f97316",
            bgFrom: "#fff4e6",
            bgTo: "#ffedd5",
        },
        {
            title: t("employee.dashboard.myLeaves"),
            icon: <CalendarOutlined />,
            description: t("employee.dashboard.myLeavesDesc"),
            link: "/employee/leave/requests",
            btnText: t("employee.dashboard.manageLeaves"),
            color: "#10b981",
            bgFrom: "#d1fae5",
            bgTo: "#a7f3d0",
        },
        {
            title: t("employee.dashboard.myPayslips"),
            icon: <FileTextOutlined />,
            description: t("employee.dashboard.myPayslipsDesc"),
            link: "/employee/payslips",
            btnText: t("employee.dashboard.viewPayslips"),
            color: "#94a3b8",
            bgFrom: "#f1f5f9",
            bgTo: "#e2e8f0",
        },
        {
            title: t("employee.dashboard.myProfile"),
            icon: <UserOutlined />,
            description: t("employee.dashboard.myProfileDesc"),
            link: "/employee/profile",
            btnText: t("employee.dashboard.viewProfile"),
            color: "#f59e0b",
            bgFrom: "#fef3c7",
            bgTo: "#fde68a",
        },
    ];

    const displayName = employee?.full_name_en || employee?.full_name || "";

    return (
        <div>
            {/* ─── Hero Welcome Banner ─────────────────────────────────────────────── */}
            <div
                style={{
                    background: "linear-gradient(135deg, #f97316 0%, #ea580c 50%, #fb923c 100%)",
                    borderRadius: 20,
                    padding: "28px 32px",
                    marginBottom: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 20,
                    boxShadow: "0 12px 32px rgba(249,115,22,0.35)",
                    animation: "fadeInUp 0.5s ease both",
                    position: "relative",
                    overflow: "hidden",
                }}
            >
                {/* Background decorative circles */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                    <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "rgba(255,255,255,0.04)", top: -100, right: -80 }} />
                    <div style={{ position: "absolute", width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.04)", bottom: -80, left: -40 }} />
                </div>

                <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 500, marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        {t("employee.dashboard.welcome")}
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "white", letterSpacing: "-0.03em", marginBottom: 8, fontFamily: "'Outfit', 'Inter', sans-serif" }}>
                        {displayName ? `${displayName} 👋` : t("employee.dashboard.welcome")}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 14 }}>
                        {t("employee.dashboard.subtitle")}
                    </div>
                </div>

                {/* Quick info chips */}
                <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {[
                        { icon: <ApartmentOutlined />, label: employee?.department || "—" },
                        { icon: <IdcardOutlined />, label: employee?.position || "—" },
                    ].map((chip, i) => (
                        <div
                            key={i}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                background: "rgba(255,255,255,0.15)",
                                backdropFilter: "blur(8px)",
                                padding: "8px 16px",
                                borderRadius: 30,
                                color: "white",
                                fontSize: 13,
                                fontWeight: 500,
                                border: "1px solid rgba(255,255,255,0.2)",
                            }}
                        >
                            {chip.icon}
                            {chip.label}
                        </div>
                    ))}
                </div>
            </div>

            {/* ─── Action Cards ──────────────────────────────────────────────────────── */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                {actions.map((action, index) => (
                    <Col xs={24} sm={12} md={6} key={index}>
                        <div
                            className="hover-lift animate-fade-in-up"
                            onClick={() => navigate(action.link)}
                            style={{
                                background: "white",
                                borderRadius: 16,
                                padding: "24px 20px",
                                cursor: "pointer",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                                animationDelay: `${index * 80}ms`,
                                height: "100%",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                textAlign: "center",
                                gap: 14,
                            }}
                        >
                            {/* Icon */}
                            <div
                                style={{
                                    width: 56,
                                    height: 56,
                                    borderRadius: 16,
                                    background: `linear-gradient(135deg, ${action.bgFrom}, ${action.bgTo})`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: action.color,
                                    fontSize: 24,
                                }}
                            >
                                {action.icon}
                            </div>

                            {/* Text */}
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 6 }}>
                                    {action.title}
                                </div>
                                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
                                    {action.description}
                                </div>
                            </div>

                            {/* CTA */}
                            <div
                                style={{
                                    marginTop: "auto",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    color: action.color,
                                    fontSize: 13,
                                    fontWeight: 600,
                                }}
                            >
                                {action.btnText} <ArrowRightOutlined style={{ fontSize: 11 }} />
                            </div>
                        </div>
                    </Col>
                ))}
            </Row>

            {/* ─── Bottom Grid: Stats + Announcements ───────────────────────────────── */}
            <Row gutter={[16, 16]}>
                <Col xs={24} lg={8}>
                    <div
                        style={{
                            background: "white",
                            borderRadius: 16,
                            padding: "20px 24px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                            animation: "fadeInUp 0.5s ease 0.35s both",
                        }}
                    >
                        <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 20 }}>
                            {t("employee.dashboard.quickStats")}
                        </div>
                        <Row gutter={[12, 20]}>
                            <Col span={24}>
                                <Statistic
                                    title={<span style={{ fontSize: 12, color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("employee.dashboard.employmentStatus")}</span>}
                                    value={employee?.employment_status || t("status.active")}
                                    valueStyle={{ color: "#10b981", fontWeight: 700, fontSize: 20 }}
                                />
                            </Col>
                            <Col span={12}>
                                <Statistic
                                    title={<span style={{ fontSize: 12, color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("employee.dashboard.department")}</span>}
                                    value={employee?.department || "—"}
                                    valueStyle={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}
                                />
                            </Col>
                            <Col span={12}>
                                <Statistic
                                    title={<span style={{ fontSize: 12, color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("employee.dashboard.position")}</span>}
                                    value={employee?.position || "—"}
                                    valueStyle={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}
                                />
                            </Col>
                        </Row>
                    </div>
                </Col>
                <Col xs={24} lg={16}>
                    <div style={{ animation: "fadeInUp 0.5s ease 0.4s both" }}>
                        <AnnouncementWidget role="employee" />
                    </div>
                </Col>
            </Row>
        </div>
    );
}
