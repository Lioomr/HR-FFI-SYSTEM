import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Table, Tag, Tooltip, notification, Modal } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, CloseCircleOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import { getMyLeaveRequests, cancelLeaveRequest, type LeaveRequest } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";

const { confirm } = Modal;

export default function MyLeaveRequestsPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<LeaveRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [cancellingId, setCancellingId] = useState<number | null>(null);
    const [canCancel, setCanCancel] = useState(true);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getMyLeaveRequests({ page, page_size: pageSize });
            if (isApiError(res)) {
                notification.error({ message: t("common.error"), description: res.message });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: any) {
            notification.error({ message: t("common.error"), description: t("common.tryAgain") });
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
                        notification.error({ message: t("common.error"), description: res.message });
                    } else {
                        notification.success({ message: t("leave.cancelled") });
                        loadData();
                    }
                } catch (e: any) {
                    if (e.status === 404 || e.status === 405) {
                        notification.warning({ message: t("common.error"), description: t("common.tryAgain") });
                        setCanCancel(false);
                    } else {
                        notification.error({ message: t("common.error"), description: t("common.tryAgain") });
                    }
                } finally {
                    setCancellingId(null);
                }
            }
        });
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

    const columns: ColumnsType<LeaveRequest> = [
        {
            title: t("leave.type"),
            key: "leave_type",
            render: (_, record) => record.leave_type?.name || t("leave.title")
        },
        {
            title: t("leave.startDate"),
            dataIndex: "start_date",
            key: "start_date",
        },
        {
            title: t("leave.endDate"),
            dataIndex: "end_date",
            key: "end_date",
        },
        {
            title: t("leave.days"),
            dataIndex: "days",
            key: "days",
            align: 'center'
        },
        {
            title: t("leave.reason"),
            dataIndex: "reason",
            key: "reason",
            ellipsis: true
        },
        {
            title: t("common.status"),
            dataIndex: "status",
            key: "status",
            render: (status) => {
                const display = (status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase()).replace('_', ' ');
                return (
                    <Tag color={getStatusColor(status)}>
                        {display}
                    </Tag>
                );
            }
        },
        {
            title: t("common.actions"),
            key: "actions",
            align: 'center',
            render: (_, record) => {
                const s = record.status?.toLowerCase();
                const isPending = s === 'submitted' || s === 'pending_manager' || s === 'pending_hr' || s === 'pending';

                return (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        {canCancel && isPending && (
                            <Tooltip title={t("leave.cancel")}>
                                <Button
                                    danger
                                    icon={<CloseCircleOutlined />}
                                    size="small"
                                    loading={cancellingId === record.id}
                                    onClick={() => handleCancel(record.id)}
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
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        onChange: (p, ps) => {
                            setPage(p);
                            if (ps !== pageSize) setPageSize(ps);
                        },
                    }}
                />
            </Card>
        </div>
    );
}
