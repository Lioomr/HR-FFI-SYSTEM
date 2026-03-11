import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Grid, Table, Tag, Tooltip, notification, Modal } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, CloseCircleOutlined, EyeOutlined, FilePdfOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import { getMyLeaveRequests, cancelLeaveRequest, getLeaveRequestPdfBlob, type LeaveRequest } from "../../../services/api/leaveApi";
import LeaveApprovalMap from "../../../components/leaves/LeaveApprovalMap";
import { isApiError } from "../../../services/api/apiTypes";
import { getHttpStatus } from "../../../services/api/httpErrors";
import { getDetailedApiMessage, getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

const { confirm } = Modal;
const { useBreakpoint } = Grid;

export default function MyLeaveRequestsPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<LeaveRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [cancellingId, setCancellingId] = useState<number | null>(null);
    const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
    const [canCancel, setCanCancel] = useState(true);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getMyLeaveRequests({ page, page_size: pageSize });
            if (isApiError(res)) {
                notification.error({ message: t("common.error"), description: getDetailedApiMessage(t, res.message) });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: unknown) {
            notification.error({ message: t("common.error"), description: getDetailedHttpErrorMessage(t, err) });
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCancel = (id: number) => {
        confirm({
            title: t("leave.cancel"),
            content: t("common.required"),
            okText: t("common.yes"),
            okType: "danger",
            cancelText: t("common.no"),
            onOk: async () => {
                setCancellingId(id);
                try {
                    const res = await cancelLeaveRequest(id);
                    if (isApiError(res)) {
                        notification.error({ message: t("common.error"), description: getDetailedApiMessage(t, res.message) });
                    } else {
                        notification.success({ message: t("leave.cancelled") });
                        loadData();
                    }
                } catch (e: unknown) {
                    const status = getHttpStatus(e);
                    if (status === 404 || status === 405) {
                        notification.warning({ message: t("common.error"), description: getDetailedHttpErrorMessage(t, e) });
                        setCanCancel(false);
                    } else {
                        notification.error({ message: t("common.error"), description: getDetailedHttpErrorMessage(t, e) });
                    }
                } finally {
                    setCancellingId(null);
                }
            }
        });
    };

    const handlePdfDownload = async (record: LeaveRequest) => {
        setPdfLoadingId(record.id);
        try {
            const blob = await getLeaveRequestPdfBlob(record.id, true);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `leave_request_${record.id}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => window.URL.revokeObjectURL(url), 5000);
        } catch (err: unknown) {
            notification.error({ message: t("common.error"), description: getDetailedHttpErrorMessage(t, err) });
        } finally {
            setPdfLoadingId(null);
        }
    };

    const getStatusColor = (status: string) => {
        const s = status?.toLowerCase();
        switch (s) {
            case 'approved': return 'green';
            case 'rejected': return 'red';
            case 'submitted': return 'blue';
            case 'pending_manager': return 'orange';
            case 'pending_hr': return 'purple';
            case 'pending': return 'gold';
            case 'cancelled': return 'default';
            default: return 'default';
        }
    };

    // Translate a leave type name coming from the API
    const translateLeaveType = (name?: string): string => {
        if (!name) return t("leave.title");
        const key = `leave.type.${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '')}`;
        const translated = t(key);
        // If no translation key exists, fall back to original name
        return translated === key ? name : translated;
    };

    const columns: ColumnsType<LeaveRequest> = [
        {
            title: t("leave.type"),
            key: "leave_type",
            width: 180,
            render: (_, record) => translateLeaveType(record.leave_type?.name)
        },
        {
            title: t("leave.startDate"),
            dataIndex: "start_date",
            key: "start_date",
            width: 120,
        },
        {
            title: t("leave.endDate"),
            dataIndex: "end_date",
            key: "end_date",
            width: 120,
        },
        {
            title: t("leave.days"),
            dataIndex: "days",
            key: "days",
            align: 'center',
            width: 90,
            responsive: ["md"],
        },
        {
            title: t("leave.reason"),
            dataIndex: "reason",
            key: "reason",
            ellipsis: true,
            width: 220,
            responsive: ["lg"],
        },
        {
            title: t("leave.rejectionReason"),
            key: "rejection_reason",
            width: 220,
            responsive: ["xl"],
            render: (_, record) => {
                const isRejected = (record.status || "").toLowerCase() === "rejected";
                if (!isRejected) return "-";
                return record.ceo_decision_note || record.hr_decision_note || record.manager_decision_note || record.rejection_reason || "-";
            },
            ellipsis: true,
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            width: 150,
            render: (status, record) => {
                const statusKey = `leave.status.${status?.toLowerCase()}`;
                const translated = t(statusKey);
                const display = translated === statusKey
                    ? (status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase()).replace(/_/g, ' ')
                    : translated;
                return (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Tag color={getStatusColor(status)}>{display}</Tag>
                        {record.source === "hr_manual" && <Tag color="cyan">{t("leave.manual.badge")}</Tag>}
                    </div>
                );
            }
        },
        {
            title: t("common.actions"),
            key: "actions",
            align: 'center',
            width: isMobile ? 140 : 170,
            fixed: screens.lg ? "right" : undefined,
            render: (_, record) => {
                const s = record.status?.toLowerCase();
                const isPending = s === 'submitted' || s === 'pending_manager' || s === 'pending_hr' || s === 'pending';

                return (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                        <Tooltip title={t("common.details")}>
                            <Button
                                icon={<EyeOutlined />}
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    navigate(`/employee/leave/requests/${record.id}`);
                                }}
                            />
                        </Tooltip>
                        <Tooltip title={t("leave.downloadRequestPdf")}>
                            <Button
                                icon={<FilePdfOutlined />}
                                size="small"
                                loading={pdfLoadingId === record.id}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handlePdfDownload(record);
                                }}
                            />
                        </Tooltip>
                        {canCancel && isPending && (
                            <Tooltip title={t("leave.cancel")}>
                                <Button
                                    danger
                                    icon={<CloseCircleOutlined />}
                                    size="small"
                                    loading={cancellingId === record.id}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleCancel(record.id);
                                    }}
                                />
                            </Tooltip>
                        )}
                    </div>
                )
            },
        },
    ];

    return (
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <PageHeader
                title={t("leave.requestsTitle")}
                subtitle={t("leave.requestsSubtitle")}
                actions={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate("/employee/leave/request")}
                        block={isMobile}
                    >
                        {t("leave.newRequest")}
                    </Button>
                }
            />

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={data}
                    columns={columns}
                    rowKey="id"
                    loading={loading}
                    size={isMobile ? "small" : "middle"}
                    scroll={{ x: 760 }}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        onChange: (p, ps) => {
                            setPage(p);
                            if (ps !== pageSize) setPageSize(ps);
                        },
                    }}
                    expandable={{
                        expandedRowRender: (record) => <LeaveApprovalMap request={record} t={t} />,
                        rowExpandable: () => true,
                    }}
                    onRow={(record) => ({
                        onClick: () => navigate(`/employee/leave/requests/${record.id}`),
                        style: { cursor: "pointer" },
                    })}
                />
            </Card>
        </div>
    );
}
