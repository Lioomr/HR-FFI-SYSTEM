import { useCallback, useEffect, useState } from "react";
import { Card, Table, Alert, Progress, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import { useI18n } from "../../../i18n/useI18n";
import { getMyLeaveBalance, type LeaveBalance } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";

export default function MyLeaveBalancePage() {
    const { t } = useI18n();
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
            setError(err.message || t("common.tryAgain"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        loadBalances();
    }, [loadBalances]);

    const columns: ColumnsType<LeaveBalance> = [
        {
            title: t("leave.type"),
            dataIndex: "leave_type",
            key: "leave_type",
            render: (text) => {
                const translationKey = `leave.balance.${text.toLowerCase().replace(/\s+/g, '.')}`;
                const translated = t(translationKey, text);
                return <Typography.Text strong>{translated}</Typography.Text>;
            }
        },
        {
            title: t("leave.allowed"),
            dataIndex: "total_days",
            key: "total_days",
            align: "center",
            render: (val) => val || 0
        },
        {
            title: t("leave.used"),
            dataIndex: "used_days",
            key: "used_days",
            align: "center",
            render: (val) => val || 0
        },
        {
            title: t("leave.remaining"),
            dataIndex: "remaining_days",
            key: "remaining_days",
            align: "center",
            render: (val, record) => {
                const total = record.total_days || 1;
                const percent = Math.round((val / total) * 100);

                let color = "#52c41a";
                if (percent < 20) color = "#ff4d4f";
                else if (percent < 50) color = "#faad14";

                return (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 'bold' }}>{val}</span>
                        <Tooltip title={`${percent}% ${t("leave.remaining")}`}>
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

    if (loading) return <LoadingState title={t("loading.generic")} />;

    return (
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <PageHeader
                title={t("leave.balanceTitle")}
                subtitle={`${t("leave.currentYear")}: ${new Date().getFullYear()}`}
            />

            {error && (
                <Alert
                    type="error"
                    message={t("common.error")}
                    description={error}
                    showIcon
                    style={{ marginBottom: 16 }}
                />
            )}

            <Card style={{ borderRadius: 16 }}>
                <Table
                    dataSource={balances}
                    columns={columns}
                    rowKey="leave_type_id"
                    pagination={false}
                    locale={{ emptyText: t("common.noData") }}
                />
            </Card>
        </div>
    );
}
