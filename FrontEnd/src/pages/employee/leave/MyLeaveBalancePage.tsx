import { useCallback, useEffect, useState } from "react";
import { Card, Table, Alert, Progress, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import { getMyLeaveBalance, type LeaveBalance } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";

export default function MyLeaveBalancePage() {
    const [loading, setLoading] = useState(true);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [error, setError] = useState<string | null>(null);

    const loadBalances = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getMyLeaveBalance();
            if (isApiError(res)) {
                setError(res.message);
            } else {
                setBalances(res.data || []);
            }
        } catch (err: any) {
            setError(err.message || "Failed to load leave balances");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadBalances();
    }, [loadBalances]);

    const columns: ColumnsType<LeaveBalance> = [
        {
            title: "Leave Type",
            dataIndex: "leave_type",
            key: "leave_type",
            render: (text) => <Typography.Text strong>{text}</Typography.Text>
        },
        {
            title: "Allowed",
            dataIndex: "total_days",
            key: "total_days",
            align: "center",
            render: (val) => val || 0
        },
        {
            title: "Used",
            dataIndex: "used_days",
            key: "used_days",
            align: "center",
            render: (val) => val || 0
        },
        {
            title: "Remaining",
            dataIndex: "remaining_days",
            key: "remaining_days",
            align: "center",
            render: (val, record) => {
                // Calculate percentage for visual indicator
                const total = record.total_days || 1;
                const percent = Math.round((val / total) * 100);

                let color = "#52c41a"; // Green
                if (percent < 20) color = "#ff4d4f"; // Red
                else if (percent < 50) color = "#faad14"; // Orange

                return (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 'bold' }}>{val}</span>
                        <Tooltip title={`${percent}% Remaining`}>
                            <Progress
                                percent={percent}
                                steps={5}
                                size="small"
                                strokeColor={color}
                                showInfo={false}
                                style={{ width: 60 }}
                            />
                        </Tooltip>
                    </div>
                );
            }
        }
    ];

    if (loading) return <LoadingState title="Loading leave balances..." />;

    return (
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <PageHeader
                title="Leave Balance"
                subtitle={`Current year: ${new Date().getFullYear()}`}
            />

            {error && (
                <Alert
                    type="error"
                    message="Error"
                    description={error}
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={balances}
                    columns={columns}
                    rowKey="leave_type"
                    pagination={false}
                    locale={{ emptyText: "No leave balance data found." }}
                />
            </Card>
        </div>
    );
}
