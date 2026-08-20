import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Col, Grid, Row, Tag } from "antd";
import {
    AppstoreOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DollarOutlined,
    InboxOutlined,
    ReloadOutlined,
    RightOutlined,
    TeamOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import PageHeader from "../../components/ui/PageHeader";
import StatCard from "../../components/ui/StatCard";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import DashboardPanel from "../../components/hr/dashboard/DashboardPanel";
import AnnouncementWidget from "../../components/announcements/AnnouncementWidget";
import TeamMemberCell from "../../components/manager/TeamMemberCell";
import ApprovalStatusTag from "../../components/ceo/ApprovalStatusTag";
import { approvalStatusLabel } from "../../components/ceo/approvalStatusLabel";
import {
    getManagerWorkSummary,
    type ManagerPendingItem,
    type ManagerQueueKey,
    type ManagerWorkSummary,
} from "../../services/api/managerSummaryApi";
import { getManagerTeam, type ManagerTeamMember } from "../../services/api/managerApi";
import { isApiError } from "../../services/api/apiTypes";
import { useManagerAccess } from "../../hooks/useManagerAccess";
import { managedCountLabel } from "../../utils/managerCapability";
import { formatNumber } from "../../utils/currency";
import { isStaleRequest, requestAgeLabel } from "../../utils/requestAge";
import { useI18n } from "../../i18n/useI18n";

const { useBreakpoint } = Grid;

/** Rows shown in the priority queue before it defers to the full inbox. */
const QUEUE_PREVIEW_SIZE = 6;
/** Direct reports previewed on the dashboard before deferring to My Team. */
const TEAM_PREVIEW_SIZE = 5;

const QUEUE_ACCENTS: Record<ManagerQueueKey, { color: string; icon: ReactNode }> = {
    leave: { color: "#0ea5e9", icon: <CalendarOutlined aria-hidden /> },
    loan: { color: "#10b981", icon: <DollarOutlined aria-hidden /> },
    attendance: { color: "#6366f1", icon: <ClockCircleOutlined aria-hidden /> },
    assetReturn: { color: "#8b5cf6", icon: <AppstoreOutlined aria-hidden /> },
};

/**
 * Team operations overview.
 *
 * The page answers what is waiting on this manager first, then who it is
 * waiting on behalf of. Every queue resolves independently, so one unreadable
 * area degrades to a marked-unavailable tile instead of blanking the page.
 */
export default function ManagerDashboardPage() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const { access, loading: accessLoading } = useManagerAccess();

    const [summary, setSummary] = useState<ManagerWorkSummary | null>(null);
    const [team, setTeam] = useState<ManagerTeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(
        async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);
            setError(null);
            try {
                // The team list is supporting context: it must not fail the page.
                const [workResult, teamResult] = await Promise.allSettled([
                    getManagerWorkSummary(),
                    getManagerTeam(),
                ]);

                if (teamResult.status === "fulfilled" && !isApiError(teamResult.value)) {
                    setTeam(teamResult.value.data ?? []);
                }

                if (workResult.status === "rejected") {
                    setError(t("manager.dashboard.loadFailedHint"));
                    setSummary(null);
                    return;
                }
                if (workResult.value.allUnavailable) {
                    setError(t("manager.dashboard.loadFailedHint"));
                    setSummary(null);
                    return;
                }
                setSummary(workResult.value);
            } catch (err: any) {
                setError(err?.message || t("manager.dashboard.loadFailed"));
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

    // The capability response is authoritative for the team size; the team list
    // is only a fallback while it resolves.
    const managedEmployeeCount = access.managed_employee_count || team.length;
    const hasDirectReports = managedEmployeeCount > 0;

    const totalPending = summary?.totalPending ?? 0;
    const queues = summary?.queues;
    const someUnavailable = Boolean(
        queues && Object.values(queues).some((queue) => !queue.available),
    );

    const statValue = (queue?: { count: number; available: boolean }) =>
        queue?.available ? queue.count.toLocaleString() : "—";

    const unavailableNote = (available?: boolean) =>
        available === false
            ? {
                  label: t("manager.dashboard.queueUnavailable"),
                  icon: <WarningOutlined aria-hidden />,
                  tone: "warning" as const,
              }
            : undefined;

    /** The identifying line for a row, formatted where the locale is known. */
    const itemDetail = (item: ManagerPendingItem) => {
        if (item.queue === "loan") {
            const amount = Number(item.detail);
            return Number.isFinite(amount) ? formatNumber(amount) : item.detail;
        }
        return item.detail || t("manager.queue.noDetail");
    };

    const queueRows = (summary?.items ?? []).slice(0, QUEUE_PREVIEW_SIZE);
    const teamPreview = team.slice(0, TEAM_PREVIEW_SIZE);
    const gutter: [number, number] = isMobile ? [12, 12] : [20, 20];

    const headerActions = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {totalPending > 0 && (
                <Button
                    type="primary"
                    icon={<InboxOutlined aria-hidden />}
                    onClick={() => navigate("/manager/team-requests")}
                    style={{ borderRadius: 10, minHeight: 40 }}
                >
                    {t("manager.dashboard.reviewPending")}
                </Button>
            )}
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

    const header = (
        <PageHeader
            title={t("manager.dashboard.title")}
            subtitle={accessLoading ? undefined : managedCountLabel(t, managedEmployeeCount)}
            secondarySubtitle={t("manager.dashboard.overviewContext")}
            actions={headerActions}
        />
    );

    if (loading || accessLoading) {
        return (
            <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
                {header}
                <LoadingState title={t("loading.dashboard")} />
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
                {header}
                <ErrorState
                    title={t("manager.dashboard.loadFailed")}
                    description={error}
                    onRetry={() => load()}
                />
            </div>
        );
    }

    // No direct reports is a different situation from an empty queue: there is
    // nothing to manage yet, so the queue panels would be noise.
    if (!hasDirectReports) {
        return (
            <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
                {header}
                <EmptyState
                    title={t("manager.empty.noDirectReportsTitle")}
                    description={t("manager.empty.noDirectReportsDesc")}
                />
                <div style={{ marginTop: isMobile ? 12 : 20 }}>
                    <AnnouncementWidget role="manager" />
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
            {header}

            {someUnavailable && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ borderRadius: 12, marginBottom: isMobile ? 12 : 20 }}
                    message={t("manager.dashboard.partialData")}
                />
            )}

            {/* ─── What is waiting on this manager ────────────────────────── */}
            <Row gutter={gutter} style={{ marginBottom: isMobile ? 12 : 20 }} role="list">
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("manager.dashboard.pendingApprovals")}
                        value={totalPending.toLocaleString()}
                        caption={t("manager.dashboard.pendingApprovalsCaption")}
                        icon={totalPending > 0 ? <InboxOutlined aria-hidden /> : <CheckCircleOutlined aria-hidden />}
                        color="#f97316"
                        compact={isMobile}
                        onClick={() => navigate("/manager/team-requests")}
                        ariaLabel={`${t("manager.dashboard.pendingApprovals")}: ${totalPending}. ${t(
                            "manager.dashboard.pendingApprovalsCaption",
                        )}`}
                        animDelay={0}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("manager.dashboard.queue.leave")}
                        value={statValue(queues?.leave)}
                        caption={t("manager.dashboard.queue.leaveCaption")}
                        icon={<CalendarOutlined aria-hidden />}
                        color={QUEUE_ACCENTS.leave.color}
                        compact={isMobile}
                        note={unavailableNote(queues?.leave.available)}
                        onClick={() => navigate("/manager/team-requests?tab=leave")}
                        ariaLabel={`${t("manager.dashboard.queue.leave")}: ${statValue(queues?.leave)}`}
                        animDelay={60}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("manager.dashboard.queue.loan")}
                        value={statValue(queues?.loan)}
                        caption={t("manager.dashboard.queue.loanCaption")}
                        icon={<DollarOutlined aria-hidden />}
                        color={QUEUE_ACCENTS.loan.color}
                        compact={isMobile}
                        note={unavailableNote(queues?.loan.available)}
                        onClick={() => navigate("/manager/loan-requests")}
                        ariaLabel={`${t("manager.dashboard.queue.loan")}: ${statValue(queues?.loan)}`}
                        animDelay={120}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("manager.dashboard.queue.attendance")}
                        value={statValue(queues?.attendance)}
                        caption={t("manager.dashboard.queue.attendanceCaption")}
                        icon={<ClockCircleOutlined aria-hidden />}
                        color={QUEUE_ACCENTS.attendance.color}
                        compact={isMobile}
                        note={unavailableNote(queues?.attendance.available)}
                        onClick={() => navigate("/manager/attendance-corrections")}
                        ariaLabel={`${t("manager.dashboard.queue.attendance")}: ${statValue(queues?.attendance)}`}
                        animDelay={180}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("manager.dashboard.queue.assetReturn")}
                        value={statValue(queues?.assetReturn)}
                        caption={t("manager.dashboard.queue.assetReturnCaption")}
                        icon={<AppstoreOutlined aria-hidden />}
                        color={QUEUE_ACCENTS.assetReturn.color}
                        compact={isMobile}
                        note={unavailableNote(queues?.assetReturn.available)}
                        onClick={() => navigate("/manager/team-requests?tab=asset-returns")}
                        ariaLabel={`${t("manager.dashboard.queue.assetReturn")}: ${statValue(queues?.assetReturn)}`}
                        animDelay={240}
                    />
                </Col>
                <Col xs={24} sm={12} lg={8} role="listitem">
                    <StatCard
                        title={t("manager.dashboard.directReports")}
                        value={managedEmployeeCount.toLocaleString()}
                        caption={t("manager.dashboard.directReportsCaption")}
                        icon={<TeamOutlined aria-hidden />}
                        color="#0f766e"
                        compact={isMobile}
                        onClick={() => navigate("/manager/team")}
                        ariaLabel={`${t("manager.dashboard.directReports")}: ${managedEmployeeCount}`}
                        animDelay={300}
                    />
                </Col>
            </Row>

            {/* ─── Priority work queue + team context ─────────────────────── */}
            <Row gutter={gutter} align="top">
                <Col xs={24} lg={15}>
                    <DashboardPanel
                        title={t("manager.dashboard.priorityQueue")}
                        titleSuffix={
                            totalPending > 0 ? (
                                <Tag color="orange" style={{ margin: 0, borderRadius: 999, fontWeight: 700 }}>
                                    {totalPending.toLocaleString()}
                                </Tag>
                            ) : undefined
                        }
                        description={totalPending > 0 ? t("manager.dashboard.priorityQueueHint") : undefined}
                        action={
                            totalPending > 0 ? (
                                <Button
                                    type="link"
                                    onClick={() => navigate("/manager/team-requests")}
                                    style={{ padding: 0, fontWeight: 600 }}
                                >
                                    {t("manager.dashboard.viewAllRequests")}
                                </Button>
                            ) : undefined
                        }
                        bodyPadding={0}
                        animDelay={340}
                    >
                        {queueRows.length === 0 ? (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 10,
                                    padding: "16px 18px",
                                    background: "#f0fdf4",
                                    color: "#166534",
                                }}
                            >
                                <CheckCircleOutlined aria-hidden style={{ marginTop: 3 }} />
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                                        {t("manager.empty.noPendingRequestsTitle")}
                                    </div>
                                    <div style={{ fontSize: 12.5, marginTop: 2 }}>
                                        {t("manager.empty.noPendingRequestsDesc")}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                                {queueRows.map((item, index) => {
                                    const accent = QUEUE_ACCENTS[item.queue];
                                    const stale = isStaleRequest(item.submittedAt);
                                    return (
                                        <li
                                            key={item.key}
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
                                                title={t(`manager.queue.type.${item.queue}`)}
                                                style={{
                                                    width: 36,
                                                    height: 36,
                                                    borderRadius: 10,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    background: `${accent.color}1a`,
                                                    border: `1px solid ${accent.color}33`,
                                                    color: accent.color,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {accent.icon}
                                            </span>

                                            <span style={{ flex: 1, minWidth: 180 }}>
                                                <span
                                                    style={{
                                                        display: "block",
                                                        fontWeight: 600,
                                                        fontSize: 14,
                                                        color: "#0f172a",
                                                    }}
                                                >
                                                    {item.employeeName || t("manager.requests.unknown")}
                                                </span>
                                                <span
                                                    style={{
                                                        display: "block",
                                                        fontSize: 12.5,
                                                        color: "#64748b",
                                                    }}
                                                >
                                                    {t(`manager.queue.type.${item.queue}`)} · {itemDetail(item)}
                                                </span>
                                            </span>

                                            <span
                                                className="tabular-nums"
                                                style={{
                                                    fontSize: 12.5,
                                                    fontWeight: stale ? 700 : 500,
                                                    color: stale ? "#b45309" : "#64748b",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {requestAgeLabel(t, item.submittedAt)}
                                            </span>

                                            <ApprovalStatusTag
                                                label={approvalStatusLabel(item.status, t)}
                                                status={item.status}
                                            />

                                            <Button
                                                type="primary"
                                                size="small"
                                                icon={<RightOutlined aria-hidden />}
                                                onClick={() => navigate(item.path)}
                                                aria-label={`${t("common.review")}: ${
                                                    item.employeeName || t("manager.requests.unknown")
                                                }`}
                                                style={{ borderRadius: 8, minHeight: 32, fontWeight: 600 }}
                                            >
                                                {t("common.review")}
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </DashboardPanel>
                </Col>

                <Col xs={24} lg={9}>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: isMobile ? 12 : 20,
                            marginTop: isMobile ? 12 : 0,
                        }}
                    >
                        <DashboardPanel
                            title={t("manager.dashboard.teamSnapshot")}
                            titleSuffix={
                                <Tag style={{ margin: 0, borderRadius: 999, fontWeight: 700 }}>
                                    {managedEmployeeCount.toLocaleString()}
                                </Tag>
                            }
                            description={t("manager.dashboard.teamSnapshotHint")}
                            action={
                                <Button
                                    type="link"
                                    onClick={() => navigate("/manager/team")}
                                    style={{ padding: 0, fontWeight: 600 }}
                                >
                                    {t("manager.dashboard.openMyTeam")}
                                </Button>
                            }
                            bodyPadding={0}
                            animDelay={380}
                        >
                            {teamPreview.length === 0 ? (
                                <div style={{ padding: "16px 18px", fontSize: 13, color: "#64748b" }}>
                                    {t("manager.dashboard.teamPreviewUnavailable")}
                                </div>
                            ) : (
                                <>
                                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                                        {teamPreview.map((member, index) => (
                                            <li
                                                key={member.id}
                                                style={{
                                                    borderTop: index === 0 ? undefined : "1px solid #f1f5f9",
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    className="focus-ring"
                                                    onClick={() => navigate(`/manager/team/${member.id}`)}
                                                    style={{
                                                        display: "block",
                                                        width: "100%",
                                                        textAlign: "start",
                                                        background: "transparent",
                                                        border: "none",
                                                        font: "inherit",
                                                        cursor: "pointer",
                                                        padding: "10px 18px",
                                                    }}
                                                >
                                                    <TeamMemberCell
                                                        name={member.full_name_en || member.full_name}
                                                        secondary={member.position || member.department || member.email}
                                                        size={32}
                                                    />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                    {managedEmployeeCount > teamPreview.length && (
                                        <div
                                            style={{
                                                padding: "10px 18px",
                                                borderTop: "1px solid #f1f5f9",
                                                fontSize: 12.5,
                                                color: "#64748b",
                                            }}
                                        >
                                            {t("manager.dashboard.teamPreviewMore", {
                                                count: managedEmployeeCount - teamPreview.length,
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </DashboardPanel>

                        <div className="animate-fade-in-up" style={{ animationDelay: "420ms" }}>
                            <AnnouncementWidget role="manager" />
                        </div>
                    </div>
                </Col>
            </Row>
        </div>
    );
}
