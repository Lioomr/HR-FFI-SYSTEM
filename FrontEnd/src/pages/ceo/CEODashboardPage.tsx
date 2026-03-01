import { useEffect, useState } from "react";
import { Card, Statistic, Row, Col, Button, Space } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import { getCEOLeaveRequests } from "../../services/api/leaveApi";
import { getCEOLoanRequests } from "../../services/api/loanApi";
import { isApiError } from "../../services/api/apiTypes";
import AnnouncementWidget from "../../components/announcements/AnnouncementWidget";
import { useI18n } from "../../i18n/useI18n";

export default function CEODashboardPage() {
    const { t } = useI18n();
    const [pendingLeaves, setPendingLeaves] = useState(0);
    const [pendingLoans, setPendingLoans] = useState(0);

    useEffect(() => {
        async function fetchStats() {
            try {
                const leavesRes = await getCEOLeaveRequests({ page: 1, page_size: 1 });
                if (!isApiError(leavesRes) && leavesRes.data) {
                    setPendingLeaves(leavesRes.data.count || 0);
                }

                const loansRes = await getCEOLoanRequests({ status: "pending_ceo", page: 1, page_size: 1 });
                if (!isApiError(loansRes) && loansRes.data) {
                    setPendingLoans(loansRes.data.count || 0);
                }
            } catch (err) {
                console.error(err);
            }
        }
        fetchStats();
    }, []);

    return (
        <div>
            <PageHeader
                title={t("ceo.dashboard.title")}
                subtitle={t("ceo.dashboard.subtitle")}
            />

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12}>
                    <Card>
                        <Statistic
                            title={t("ceo.dashboard.pendingLeaveRequests")}
                            value={pendingLeaves}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: pendingLeaves > 0 ? '#cf1322' : '#3f8600' }}
                        />
                        <Link to="/ceo/leave/requests">{t("ceo.dashboard.viewLeaveRequests")}</Link>
                    </Card>
                </Col>
                <Col xs={24} sm={12}>
                    <Card>
                        <Statistic
                            title={t("ceo.dashboard.pendingLoanRequests")}
                            value={pendingLoans}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: pendingLoans > 0 ? '#cf1322' : '#3f8600' }}
                        />
                        <Link to="/ceo/loan-requests">{t("ceo.dashboard.viewLoanRequests")}</Link>
                    </Card>
                </Col>
            </Row>

            <Card title={t("ceo.dashboard.quickActions")} style={{ marginTop: 24 }}>
                <Space>
                    <Link to="/ceo/leave/requests">
                        <Button type="primary" size="large">{t("ceo.dashboard.reviewLeaves")}</Button>
                    </Link>
                    <Link to="/ceo/loan-requests">
                        <Button type="primary" size="large">{t("ceo.dashboard.reviewLoans")}</Button>
                    </Link>
                </Space>
            </Card>

            <div style={{ marginTop: 24 }}>
                <AnnouncementWidget role="CEO" />
            </div>
        </div>
    );
}
