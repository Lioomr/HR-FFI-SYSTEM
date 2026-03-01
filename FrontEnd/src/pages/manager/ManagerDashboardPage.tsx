import { useEffect, useState } from "react";
import { Card, Statistic, Row, Col, Button } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, TeamOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import { getManagerLeaveRequests, getManagerAttendance, getManagerTeam } from "../../services/api/managerApi";
import { getManagerLoanRequests } from "../../services/api/loanApi";
import { isApiError } from "../../services/api/apiTypes";
import AnnouncementWidget from "../../components/announcements/AnnouncementWidget";
import { useI18n } from "../../i18n/useI18n";

export default function ManagerDashboardPage() {
    const { t } = useI18n();
    const [pendingLeaves, setPendingLeaves] = useState(0);
    const [pendingLoans, setPendingLoans] = useState(0);
    const [pendingAttendance, setPendingAttendance] = useState(0);
    const [teamCount, setTeamCount] = useState(0);

    useEffect(() => {
        async function fetchStats() {
            try {
                const leavesRes = await getManagerLeaveRequests("pending_manager");
                if (!isApiError(leavesRes) && leavesRes.data) {
                    setPendingLeaves(leavesRes.data.length);
                }

                const loansRes = await getManagerLoanRequests({ status: "pending_manager" });
                if (!isApiError(loansRes) && loansRes.data) {
                    setPendingLoans(loansRes.data.count || loansRes.data.items?.length || 0);
                }

                const attRes = await getManagerAttendance("PENDING_MGR");
                if (!isApiError(attRes) && attRes.data) {
                    setPendingAttendance(attRes.data.length);
                }

                const teamRes = await getManagerTeam();
                if (!isApiError(teamRes) && teamRes.data) {
                    setTeamCount(teamRes.data.length);
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
                title={t("manager.dashboard.title")}
                subtitle={t("manager.dashboard.subtitle")}
            />

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={6}>
                    <Card>
                        <Statistic
                            title={t("manager.dashboard.pendingLeaveRequests")}
                            value={pendingLeaves}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: pendingLeaves > 0 ? '#cf1322' : '#3f8600' }}
                        />
                        <Link to="/manager/team-requests?tab=leave">{t("manager.dashboard.viewRequests")}</Link>
                    </Card>
                </Col>
                <Col xs={24} sm={6}>
                    <Card>
                        <Statistic
                            title={t("manager.dashboard.pendingLoanRequests")}
                            value={pendingLoans}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: pendingLoans > 0 ? '#cf1322' : '#3f8600' }}
                        />
                        <Link to="/manager/loan-requests">{t("manager.dashboard.viewRequests")}</Link>
                    </Card>
                </Col>
                <Col xs={24} sm={6}>
                    <Card>
                        <Statistic
                            title={t("manager.dashboard.pendingAttendance")}
                            value={pendingAttendance}
                            prefix={<CheckCircleOutlined />}
                            valueStyle={{ color: pendingAttendance > 0 ? '#faad14' : '#3f8600' }}
                        />
                        <Link to="/manager/team-requests?tab=attendance">{t("manager.dashboard.viewAttendance")}</Link>
                    </Card>
                </Col>
                <Col xs={24} sm={6}>
                    <Card>
                        <Statistic
                            title={t("manager.dashboard.myTeam")}
                            value={teamCount}
                            prefix={<TeamOutlined />}
                        />
                        <Link to="/manager/team">{t("manager.dashboard.viewTeam")}</Link>
                    </Card>
                </Col>
            </Row>

            <Card title={t("manager.dashboard.quickActions")} style={{ marginTop: 24 }}>
                <Link to="/manager/team-requests">
                    <Button type="primary" size="large">{t("manager.dashboard.reviewPendingApprovals")}</Button>
                </Link>
            </Card>

            <div style={{ marginTop: 24 }}>
                <AnnouncementWidget role="manager" />
            </div>
        </div>
    );
}
