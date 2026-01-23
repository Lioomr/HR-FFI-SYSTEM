import { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Tag } from "antd";
import { UserOutlined, TeamOutlined, DollarOutlined, CalendarOutlined } from "@ant-design/icons";
import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { getHrSummary } from "../../../services/api/hrSummaryApi";
import type { HRSummary } from "../../../services/api/hrSummaryApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";

export default function HRDashboardPage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [summary, setSummary] = useState<HRSummary | null>(null);

    /**
     * Load HR summary data
     */
    const loadSummary = async () => {
        setLoading(true);
        setError(null);
        setForbidden(false);

        try {
            const response = await getHrSummary();

            if (isApiError(response)) {
                setError(response.message || "Failed to load HR summary");
                setLoading(false);
                return;
            }

            setSummary(response.data);
            setLoading(false);
        } catch (err: any) {
            if (isForbidden(err)) {
                setForbidden(true);
                setLoading(false);
                return;
            }

            setError(err.message || "Failed to load HR summary");
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSummary();
    }, []);

    // Render 403 page
    if (forbidden) {
        return <Unauthorized403Page />;
    }

    // Render loading state
    if (loading) {
        return <LoadingState title="Loading dashboard..." />;
    }

    // Render error state
    if (error) {
        return (
            <ErrorState
                title="Failed to load dashboard"
                description={error}
                onRetry={loadSummary}
            />
        );
    }

    // Render empty state (only if truly empty)
    if (!summary || (summary.total_employees === undefined && summary.active_employees === undefined)) {
        return (
            <EmptyState
                title="No data available"
                description="HR summary data is not available"
            />
        );
    }

    return (
        <div>
            <PageHeader title="HR Dashboard" />

            <Row gutter={[16, 16]}>
                {/* Total Employees Card */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: 16 }}>
                        <Statistic
                            title="Total Employees"
                            value={summary.total_employees ?? 0}
                            prefix={<TeamOutlined />}
                            valueStyle={{ color: "#1890ff" }}
                        />
                    </Card>
                </Col>

                {/* Active Employees Card */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: 16 }}>
                        <Statistic
                            title="Active Employees"
                            value={summary.active_employees ?? 0}
                            prefix={<UserOutlined />}
                            valueStyle={{ color: "#52c41a" }}
                        />
                    </Card>
                </Col>

                {/* Payroll Placeholder Card */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: 16, opacity: 0.6 }}>
                        <Statistic
                            title={
                                <span>
                                    Payroll <Tag color="orange">Coming Soon</Tag>
                                </span>
                            }
                            value="—"
                            prefix={<DollarOutlined />}
                            valueStyle={{ color: "#8c8c8c" }}
                        />
                    </Card>
                </Col>

                {/* Leave Placeholder Card */}
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={{ borderRadius: 16, opacity: 0.6 }}>
                        <Statistic
                            title={
                                <span>
                                    Leave <Tag color="orange">Coming Soon</Tag>
                                </span>
                            }
                            value="—"
                            prefix={<CalendarOutlined />}
                            valueStyle={{ color: "#8c8c8c" }}
                        />
                    </Card>
                </Col>
            </Row>
        </div>
    );
}
