import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Col, Grid, Row } from "antd";
import {
    AppstoreOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DollarOutlined,
    InboxOutlined,
    ReloadOutlined,
    TeamOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import PageHeader from "../../components/ui/PageHeader";
import StatCard from "../../components/ui/StatCard";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import DashboardPanel from "../../components/hr/dashboard/DashboardPanel";
import AnnouncementWidget from "../../components/announcements/AnnouncementWidget";
import { getCeoApprovalSummary, type CeoApprovalSummary } from "../../services/api/ceoSummaryApi";
import { useI18n } from "../../i18n/useI18n";
import { useAuthStore } from "../../auth/authStore";
import { getActiveOrganization } from "../../utils/organizationContext";

const { useBreakpoint } = Grid;

interface QueueRow {
    key: string;
    label: string;
    caption: string;
    icon: ReactNode;
    color: string;
    path: string;
    count: number;
    available: boolean;
}

/**
 * Executive approval overview.
 *
 * The page answers one question first — what is waiting on the CEO — and then
 * offers a route into every approval area, whether or not it has a backlog.
 */
export default function CEODashboardPage() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const user = useAuthStore((state) => state.user);
    const activeOrganization = getActiveOrganization(user);

    const [summary, setSummary] = useState<CeoApprovalSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(
        async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);
            setError(null);
            try {
                const result = await getCeoApprovalSummary();
                if (result.allUnavailable) {
                    setError(t("ceo.dashboard.loadFailedHint"));
                    setSummary(null);
                    return;
                }
                setSummary(result);
            } catch (err: any) {
                setError(err?.message || t("ceo.dashboard.loadFailed"));
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [t],
    );

    useEffect(() => {
        void load();
    }, [load]);

    if (loading) return <LoadingState title={t("loading.dashboard")} />;
    if (error) {
        return <ErrorState title={t("ceo.dashboard.loadFailed")} description={error} onRetry={() => load()} />;
    }
    if (!summary) return null;

    const { queues, totalPending } = summary;
    const assetsCount = queues.assetDamage.count + queues.assetReturn.count;
    const assetsAvailable = queues.assetDamage.available || queues.assetReturn.available;

    // One row per approval area, so every area stays reachable even at zero.
    const queueRows: QueueRow[] = [
        {
            key: "leave",
            label: t("ceo.dashboard.queue.leave"),
            caption: t("ceo.dashboard.queue.leaveCaption"),
            icon: <CalendarOutlined aria-hidden />,
            color: "#0ea5e9",
            path: "/ceo/leave/requests",
            count: queues.leave.count,
            available: queues.leave.available,
        },
        {
            key: "loan",
            label: t("ceo.dashboard.queue.loan"),
            caption: t("ceo.dashboard.queue.loanCaption"),
            icon: <DollarOutlined aria-hidden />,
            color: "#10b981",
            path: "/ceo/loan-requests",
            count: queues.loan.count,
            available: queues.loan.available,
        },
        {
            key: "attendance",
            label: t("ceo.dashboard.queue.attendance"),
            caption: t("ceo.dashboard.queue.attendanceCaption"),
            icon: <ClockCircleOutlined aria-hidden />,
            color: "#6366f1",
            path: "/ceo/attendance",
            count: queues.attendance.count,
            available: queues.attendance.available,
        },
        {
            key: "assetDamage",
            label: t("ceo.dashboard.queue.assetDamage"),
            caption: t("ceo.dashboard.queue.assetDamageCaption"),
            icon: <WarningOutlined aria-hidden />,
            color: "#d97706",
            path: "/ceo/assets/damage-reports",
            count: queues.assetDamage.count,
            available: queues.assetDamage.available,
        },
        {
            key: "assetReturn",
            label: t("ceo.dashboard.queue.assetReturn"),
            caption: t("ceo.dashboard.queue.assetReturnCaption"),
            icon: <AppstoreOutlined aria-hidden />,
            color: "#8b5cf6",
            path: "/ceo/assets/return-requests",
            count: queues.assetReturn.count,
            available: queues.assetReturn.available,
        },
        {
            key: "employeeArchive",
            label: t("ceo.dashboard.queue.employeeArchive"),
            caption: t("ceo.dashboard.queue.employeeArchiveCaption"),
            icon: <TeamOutlined aria-hidden />,
            color: "#ef4444",
            path: "/ceo/employees/deletion-requests",
            count: queues.employeeArchive.count,
            available: queues.employeeArchive.available,
        },
    ];

    // Backlog first, largest first; unavailable areas sink to the bottom.
    const prioritizedRows = [...queueRows].sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return b.count - a.count;
    });
    const nothingPending = queueRows.every((row) => !row.available || row.count === 0);

    const statValue = (row: { count: number; available: boolean }) =>
        row.available ? row.count.toLocaleString() : "—";

    const unavailableNote = (available: boolean) =>
        available
            ? undefined
            : {
                  label: t("ceo.dashboard.queueUnavailable"),
                  icon: <WarningOutlined aria-hidden />,
                  tone: "warning" as const,
              };

    const gutter: [number, number] = isMobile ? [12, 12] : [20, 20];

    const headerActions = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
                type="primary"
                icon={<InboxOutlined aria-hidden />}
                onClick={() => navigate("/pending-inbox")}
                style={{ borderRadius: 10, minHeight: 40 }}
            >
                {t("ceo.dashboard.openPendingInbox")}
            </Button>
            <Button
                icon={<ReloadOutlined aria-hidden />}
                loading={refreshing}
                onClick={() => load({ isRefresh: true })}
                aria-label={t("common.refresh")}
                style={{ borderRadius: 10, minHeight: 40 }}
            >
                {t("common.refresh")}
            </Button>
        </div>
    );

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
            <PageHeader
                title={t("ceo.dashboard.title")}
                subtitle={activeOrganization?.name}
                secondarySubtitle={t("ceo.dashboard.overviewContext")}
                actions={headerActions}
            />

            {/* ─── Approval backlog at a glance ───────────────────────────── */}
            <Row gutter={gutter} style={{ marginBottom: isMobile ? 12 : 20 }} role="list">
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("ceo.dashboard.awaitingDecision")}
                        value={totalPending.toLocaleString()}
                        caption={t("ceo.dashboard.awaitingDecisionCaption")}
                        icon={totalPending > 0 ? <InboxOutlined aria-hidden /> : <CheckCircleOutlined aria-hidden />}
                        color="#f97316"
                        compact={isMobile}
                        onClick={() => navigate("/pending-inbox")}
                        ariaLabel={`${t("ceo.dashboard.awaitingDecision")}: ${totalPending}. ${t(
                            "ceo.dashboard.awaitingDecisionCaption",
                        )}`}
                        animDelay={0}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("ceo.dashboard.queue.leave")}
                        value={statValue(queues.leave)}
                        caption={t("ceo.dashboard.queue.leaveCaption")}
                        icon={<CalendarOutlined aria-hidden />}
                        color="#0ea5e9"
                        compact={isMobile}
                        note={unavailableNote(queues.leave.available)}
                        onClick={() => navigate("/ceo/leave/requests")}
                        ariaLabel={`${t("ceo.dashboard.queue.leave")}: ${statValue(queues.leave)}`}
                        animDelay={60}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("ceo.dashboard.queue.loan")}
                        value={statValue(queues.loan)}
                        caption={t("ceo.dashboard.queue.loanCaption")}
                        icon={<DollarOutlined aria-hidden />}
                        color="#10b981"
                        compact={isMobile}
                        note={unavailableNote(queues.loan.available)}
                        onClick={() => navigate("/ceo/loan-requests")}
                        ariaLabel={`${t("ceo.dashboard.queue.loan")}: ${statValue(queues.loan)}`}
                        animDelay={120}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("ceo.dashboard.queue.attendance")}
                        value={statValue(queues.attendance)}
                        caption={t("ceo.dashboard.queue.attendanceCaption")}
                        icon={<ClockCircleOutlined aria-hidden />}
                        color="#6366f1"
                        compact={isMobile}
                        note={unavailableNote(queues.attendance.available)}
                        onClick={() => navigate("/ceo/attendance")}
                        ariaLabel={`${t("ceo.dashboard.queue.attendance")}: ${statValue(queues.attendance)}`}
                        animDelay={180}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("ceo.dashboard.queue.assets")}
                        value={assetsAvailable ? assetsCount.toLocaleString() : "—"}
                        caption={t("ceo.dashboard.queue.assetsCaption")}
                        icon={<AppstoreOutlined aria-hidden />}
                        color="#8b5cf6"
                        compact={isMobile}
                        note={unavailableNote(assetsAvailable)}
                        onClick={() => navigate("/ceo/assets/damage-reports")}
                        ariaLabel={`${t("ceo.dashboard.queue.assets")}: ${
                            assetsAvailable ? assetsCount : "—"
                        }`}
                        animDelay={240}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("ceo.dashboard.queue.employeeArchive")}
                        value={statValue(queues.employeeArchive)}
                        caption={t("ceo.dashboard.queue.employeeArchiveCaption")}
                        icon={<TeamOutlined aria-hidden />}
                        color="#ef4444"
                        compact={isMobile}
                        note={unavailableNote(queues.employeeArchive.available)}
                        onClick={() => navigate("/ceo/employees/deletion-requests")}
                        ariaLabel={`${t("ceo.dashboard.queue.employeeArchive")}: ${statValue(
                            queues.employeeArchive,
                        )}`}
                        animDelay={300}
                    />
                </Col>
            </Row>

            {/* ─── Prioritized queues + announcements ─────────────────────── */}
            <Row gutter={gutter} align="top">
                <Col xs={24} lg={15}>
                    <DashboardPanel
                        title={t("ceo.dashboard.needsDecision")}
                        description={
                            nothingPending ? undefined : t("ceo.dashboard.needsDecisionHint")
                        }
                        bodyPadding={0}
                        animDelay={340}
                    >
                        {nothingPending && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "14px 18px",
                                    background: "#f0fdf4",
                                    borderBottom: "1px solid #f1f5f9",
                                    color: "#166534",
                                    fontWeight: 600,
                                    fontSize: 13.5,
                                }}
                            >
                                <CheckCircleOutlined aria-hidden />
                                {t("ceo.dashboard.allClear")}
                            </div>
                        )}
                        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                            {prioritizedRows.map((row, index) => (
                                <li
                                    key={row.key}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                        flexWrap: "wrap",
                                        padding: isMobile ? "12px 14px" : "14px 18px",
                                        borderTop: index === 0 ? undefined : "1px solid #f1f5f9",
                                    }}
                                >
                                    <span
                                        aria-hidden
                                        style={{
                                            width: 36,
                                            height: 36,
                                            borderRadius: 10,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            background: `${row.color}1a`,
                                            border: `1px solid ${row.color}33`,
                                            color: row.color,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {row.icon}
                                    </span>
                                    <span style={{ flex: 1, minWidth: 160 }}>
                                        <span
                                            style={{
                                                display: "block",
                                                fontWeight: 600,
                                                fontSize: 14,
                                                color: "#0f172a",
                                            }}
                                        >
                                            {row.label}
                                        </span>
                                        <span style={{ display: "block", fontSize: 12.5, color: "#64748b" }}>
                                            {!row.available
                                                ? t("ceo.dashboard.queueUnavailableHint")
                                                : row.count > 0
                                                  ? t("ceo.dashboard.queuePendingCount", {
                                                        count: row.count.toLocaleString(),
                                                    })
                                                  : t("ceo.dashboard.queueNonePending")}
                                        </span>
                                    </span>
                                    <Button
                                        type={row.available && row.count > 0 ? "primary" : "default"}
                                        onClick={() => navigate(row.path)}
                                        aria-label={`${t("common.review")}: ${row.label}`}
                                        style={{ borderRadius: 8, minHeight: 36, fontWeight: 600 }}
                                    >
                                        {t("common.review")}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </DashboardPanel>
                </Col>

                <Col xs={24} lg={9}>
                    <div
                        className="animate-fade-in-up"
                        style={{ animationDelay: "380ms", height: "100%", marginTop: isMobile ? 12 : 0 }}
                    >
                        <AnnouncementWidget role="CEO" />
                    </div>
                </Col>
            </Row>
        </div>
    );
}
