import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Table, Tag, Tooltip, notification, Modal } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, CloseCircleOutlined } from "@ant-design/icons";

import PageHeader from "../../../components/ui/PageHeader";
import { getMyLeaveRequests, cancelLeaveRequest, type LeaveRequest } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";

const { confirm } = Modal;

export default function MyLeaveRequestsPage() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<LeaveRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [cancellingId, setCancellingId] = useState<number | null>(null);
    const [canCancel, setCanCancel] = useState(true); // Assume enabled until 404/405 is hit

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getMyLeaveRequests({ page, page_size: pageSize });
            if (isApiError(res)) {
                notification.error({ message: "Failed to load requests", description: res.message });
            } else {
                setData(res.data.items || []);
                setTotal(res.data.count || 0);
            }
        } catch (err: any) {
            notification.error({ message: "Error", description: "Could not load leave requests" });
        } finally {
            setLoading(false);
        }
    }, [page, pageSize]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCancel = (id: number) => {
        confirm({
            title: "Cancel Leave Request",
            content: "Are you sure you want to cancel this request? This action cannot be undone.",
            okText: "Yes, Cancel",
            okType: "danger",
            cancelText: "No",
            onOk: async () => {
                setCancellingId(id);
                try {
                    const res = await cancelLeaveRequest(id);
                    if (isApiError(res)) {
                        notification.error({ message: "Cancel Failed", description: res.message });
                    } else {
                        notification.success({ message: "Request Cancelled" });
                        loadData(); // Refresh list associated with status change
                    }
                } catch (e: any) {
                    if (e.status === 404 || e.status === 405) {
                        notification.warning({ message: "Not Supported", description: "Cancellation is not supported by the system." });
                        setCanCancel(false);
                    } else {
                        notification.error({ message: "Error", description: "Failed to cancel request" });
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
            case 'pending': return 'gold'; // Fallback
            case 'cancelled': return 'default';
            default: return 'default';
        }
    };

    const columns: ColumnsType<LeaveRequest> = [
        {
            title: "Leave Type",
            key: "leave_type",
            render: (_, record) => record.leave_type?.name || "Leave"
        },
        {
            title: "Start Date",
            dataIndex: "start_date",
            key: "start_date",
        },
        {
            title: "End Date",
            dataIndex: "end_date",
            key: "end_date",
        },
        {
            title: "Days",
            dataIndex: "days", // Match backend/interface
            key: "days",
            align: 'center'
        },
        {
            title: "Reason",
            dataIndex: "reason",
            key: "reason",
            ellipsis: true
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status) => {
                // Display normalized text. Replace underscore with space
                const display = (status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase()).replace('_', ' ');
                return (
                    <Tag color={getStatusColor(status)}>
                        {display}
                    </Tag>
                );
            }
        },
        {
            title: "Actions",
            key: "actions",
            align: 'center',
            render: (_, record) => {
                const s = record.status?.toLowerCase();
                const isPending = s === 'submitted' || s === 'pending_manager' || s === 'pending_hr' || s === 'pending';

                return (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        {canCancel && isPending && (
                            <Tooltip title="Cancel Request">
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
                title="My Leave Requests"
                subtitle="Track your leave history"
                actions={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => navigate("/employee/leave/request")}
                    >
                        New Request
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
