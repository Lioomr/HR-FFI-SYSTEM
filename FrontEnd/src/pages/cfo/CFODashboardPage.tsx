import { useEffect, useState } from "react";
import { Card, Statistic, Row, Col, Button } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import { getCFOLoanRequests } from "../../services/api/loanApi";
import { isApiError } from "../../services/api/apiTypes";
import AnnouncementWidget from "../../components/announcements/AnnouncementWidget";
import { useI18n } from "../../i18n/useI18n";

export default function CFODashboardPage() {
    const { t } = useI18n();
    const [pendingLoans, setPendingLoans] = useState(0);

    useEffect(() => {
        async function fetchStats() {
            try {
                const loansRes = await getCFOLoanRequests({ status: "pending_cfo", page: 1, page_size: 1 });
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
                title={t("cfo.dashboard.title")}
                subtitle={t("cfo.dashboard.subtitle")}
            />

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12}>
                    <Card>
                        <Statistic
                            title={t("cfo.dashboard.pendingLoanRequests")}
                            value={pendingLoans}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: pendingLoans > 0 ? '#cf1322' : '#3f8600' }}
                        />
                        <Link to="/cfo/loan-requests">{t("cfo.dashboard.viewLoanRequests")}</Link>
                    </Card>
                </Col>
            </Row>

            <Card title={t("cfo.dashboard.quickActions")} style={{ marginTop: 24 }}>
                <Link to="/cfo/loan-requests">
                    <Button type="primary" size="large">{t("cfo.dashboard.reviewLoans")}</Button>
                </Link>
            </Card>

            <div style={{ marginTop: 24 }}>
                <AnnouncementWidget role="CFO" />
            </div>
        </div>
    );
}
