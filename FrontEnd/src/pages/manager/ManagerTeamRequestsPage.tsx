import { useEffect, useState } from "react";
import { Tabs, Table, Tag, Button, Space, notification, Typography, Avatar, Tooltip } from "antd";
import { CheckOutlined, CloseOutlined, EyeOutlined, UserOutlined, CalendarOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";

import PageHeader from "../../components/ui/PageHeader";
import {
    getManagerLeaveRequests,
    approveLeaveRequestManager,
    rejectLeaveRequestManager,
    getManagerAssetReturnRequests,
    approveManagerAssetReturnRequest,
    rejectManagerAssetReturnRequest,
    getManagerTeam,
    type ManagerLeaveRequest,
    type ManagerTeamMember
} from "../../services/api/managerApi";
import type { AssetReturnRequest } from "../../services/api/assetsApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";
import LeaveApprovalMap from "../../components/leaves/LeaveApprovalMap";
import AssetReturnApprovalMap from "../../components/assets/AssetReturnApprovalMap";
import AttendanceMaintenanceNotice from "../../components/attendance/AttendanceMaintenanceNotice";

export default function ManagerTeamRequestsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get("tab") || "leave";
    const { t } = useI18n();

    return (
        <div>
            <PageHeader title={t("manager.requests.title")} subtitle={t("manager.requests.subtitle")} />
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setSearchParams({ tab: key })}
                items={[
                    { key: "leave", label: t("manager.requests.leaveTab"), children: <LeaveRequestsTab /> },
                    { key: "attendance", label: t("manager.requests.attendanceTab"), children: <AttendanceMaintenanceTab /> },
                    { key: "asset-returns", label: t("assets.returnRequests", "Asset Return Requests"), children: <AssetReturnRequestsTab /> },
                    { key: "team", label: t("manager.requests.teamTab"), children: <TeamTab /> },
                ]}
            />
        </div>
    );
}

function LeaveRequestsTab() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [data, setData] = useState<ManagerLeaveRequest[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchIds = async () => {
        setLoading(true);
        try {
            const res = await getManagerLeaveRequests();
            if (!isApiError(res) && res.data) {
                setData(res.data);
            } else {
                notification.error({ message: t("common.error") });
            }
        } catch {
            notification.error({ message: t("common.error") });
        }
        setLoading(false);
    };

    useEffect(() => { fetchIds(); }, []);

    const handleAction = async (id: number, action: 'approve' | 'reject') => {
        let comment = "";
        if (action === 'reject') {
            comment = prompt(t("manager.requests.reasonPrompt")) || "";
            if (!comment) return;
        }

        try {
            if (action === 'approve') await approveLeaveRequestManager(id);
            else await rejectLeaveRequestManager(id, comment);

            notification.success({ message: t("common.success") });
            fetchIds();
        } catch (e) {
            notification.error({ message: t("manager.requests.actionFailed") });
        }
    };

    const columns = [
        {
            title: t("hr.dashboard.employee"),
            key: "employee",
            render: (_: any, r: ManagerLeaveRequest) => {
                const fullName = r.employee?.full_name || r.employee?.email || t("manager.requests.unknown");
                const email = r.employee?.email || "—";
                return (
                    <Space size={10}>
                        <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: "#fff2e8", color: "#fa8c16" }} />
                        <div>
                            <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{fullName}</div>
                            <div style={{ fontSize: 12, color: "#8c8c8c", lineHeight: 1.2 }}>{email}</div>
                        </div>
                    </Space>
                );
            },
        },
        {
            title: t("common.type"),
            dataIndex: ["leave_type", "name"],
            key: "type",
            render: (v: string) => <span style={{ fontWeight: 500 }}>{v || "—"}</span>,
        },
        {
            title: t("common.date"),
            key: "dates",
            render: (_: any, r: ManagerLeaveRequest) => (
                <Space size={6}>
                    <CalendarOutlined style={{ color: "#8c8c8c" }} />
                    <span style={{ whiteSpace: "nowrap" }}>{r.start_date} {t("common.to")} {r.end_date}</span>
                </Space>
            )
        },
        {
            title: t("common.reason"),
            dataIndex: "reason",
            key: "reason",
            ellipsis: { showTitle: false },
            render: (v: string) => (
                <Tooltip title={v || "—"}>
                    <Typography.Text>{v || "—"}</Typography.Text>
                </Tooltip>
            ),
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            render: (s: string) => {
                const label = (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                const value = String(s || "").toLowerCase();
                const color =
                    value === "approved" ? "green" :
                        value === "rejected" ? "red" :
                            value === "cancelled" ? "default" :
                                value === "pending_hr" ? "purple" :
                                    value === "pending_manager" || value === "submitted" ? "gold" :
                                        "blue";

                // Translate the label based on `t("status.xxx")` if possible, but the current DB gives enum string
                // Map DB status to translation key:
                const statusMap: Record<string, string> = {
                    "approved": t("status.approved"),
                    "rejected": t("status.rejected"),
                    "cancelled": t("status.cancelled"),
                    "pending_hr": t("status.pendingHr"),
                    "pending_manager": t("status.pendingManager"),
                    "submitted": t("status.pendingManager") // treat submitted as pending manager here
                };
                const translatedLabel = statusMap[value] || label;

                return <Tag color={color} style={{ borderRadius: 999, paddingInline: 10 }}>{translatedLabel}</Tag>;
            }
        },
        {
            title: t("common.actions"),
            key: "actions",
            width: 280,
            render: (_: any, r: ManagerLeaveRequest) => (
                <Space size={8} style={{ whiteSpace: "nowrap" }}>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/manager/leave/requests/${r.id}`)} style={{ borderRadius: 10 }}>
                        {t("common.view")}
                    </Button>
                    {["pending_manager", "submitted"].includes(String(r.status || "").toLowerCase()) ? (
                        <>
                            <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleAction(r.id, 'approve')} style={{ borderRadius: 10 }}>{t("common.approve")}</Button>
                            <Button danger size="small" icon={<CloseOutlined />} onClick={() => handleAction(r.id, 'reject')} style={{ borderRadius: 10 }}>{t("common.reject")}</Button>
                        </>
                    ) : (
                        <Tag color="default">{t("manager.requests.history")}</Tag>
                    )}
                </Space>
            )
        }
    ];

    return (
        <Table
            dataSource={data}
            columns={columns}
            rowKey="id"
            loading={loading}
            expandable={{
                expandedRowRender: (record) => <LeaveApprovalMap request={record as any} t={t} />,
            }}
            scroll={{ x: 1100 }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            rowClassName={() => "manager-leave-row"}
            style={{ background: "white", borderRadius: 14, overflow: "hidden" }}
        />
    );
}

function AttendanceMaintenanceTab() {
    const { t } = useI18n();
    return (
        <AttendanceMaintenanceNotice
            title={t("attendance.maintenance.title", "Attendance is temporarily unavailable")}
            description={t(
                "attendance.maintenance.managerDescription",
                "We are fixing this part right now for all users. Attendance requests and approvals will be back soon."
            )}
        />
    );
}

function AssetReturnRequestsTab() {
    const { t } = useI18n();
    const [data, setData] = useState<AssetReturnRequest[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchRequests = async () => {
        setLoading(true);
        try {
            const res = await getManagerAssetReturnRequests();
            if (!isApiError(res) && res.data) {
                setData(res.data);
            } else {
                notification.error({ message: t("common.error") });
            }
        } catch {
            notification.error({ message: t("common.error") });
        }
        setLoading(false);
    };

    useEffect(() => { fetchRequests(); }, []);

    const handleAction = async (id: number, action: "approve" | "reject") => {
        let comment = "";
        if (action === "reject") {
            comment = prompt(t("manager.requests.reasonPrompt")) || "";
            if (!comment) return;
        }

        try {
            if (action === "approve") await approveManagerAssetReturnRequest(id);
            else await rejectManagerAssetReturnRequest(id, comment);

            notification.success({ message: t("common.success") });
            fetchRequests();
        } catch {
            notification.error({ message: t("manager.requests.actionFailed") });
        }
    };

    const statusColorMap: Record<string, string> = {
        PENDING_MANAGER: "gold",
        PENDING: "blue",
        PENDING_CEO: "purple",
        APPROVED: "green",
        PROCESSED: "cyan",
        REJECTED: "red",
    };

    const columns = [
        {
            title: t("hr.dashboard.employee"),
            key: "employee",
            render: (_: any, r: AssetReturnRequest) => {
                const fullName = r.employee_name || r.employee_email || t("manager.requests.unknown");
                const email = r.employee_email || "—";
                return (
                    <Space size={10}>
                        <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: "#fff2e8", color: "#fa8c16" }} />
                        <div>
                            <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{fullName}</div>
                            <div style={{ fontSize: 12, color: "#8c8c8c", lineHeight: 1.2 }}>{email}</div>
                        </div>
                    </Space>
                );
            },
        },
        {
            title: t("assets.assetCode"),
            dataIndex: "asset_code",
            key: "asset_code",
            width: 140,
        },
        {
            title: t("common.name"),
            dataIndex: "asset_name",
            key: "asset_name",
            render: (value: string) => <span style={{ fontWeight: 500 }}>{value || "—"}</span>,
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
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            width: 160,
            render: (value: string) => <Tag color={statusColorMap[value] || "default"}>{value}</Tag>,
        },
        {
            title: t("hr.assets.requestedAt", "Requested At"),
            dataIndex: "requested_at",
            key: "requested_at",
            width: 180,
            render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—"),
        },
        {
            title: t("common.actions"),
            key: "actions",
            width: 220,
            render: (_: any, r: AssetReturnRequest) => (
                <Space size={8} style={{ whiteSpace: "nowrap" }}>
                    {r.status === "PENDING_MANAGER" ? (
                        <>
                            <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleAction(r.id, "approve")}>
                                {t("common.approve")}
                            </Button>
                            <Button danger size="small" icon={<CloseOutlined />} onClick={() => handleAction(r.id, "reject")}>
                                {t("common.reject")}
                            </Button>
                        </>
                    ) : (
                        <Tag color="default">{t("manager.requests.history")}</Tag>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <Table
            dataSource={data}
            columns={columns}
            rowKey="id"
            loading={loading}
            expandable={{
                expandedRowRender: (record) => <AssetReturnApprovalMap request={record} t={t} />,
            }}
            scroll={{ x: 1100 }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            style={{ background: "white", borderRadius: 14, overflow: "hidden" }}
        />
    );
}

function TeamTab() {
    const { t } = useI18n();
    const [data, setData] = useState<ManagerTeamMember[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchTeam = async () => {
        setLoading(true);
        try {
            const res = await getManagerTeam();
            if (!isApiError(res) && res.data) {
                setData(res.data);
            } else {
                notification.error({ message: t("manager.team.failedLoad") });
            }
        } catch {
            notification.error({ message: t("manager.team.failedLoad") });
        }
        setLoading(false);
    };

    useEffect(() => { fetchTeam(); }, []);

    const columns = [
        {
            title: t("employees.form.empNumber"),
            dataIndex: "employee_id",
            key: "employee_id",
        },
        {
            title: t("common.name"),
            key: "name",
            render: (_: any, r: ManagerTeamMember) => r.full_name_en || r.full_name || "—",
        },
        {
            title: t("common.email"),
            dataIndex: "email",
            key: "email",
            render: (v: string) => v || "—",
        },
        {
            title: t("employees.form.mobile"),
            dataIndex: "mobile",
            key: "mobile",
            render: (v: string) => v || "—",
        },
        {
            title: t("employees.form.departmentPlaceholder"),
            dataIndex: "department",
            key: "department",
            render: (v: string) => v || "—",
        },
        {
            title: t("employees.form.positionPlaceholder"),
            dataIndex: "position",
            key: "position",
            render: (v: string) => v || "—",
        },
    ];

    return <Table dataSource={data} columns={columns} rowKey="id" loading={loading} scroll={{ x: 800 }} />;
}
