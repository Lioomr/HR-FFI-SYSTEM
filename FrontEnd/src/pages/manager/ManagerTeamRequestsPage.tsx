import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input, Space, Table, Tabs, Tag, Tooltip, Typography, notification } from "antd";
import { EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import PageHeader from "../../components/ui/PageHeader";
import EmptyState from "../../components/ui/EmptyState";
import ApprovalSurface from "../../components/ceo/ApprovalSurface";
import ApprovalActions from "../../components/ceo/ApprovalActions";
import ApprovalStatusTag from "../../components/ceo/ApprovalStatusTag";
import RejectReasonModal from "../../components/ceo/RejectReasonModal";
import { approvalStatusLabel } from "../../components/ceo/approvalStatusLabel";
import TeamMemberCell from "../../components/manager/TeamMemberCell";
import LeaveApprovalMap from "../../components/leaves/LeaveApprovalMap";
import AssetReturnApprovalMap from "../../components/assets/AssetReturnApprovalMap";
import AttendanceMaintenanceNotice from "../../components/attendance/AttendanceMaintenanceNotice";
import AttendanceCorrectionsApproverTable from "../../components/attendance/AttendanceCorrectionsApproverTable";
import AttendanceMaintenanceBanner from "../../components/attendance/AttendanceMaintenanceBanner";
import {
    getManagerLeaveRequests,
    approveLeaveRequestManager,
    rejectLeaveRequestManager,
    getManagerAssetReturnRequests,
    approveManagerAssetReturnRequest,
    rejectManagerAssetReturnRequest,
    getManagerTeam,
    type ManagerLeaveRequest,
    type ManagerTeamMember,
} from "../../services/api/managerApi";
import type { AssetReturnRequest } from "../../services/api/assetsApi";
import { listAttendanceCorrectionRequests } from "../../services/api/attendanceCorrectionsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useManagerAccess } from "../../hooks/useManagerAccess";
import { managedCountLabel } from "../../utils/managerCapability";
import { formatDateTime } from "../../utils/dateTime";
import { isStaleRequest, requestAgeLabel } from "../../utils/requestAge";
import { useI18n } from "../../i18n/useI18n";

type TabKey = "leave" | "attendance" | "attendance-corrections" | "asset-returns" | "team";

const TAB_KEYS: TabKey[] = ["leave", "attendance", "attendance-corrections", "asset-returns", "team"];

/** Leave statuses a manager is still the deciding approver for. */
const LEAVE_ACTIONABLE = new Set(["pending_manager", "submitted"]);

type CountReporter = (key: TabKey, count: number) => void;

/**
 * Team request inbox.
 *
 * Every queue a manager approves lives behind one tab with its outstanding
 * count on the label, so the size of each backlog is visible before opening it.
 * All tabs share the same table chrome, employee cell, status pill and
 * approve/reject controls.
 */
export default function ManagerTeamRequestsPage() {
    const { t } = useI18n();
    const [searchParams, setSearchParams] = useSearchParams();
    const { access } = useManagerAccess();

    const requestedTab = searchParams.get("tab") as TabKey | null;
    const activeTab: TabKey =
        requestedTab && TAB_KEYS.includes(requestedTab) ? requestedTab : "leave";

    const [counts, setCounts] = useState<Partial<Record<TabKey, number>>>({});
    // Bumped by the header refresh so every mounted tab reloads.
    const [refreshToken, setRefreshToken] = useState(0);

    const reportCount = useCallback<CountReporter>((key, count) => {
        setCounts((current) => (current[key] === count ? current : { ...current, [key]: count }));
    }, []);

    // The corrections table owns its own status filter, so its outstanding count
    // is probed here instead of derived from whatever the table is showing.
    useEffect(() => {
        let cancelled = false;
        listAttendanceCorrectionRequests({ status: "pending_manager", page: 1, page_size: 1 })
            .then((res) => {
                if (cancelled || isApiError(res)) return;
                reportCount("attendance-corrections", res.data?.count ?? 0);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [reportCount, refreshToken]);

    const totalPending =
        (counts.leave ?? 0) + (counts["asset-returns"] ?? 0) + (counts["attendance-corrections"] ?? 0);

    const tabLabel = (key: TabKey, label: string) => {
        const count = counts[key];
        return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {label}
                {typeof count === "number" && count > 0 && (
                    <Tag
                        color="orange"
                        style={{ margin: 0, borderRadius: 999, fontWeight: 700, paddingInline: 8 }}
                    >
                        {count}
                    </Tag>
                )}
            </span>
        );
    };

    return (
        <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
            <PageHeader
                title={t("manager.requests.title")}
                subtitle={t("manager.requests.subtitle")}
                secondarySubtitle={managedCountLabel(t, access.managed_employee_count)}
                tags={
                    totalPending > 0 ? (
                        <Tag color="orange" style={{ margin: 0, borderRadius: 999, fontWeight: 700 }}>
                            {t("manager.requests.awaitingCount", { count: totalPending })}
                        </Tag>
                    ) : undefined
                }
                actions={
                    <Button
                        icon={<ReloadOutlined aria-hidden />}
                        onClick={() => setRefreshToken((token) => token + 1)}
                        aria-label={t("common.refresh")}
                        style={{ borderRadius: 10, minHeight: 40 }}
                    >
                        {t("common.refresh")}
                    </Button>
                }
            />

            <Tabs
                activeKey={activeTab}
                onChange={(key) => setSearchParams({ tab: key })}
                items={[
                    {
                        key: "leave",
                        label: tabLabel("leave", t("manager.requests.leaveTab")),
                        // Rendered up front so its count is on the label before
                        // the tab is ever opened.
                        forceRender: true,
                        children: <LeaveRequestsTab refreshToken={refreshToken} onCount={reportCount} />,
                    },
                    {
                        key: "attendance",
                        label: t("manager.requests.attendanceTab"),
                        children: <AttendanceMaintenanceTab />,
                    },
                    {
                        key: "attendance-corrections",
                        label: tabLabel("attendance-corrections", t("manager.requests.correctionsTab")),
                        children: <AttendanceCorrectionsTab />,
                    },
                    {
                        key: "asset-returns",
                        label: tabLabel("asset-returns", t("manager.requests.assetReturnsTab")),
                        forceRender: true,
                        children: <AssetReturnRequestsTab refreshToken={refreshToken} onCount={reportCount} />,
                    },
                    {
                        key: "team",
                        label: t("manager.requests.teamTab"),
                        children: <TeamTab refreshToken={refreshToken} />,
                    },
                ]}
            />
        </div>
    );
}

/** Search box shared by the request tabs. */
function InboxFilters({
    query,
    onQueryChange,
    placeholder,
    hint,
}: {
    query: string;
    onQueryChange: (value: string) => void;
    placeholder: string;
    hint?: string;
}) {
    return (
        <ApprovalSurface padding={16} style={{ marginBottom: 16 }}>
            <Space size={12} wrap style={{ width: "100%", justifyContent: "space-between" }}>
                <Input
                    allowClear
                    prefix={<SearchOutlined aria-hidden style={{ color: "#94a3b8" }} />}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    style={{ width: 320, maxWidth: "100%" }}
                />
                {hint && (
                    <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                        {hint}
                    </Typography.Text>
                )}
            </Space>
        </ApprovalSurface>
    );
}

/** Waiting-time cell: emphasised once a request has aged past the stale mark. */
function AgeCell({ submittedAt }: { submittedAt?: string | null }) {
    const { t } = useI18n();
    const stale = isStaleRequest(submittedAt);
    return (
        <span
            className="tabular-nums"
            style={{
                whiteSpace: "nowrap",
                fontWeight: stale ? 700 : 500,
                color: stale ? "#b45309" : "#64748b",
            }}
        >
            {requestAgeLabel(t, submittedAt)}
        </span>
    );
}

function LeaveRequestsTab({
    refreshToken,
    onCount,
}: {
    refreshToken: number;
    onCount: CountReporter;
}) {
    const { t } = useI18n();
    const navigate = useNavigate();

    const [data, setData] = useState<ManagerLeaveRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [rejecting, setRejecting] = useState<ManagerLeaveRequest | null>(null);
    const [processingId, setProcessingId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getManagerLeaveRequests();
            if (isApiError(res)) {
                notification.error({ message: t("manager.requests.loadFailed"), description: res.message });
                return;
            }
            setData(res.data ?? []);
        } catch {
            notification.error({ message: t("manager.requests.loadFailed") });
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load, refreshToken]);

    const pendingCount = useMemo(
        () => data.filter((row) => LEAVE_ACTIONABLE.has(String(row.status || "").toLowerCase())).length,
        [data],
    );

    useEffect(() => {
        onCount("leave", pendingCount);
    }, [onCount, pendingCount]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return data;
        return data.filter((row) =>
            [row.employee?.full_name, row.employee?.email, row.leave_type?.name, row.reason]
                .filter(Boolean)
                .some((field) => String(field).toLowerCase().includes(needle)),
        );
    }, [data, query]);

    const employeeName = (row: ManagerLeaveRequest) =>
        row.employee?.full_name || row.employee?.email || t("manager.requests.unknown");

    const approve = async (row: ManagerLeaveRequest) => {
        setProcessingId(row.id);
        try {
            const res = await approveLeaveRequestManager(row.id);
            if (isApiError(res)) {
                notification.error({ message: t("manager.requests.actionFailed"), description: res.message });
                return;
            }
            notification.success({ message: t("manager.requests.approveSuccess") });
            await load();
        } catch {
            notification.error({ message: t("manager.requests.actionFailed") });
        } finally {
            setProcessingId(null);
        }
    };

    const reject = async (reason: string) => {
        if (!rejecting) return;
        setProcessingId(rejecting.id);
        try {
            const res = await rejectLeaveRequestManager(rejecting.id, reason);
            if (isApiError(res)) {
                notification.error({ message: t("manager.requests.actionFailed"), description: res.message });
                return;
            }
            notification.success({ message: t("manager.requests.rejectSuccess") });
            setRejecting(null);
            await load();
        } catch {
            notification.error({ message: t("manager.requests.actionFailed") });
        } finally {
            setProcessingId(null);
        }
    };

    const columns: ColumnsType<ManagerLeaveRequest> = [
        {
            title: t("hr.dashboard.employee"),
            key: "employee",
            render: (_, record) => (
                <TeamMemberCell name={employeeName(record)} secondary={record.employee?.email} />
            ),
        },
        {
            title: t("leave.type"),
            key: "type",
            width: 150,
            render: (_, record) => record.leave_type?.name || "—",
        },
        {
            title: t("ceo.leaveApprovals.period"),
            key: "period",
            width: 210,
            render: (_, record) => (
                <span className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
                    {record.start_date} → {record.end_date}
                </span>
            ),
        },
        {
            title: t("common.reason"),
            dataIndex: "reason",
            key: "reason",
            ellipsis: { showTitle: false },
            render: (value: string) => (
                <Tooltip title={value || "—"}>
                    <Typography.Text>{value || "—"}</Typography.Text>
                </Tooltip>
            ),
        },
        {
            title: t("manager.requests.waiting"),
            key: "age",
            width: 140,
            render: (_, record) => <AgeCell submittedAt={record.created_at} />,
        },
        {
            title: t("common.status"),
            key: "status",
            width: 160,
            render: (_, record) => (
                <ApprovalStatusTag label={approvalStatusLabel(record.status, t)} status={record.status} />
            ),
        },
        {
            title: t("common.actions"),
            key: "actions",
            width: 290,
            render: (_, record) => {
                const actionable = LEAVE_ACTIONABLE.has(String(record.status || "").toLowerCase());
                return (
                    <Space size={8} wrap>
                        <Button
                            size="small"
                            icon={<EyeOutlined aria-hidden />}
                            onClick={() => navigate(`/manager/leave/requests/${record.id}`)}
                            aria-label={`${t("common.view")}: ${employeeName(record)}`}
                            style={{ borderRadius: 8 }}
                        >
                            {t("common.view")}
                        </Button>
                        {actionable ? (
                            <ApprovalActions
                                subjectLabel={employeeName(record)}
                                approveLoading={processingId === record.id}
                                disabled={processingId !== null}
                                onApprove={() => approve(record)}
                                onReject={() => setRejecting(record)}
                            />
                        ) : (
                            <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                                {t("manager.requests.history")}
                            </Tag>
                        )}
                    </Space>
                );
            },
        },
    ];

    return (
        <>
            <InboxFilters
                query={query}
                onQueryChange={setQuery}
                placeholder={t("manager.requests.searchPlaceholder")}
                hint={t("manager.requests.expandHint")}
            />
            <ApprovalSurface>
                <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    locale={{
                        emptyText: loading ? undefined : (
                            <EmptyState
                                title={
                                    query.trim()
                                        ? t("manager.requests.noMatches")
                                        : t("manager.empty.noPendingRequestsTitle")
                                }
                                description={
                                    query.trim()
                                        ? t("manager.requests.noMatchesDesc")
                                        : t("manager.empty.noPendingRequestsDesc")
                                }
                            />
                        ),
                    }}
                    expandable={{
                        expandedRowRender: (record) => <LeaveApprovalMap request={record as any} t={t} />,
                    }}
                    scroll={{ x: 1280 }}
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: false,
                        hideOnSinglePage: true,
                        style: { paddingInline: 16 },
                    }}
                />
            </ApprovalSurface>

            <RejectReasonModal
                open={Boolean(rejecting)}
                title={t("manager.requests.rejectTitle")}
                subject={rejecting ? employeeName(rejecting) : undefined}
                confirmText={t("manager.requests.rejectConfirm")}
                loading={processingId !== null && processingId === rejecting?.id}
                onCancel={() => setRejecting(null)}
                onSubmit={reject}
            />
        </>
    );
}

function AttendanceMaintenanceTab() {
    const { t } = useI18n();
    return (
        <AttendanceMaintenanceNotice
            title={t("attendance.maintenance.title", "Attendance is temporarily unavailable")}
            description={t(
                "attendance.maintenance.managerDescription",
                "We are fixing this part right now for all users. Attendance requests and approvals will be back soon.",
            )}
        />
    );
}

function AttendanceCorrectionsTab() {
    const { t } = useI18n();
    return (
        <div>
            <AttendanceMaintenanceBanner
                description={t(
                    "attendanceCorrections.maintenance.managerDescription",
                    "The attendance module is under maintenance. You can still approve correction requests here so the records are updated once it is back.",
                )}
            />
            <ApprovalSurface padding={16}>
                <AttendanceCorrectionsApproverTable
                    approverRole="manager"
                    defaultStatus="pending_manager"
                    statusOptions={["pending_manager", "pending_hr", "approved", "rejected", "cancelled"]}
                />
            </ApprovalSurface>
        </div>
    );
}

function AssetReturnRequestsTab({
    refreshToken,
    onCount,
}: {
    refreshToken: number;
    onCount: CountReporter;
}) {
    const { t } = useI18n();

    const [data, setData] = useState<AssetReturnRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [rejecting, setRejecting] = useState<AssetReturnRequest | null>(null);
    const [processingId, setProcessingId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getManagerAssetReturnRequests();
            if (isApiError(res)) {
                notification.error({ message: t("manager.requests.loadFailed"), description: res.message });
                return;
            }
            setData(res.data ?? []);
        } catch {
            notification.error({ message: t("manager.requests.loadFailed") });
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load, refreshToken]);

    const pendingCount = useMemo(
        () => data.filter((row) => row.status === "PENDING_MANAGER").length,
        [data],
    );

    useEffect(() => {
        onCount("asset-returns", pendingCount);
    }, [onCount, pendingCount]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return data;
        return data.filter((row) =>
            [row.employee_name, row.employee_email, row.asset_code, row.asset_name, row.note]
                .filter(Boolean)
                .some((field) => String(field).toLowerCase().includes(needle)),
        );
    }, [data, query]);

    const employeeName = (row: AssetReturnRequest) =>
        row.employee_name || row.employee_email || t("manager.requests.unknown");

    const approve = async (row: AssetReturnRequest) => {
        setProcessingId(row.id);
        try {
            const res = await approveManagerAssetReturnRequest(row.id);
            if (isApiError(res)) {
                notification.error({ message: t("manager.requests.actionFailed"), description: res.message });
                return;
            }
            notification.success({ message: t("manager.requests.approveSuccess") });
            await load();
        } catch {
            notification.error({ message: t("manager.requests.actionFailed") });
        } finally {
            setProcessingId(null);
        }
    };

    const reject = async (reason: string) => {
        if (!rejecting) return;
        setProcessingId(rejecting.id);
        try {
            const res = await rejectManagerAssetReturnRequest(rejecting.id, reason);
            if (isApiError(res)) {
                notification.error({ message: t("manager.requests.actionFailed"), description: res.message });
                return;
            }
            notification.success({ message: t("manager.requests.rejectSuccess") });
            setRejecting(null);
            await load();
        } catch {
            notification.error({ message: t("manager.requests.actionFailed") });
        } finally {
            setProcessingId(null);
        }
    };

    const columns: ColumnsType<AssetReturnRequest> = [
        {
            title: t("hr.dashboard.employee"),
            key: "employee",
            render: (_, record) => (
                <TeamMemberCell name={employeeName(record)} secondary={record.employee_email} />
            ),
        },
        {
            title: t("assets.assetCode"),
            dataIndex: "asset_code",
            key: "asset_code",
            width: 140,
            render: (value: string) => <span className="tabular-nums">{value || "—"}</span>,
        },
        {
            title: t("common.name"),
            dataIndex: "asset_name",
            key: "asset_name",
            render: (value: string) => value || "—",
        },
        {
            title: t("common.notes"),
            dataIndex: "note",
            key: "note",
            ellipsis: { showTitle: false },
            render: (value: string) => (
                <Tooltip title={value || "—"}>
                    <Typography.Text>{value || "—"}</Typography.Text>
                </Tooltip>
            ),
        },
        {
            title: t("hr.assets.requestedAt", "Requested At"),
            dataIndex: "requested_at",
            key: "requested_at",
            width: 170,
            render: (value: string) => (
                <span className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(value, "—")}
                </span>
            ),
        },
        {
            title: t("manager.requests.waiting"),
            key: "age",
            width: 140,
            render: (_, record) => <AgeCell submittedAt={record.requested_at} />,
        },
        {
            title: t("common.status"),
            key: "status",
            width: 170,
            render: (_, record) => (
                <ApprovalStatusTag label={approvalStatusLabel(record.status, t)} status={record.status} />
            ),
        },
        {
            title: t("common.actions"),
            key: "actions",
            width: 220,
            render: (_, record) =>
                record.status === "PENDING_MANAGER" ? (
                    <ApprovalActions
                        subjectLabel={employeeName(record)}
                        approveLoading={processingId === record.id}
                        disabled={processingId !== null}
                        onApprove={() => approve(record)}
                        onReject={() => setRejecting(record)}
                    />
                ) : (
                    <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                        {t("manager.requests.history")}
                    </Tag>
                ),
        },
    ];

    return (
        <>
            <InboxFilters
                query={query}
                onQueryChange={setQuery}
                placeholder={t("manager.requests.searchAssetsPlaceholder")}
                hint={t("manager.requests.expandHint")}
            />
            <ApprovalSurface>
                <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    locale={{
                        emptyText: loading ? undefined : (
                            <EmptyState
                                title={
                                    query.trim()
                                        ? t("manager.requests.noMatches")
                                        : t("manager.empty.noAssetReturnsTitle")
                                }
                                description={
                                    query.trim()
                                        ? t("manager.requests.noMatchesDesc")
                                        : t("manager.empty.noAssetReturnsDesc")
                                }
                            />
                        ),
                    }}
                    expandable={{
                        expandedRowRender: (record) => <AssetReturnApprovalMap request={record} t={t} />,
                    }}
                    scroll={{ x: 1280 }}
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: false,
                        hideOnSinglePage: true,
                        style: { paddingInline: 16 },
                    }}
                />
            </ApprovalSurface>

            <RejectReasonModal
                open={Boolean(rejecting)}
                title={t("manager.requests.rejectAssetTitle")}
                subject={rejecting ? employeeName(rejecting) : undefined}
                confirmText={t("manager.requests.rejectConfirm")}
                loading={processingId !== null && processingId === rejecting?.id}
                onCancel={() => setRejecting(null)}
                onSubmit={reject}
            />
        </>
    );
}

function TeamTab({ refreshToken }: { refreshToken: number }) {
    const { t } = useI18n();
    const navigate = useNavigate();

    const [data, setData] = useState<ManagerTeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getManagerTeam();
            if (isApiError(res)) {
                notification.error({ message: t("manager.team.failedLoad"), description: res.message });
                return;
            }
            setData(res.data ?? []);
        } catch {
            notification.error({ message: t("manager.team.failedLoad") });
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load, refreshToken]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return data;
        return data.filter((member) =>
            [
                member.employee_id,
                member.full_name_en,
                member.full_name,
                member.email,
                member.department,
                member.position,
            ]
                .filter(Boolean)
                .some((field) => String(field).toLowerCase().includes(needle)),
        );
    }, [data, query]);

    const memberName = (member: ManagerTeamMember) =>
        member.full_name_en || member.full_name || member.email || "—";

    const columns: ColumnsType<ManagerTeamMember> = [
        {
            title: t("employees.form.empNumber"),
            dataIndex: "employee_id",
            key: "employee_id",
            width: 130,
            render: (value: string) => <span className="tabular-nums">{value || "—"}</span>,
        },
        {
            title: t("common.name"),
            key: "name",
            render: (_, record) => (
                <TeamMemberCell name={memberName(record)} secondary={record.email || undefined} />
            ),
        },
        {
            title: t("profile.department"),
            dataIndex: "department",
            key: "department",
            render: (value: string) => value || "—",
        },
        {
            title: t("profile.position"),
            dataIndex: "position",
            key: "position",
            render: (value: string) => value || "—",
        },
        {
            title: t("employees.form.mobile"),
            dataIndex: "mobile",
            key: "mobile",
            render: (value: string) => value || "—",
        },
        {
            title: t("common.actions"),
            key: "actions",
            width: 150,
            render: (_, record) => (
                <Button
                    size="small"
                    icon={<EyeOutlined aria-hidden />}
                    onClick={() => navigate(`/manager/team/${record.id}`)}
                    aria-label={`${t("manager.team.viewProfile")}: ${memberName(record)}`}
                    style={{ borderRadius: 8, fontWeight: 600 }}
                >
                    {t("manager.team.viewProfile")}
                </Button>
            ),
        },
    ];

    return (
        <>
            <InboxFilters
                query={query}
                onQueryChange={setQuery}
                placeholder={t("manager.team.searchPlaceholder")}
            />
            <ApprovalSurface>
                <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    locale={{
                        emptyText: loading ? undefined : (
                            <EmptyState
                                title={
                                    query.trim()
                                        ? t("manager.team.noMatches")
                                        : t("manager.empty.noDirectReportsTitle")
                                }
                                description={
                                    query.trim()
                                        ? t("manager.team.noMatchesDesc")
                                        : t("manager.empty.noDirectReportsDesc")
                                }
                            />
                        ),
                    }}
                    scroll={{ x: 900 }}
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: false,
                        hideOnSinglePage: true,
                        style: { paddingInline: 16 },
                    }}
                />
            </ApprovalSurface>
        </>
    );
}
