import { useEffect, useState } from "react";
import { Button, Col, Grid, Row, Tag, Tooltip } from "antd";
import {
  CalendarOutlined,
  FileExclamationOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  TeamOutlined,
  UploadOutlined,
  UserAddOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import PageHeader from "../../../components/ui/PageHeader";
import StatCard from "../../../components/ui/StatCard";
import DashboardPanel from "../../../components/hr/dashboard/DashboardPanel";
import PendingApprovalsList from "../../../components/hr/dashboard/PendingApprovalsList";
import RecentActivityFeed from "../../../components/hr/dashboard/RecentActivityFeed";
import WorkforcePayrollPanel from "../../../components/hr/dashboard/WorkforcePayrollPanel";
import Unauthorized403Page from "../../Unauthorized403Page";
import { getHrSummary } from "../../../services/api/hrSummaryApi";
import type { HRSummary } from "../../../services/api/hrSummaryApi";
import { getPendingRequests } from "../../../services/api/pendingRequestsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import AnnouncementWidget from "../../../components/announcements/AnnouncementWidget";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import {
  getActiveOrganization,
  isHeadOfficeOrganization,
} from "../../../utils/organizationContext";

const { useBreakpoint } = Grid;

const ACTIVITY_PREVIEW_SIZE = 5;

export default function HRDashboardPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  // The activity table only reads well once the column has real width; below
  // that it stacks rather than scrolling sideways inside the card.
  const stackActivity = !screens.xl;
  const user = useAuthStore((state) => state.user);
  const activeOrganization = getActiveOrganization(user);
  const isHeadOffice = isHeadOfficeOrganization(user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [summary, setSummary] = useState<HRSummary | null>(null);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  const loadSummary = async ({
    isRefresh = false,
  }: { isRefresh?: boolean } = {}) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [response, pendingResponse] = await Promise.all([
        getHrSummary(),
        getPendingRequests({ page: 1, page_size: 1 }),
      ]);
      if (isApiError(response)) {
        setError(response.message || t("error.loadDashboard"));
        return;
      }
      if (!isApiError(pendingResponse)) {
        setPendingRequestsCount(pendingResponse.data.count || 0);
      }
      setSummary(response.data);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        return;
      }
      setError(err.message || t("error.loadDashboard"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <Unauthorized403Page />;
  if (loading) return <LoadingState title={t("loading.dashboard")} />;
  if (error)
    return (
      <ErrorState
        title={t("error.loadDashboard")}
        description={error}
        onRetry={() => loadSummary()}
      />
    );

  const totalEmployees = summary?.total_employees ?? 0;
  const activeEmployees = summary?.active_employees ?? 0;
  const expiringDocs = summary?.expiring_docs ?? 0;
  const pendingLeaves = summary?.pending_leaves ?? 0;
  const pendingApprovals = summary?.pending_approvals ?? [];
  const recentActivity = (summary?.recent_activity ?? []).slice(
    0,
    ACTIVITY_PREVIEW_SIZE,
  );

  // ─── Primary HR actions — kept in the page header so they are always the
  //     first interactive elements after the title. ─────────────────────────
  const quickActions = [
    {
      key: "add-employee",
      label: t("hr.dashboard.addEmployee"),
      icon: <UserAddOutlined />,
      path: "/hr/employees/create",
      primary: true,
    },
    {
      key: "import-employees",
      label: t("hr.dashboard.uploadExcel"),
      icon: <UploadOutlined />,
      path: "/hr/import/employees",
      primary: false,
    },
    {
      key: "run-payroll",
      label: t("hr.dashboard.runPayroll"),
      icon: <PlayCircleOutlined />,
      path: "/hr/payroll",
      primary: false,
    },
  ];

  const headerActions = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        width: isMobile ? "100%" : undefined,
      }}
    >
      {quickActions.map((action) => {
        const button = (
          <Button
            key={action.key}
            type={action.primary ? "primary" : "default"}
            icon={action.icon}
            disabled={isHeadOffice}
            onClick={() => navigate(action.path)}
            className="press-scale"
            style={{
              borderRadius: 10,
              minHeight: 40,
              flex: isMobile ? "1 1 auto" : undefined,
            }}
          >
            {action.label}
          </Button>
        );
        return isHeadOffice ? (
          <Tooltip
            key={action.key}
            title={t("organization.headOffice.switchToUseAction")}
          >
            <span
              style={{
                display: "inline-flex",
                flex: isMobile ? "1 1 auto" : undefined,
              }}
            >
              {button}
            </span>
          </Tooltip>
        ) : (
          button
        );
      })}
      <Button
        icon={<ReloadOutlined />}
        loading={refreshing}
        onClick={() => loadSummary({ isRefresh: true })}
        aria-label={t("common.refresh")}
        style={{ borderRadius: 10, minHeight: 40 }}
      >
        {t("common.refresh")}
      </Button>
    </div>
  );

  const gutter: [number, number] = isMobile ? [12, 12] : [20, 20];

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
      <PageHeader
        title={t("hr.dashboard.title")}
        subtitle={activeOrganization?.name}
        secondarySubtitle={t("hr.dashboard.overviewContext")}
        actions={headerActions}
      />

      {/* ─── KPI summaries ──────────────────────────────────────────── */}
      <Row
        gutter={gutter}
        style={{ marginBottom: isMobile ? 12 : 20 }}
        role="list"
      >
        <Col xs={24} sm={12} xl={6} role="listitem">
          <StatCard
            title={t("hr.dashboard.totalEmployees")}
            value={totalEmployees.toLocaleString()}
            caption={t("hr.dashboard.activeCount", {
              count: activeEmployees.toLocaleString(),
            })}
            icon={<TeamOutlined />}
            color="#f97316"
            compact={isMobile}
            onClick={() => navigate("/hr/employees")}
            ariaLabel={`${t("hr.dashboard.totalEmployees")}: ${totalEmployees}. ${t(
              "hr.dashboard.activeCount",
              { count: activeEmployees.toLocaleString() },
            )}`}
            animDelay={0}
          />
        </Col>
        <Col xs={24} sm={12} xl={6} role="listitem">
          <StatCard
            title={t("pendingInbox.title", "Pending Requests")}
            value={pendingRequestsCount.toLocaleString()}
            caption={t("hr.dashboard.assignedToYou")}
            icon={<InboxOutlined />}
            color="#6366f1"
            compact={isMobile}
            onClick={() => navigate("/pending-inbox")}
            ariaLabel={`${t("pendingInbox.title", "Pending Requests")}: ${pendingRequestsCount}. ${t(
              "hr.dashboard.assignedToYou",
            )}`}
            animDelay={60}
          />
        </Col>
        <Col xs={24} sm={12} xl={6} role="listitem">
          <StatCard
            title={t("hr.dashboard.leaveAwaitingHr")}
            value={pendingLeaves.toLocaleString()}
            caption={t("hr.dashboard.acrossCompany")}
            icon={<CalendarOutlined />}
            color="#0ea5e9"
            compact={isMobile}
            onClick={() => navigate("/hr/leave/requests")}
            ariaLabel={`${t("hr.dashboard.leaveAwaitingHr")}: ${pendingLeaves}. ${t(
              "hr.dashboard.acrossCompany",
            )}`}
            animDelay={120}
          />
        </Col>
        <Col xs={24} sm={12} xl={6} role="listitem">
          <StatCard
            title={t("hr.dashboard.expiringDocs")}
            value={expiringDocs.toLocaleString()}
            caption={t("hr.dashboard.expiringDocsCaption")}
            icon={<FileExclamationOutlined />}
            color="#d97706"
            compact={isMobile}
            note={
              expiringDocs > 0
                ? {
                    label: t("hr.dashboard.actionNeeded"),
                    icon: <WarningOutlined aria-hidden />,
                    tone: "warning",
                  }
                : undefined
            }
            onClick={() => navigate("/hr/employees/expiries")}
            ariaLabel={`${t("hr.dashboard.expiringDocs")}: ${expiringDocs}. ${t(
              "hr.dashboard.expiringDocsCaption",
            )}`}
            animDelay={180}
          />
        </Col>
      </Row>

      {/* ─── Pending actions + payroll/workforce trend ───────────────── */}
      <Row
        gutter={gutter}
        align="top"
        style={{ marginBottom: isMobile ? 12 : 20 }}
      >
        <Col xs={24} lg={15}>
          <DashboardPanel
            title={t("hr.dashboard.needsAttention")}
            titleSuffix={
              pendingRequestsCount > 0 ? (
                <Tag
                  color="orange"
                  style={{
                    margin: 0,
                    borderRadius: 20,
                    fontWeight: 700,
                    fontSize: 11,
                  }}
                >
                  {pendingRequestsCount}
                </Tag>
              ) : undefined
            }
            description={
              pendingRequestsCount > pendingApprovals.length
                ? t("hr.dashboard.showingOf", {
                    shown: pendingApprovals.length.toString(),
                    total: pendingRequestsCount.toString(),
                  })
                : undefined
            }
            action={
              <Button
                type="link"
                onClick={() => navigate("/pending-inbox")}
                style={{
                  padding: 0,
                  fontWeight: 600,
                  color: "#ea580c",
                  minHeight: 40,
                }}
              >
                {t("hr.dashboard.openInbox")}
              </Button>
            }
            animDelay={220}
          >
            <PendingApprovalsList
              items={pendingApprovals}
              showCompany={isHeadOffice}
              isMobile={isMobile}
            />
          </DashboardPanel>
        </Col>

        <Col xs={24} lg={9}>
          <DashboardPanel
            title={t("hr.dashboard.payrollAndWorkforce")}
            bodyPadding={18}
            animDelay={260}
          >
            <WorkforcePayrollPanel
              totalEmployees={totalEmployees}
              activeEmployees={activeEmployees}
              payroll={summary?.latest_payroll}
            />
          </DashboardPanel>
        </Col>
      </Row>

      {/* ─── Recent activity + announcements ─────────────────────────── */}
      <Row gutter={gutter}>
        <Col xs={24} lg={15}>
          <DashboardPanel
            title={t("hr.dashboard.recentActivity")}
            bodyPadding={stackActivity ? 12 : 0}
            action={
              <Button
                type="link"
                onClick={() => navigate("/hr/activity")}
                style={{
                  padding: 0,
                  fontWeight: 600,
                  color: "#ea580c",
                  minHeight: 40,
                }}
              >
                {t("common.viewAll")}
              </Button>
            }
            animDelay={300}
          >
            <RecentActivityFeed
              items={recentActivity}
              showCompany={isHeadOffice}
              stacked={stackActivity}
            />
          </DashboardPanel>
        </Col>

        <Col xs={24} lg={9}>
          <div
            className="animate-fade-in-up"
            style={{ animationDelay: "340ms", height: "100%" }}
          >
            <AnnouncementWidget role="hr" />
          </div>
        </Col>
      </Row>
    </div>
  );
}
