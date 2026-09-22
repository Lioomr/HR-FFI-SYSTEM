import { useEffect, useState } from "react";
import { Button, Col, Grid, Row } from "antd";
import { DollarOutlined, InboxOutlined, TeamOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import LoadingState from "../../../components/ui/LoadingState";
import ErrorState from "../../../components/ui/ErrorState";
import StatCard from "../../../components/ui/StatCard";
import DashboardPanel from "../../../components/hr/dashboard/DashboardPanel";
import ExpiringDocumentsPanel from "../../../components/hr/dashboard/ExpiringDocumentsPanel";
import RecentActivityFeed from "../../../components/hr/dashboard/RecentActivityFeed";
import WorkforceStatusChart from "../../../components/hr/dashboard/WorkforceStatusChart";
import NationalityChart from "../../../components/hr/dashboard/NationalityChart";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import Unauthorized403Page from "../../Unauthorized403Page";
import { getHrSummary } from "../../../services/api/hrSummaryApi";
import type {
  ExpiringDocumentsSummary,
  HRSummary,
  NationalityBreakdown,
  WorkforceStatus,
} from "../../../services/api/hrSummaryApi";
import { getPendingRequests } from "../../../services/api/pendingRequestsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import AnnouncementWidget from "../../../components/announcements/AnnouncementWidget";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";

const { useBreakpoint } = Grid;

const ACTIVITY_PREVIEW_SIZE = 5;

/** Backend sends "M/YYYY"; render it as a readable month when parseable. */
function formatPayrollPeriod(period: string | null | undefined) {
  if (!period) return null;
  const match = period.match(/^(\d{1,2})\/(\d{4})$/);
  if (!match) return period;
  const parsed = dayjs(`${match[2]}-${match[1].padStart(2, "0")}-01`);
  return parsed.isValid() ? parsed.format("MMMM YYYY") : period;
}

const EMPTY_WORKFORCE_STATUS: WorkforceStatus = {
  currently_employed: 0,
  on_leave_outside: 0,
  on_leave_inside: 0,
  archived: 0,
};

const EMPTY_EXPIRING_DOCUMENTS: ExpiringDocumentsSummary = {
  window_days: 30,
  employee_count: 0,
  by_type: {
    national_id: 0,
    iqama: 0,
    passport: 0,
    work_license: 0,
    contract: 0,
    health_insurance: 0,
  },
  soonest: [],
};

const EMPTY_NATIONALITY_BREAKDOWN: NationalityBreakdown = {
  saudi_active: 0,
  active_total: 0,
  nationalities: [],
};

export default function HRDashboardPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  // The activity table only reads well with real width; below that it stacks
  // rather than scrolling sideways inside the card.
  const stackActivity = !screens.lg;
  const user = useAuthStore((state) => state.user);
  const isHeadOffice = isHeadOfficeOrganization(user);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [summary, setSummary] = useState<HRSummary | null>(null);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  const loadSummary = async () => {
    setLoading(true);
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
  const inactiveEmployees = Math.max(totalEmployees - activeEmployees, 0);
  const activeInactiveCaption = t("hr.dashboard.activeInactive", {
    active: activeEmployees.toLocaleString(),
    inactive: inactiveEmployees.toLocaleString(),
  });
  const expiringDocuments =
    summary?.expiring_documents ?? EMPTY_EXPIRING_DOCUMENTS;
  const openExpiries = () => navigate("/hr/employees/expiries");
  const workforceStatus = summary?.workforce_status ?? EMPTY_WORKFORCE_STATUS;
  const nationalityBreakdown =
    summary?.nationality_breakdown ?? EMPTY_NATIONALITY_BREAKDOWN;
  const payrollNet = summary?.latest_payroll?.latest_total_net ?? null;
  const payrollPeriod = formatPayrollPeriod(
    summary?.latest_payroll?.latest_period,
  );
  const payrollCaption =
    payrollNet === null
      ? t("hr.dashboard.payrollNoRun")
      : `${t("hr.dashboard.netTotal")}${payrollPeriod ? ` · ${payrollPeriod}` : ""}`;
  const payrollTrend = summary?.latest_payroll?.trend_percentage ?? null;
  const payrollTrendLabel =
    payrollTrend === null
      ? null
      : `${payrollTrend > 0 ? "+" : ""}${payrollTrend}%`;
  const recentActivity = (summary?.recent_activity ?? []).slice(
    0,
    ACTIVITY_PREVIEW_SIZE,
  );

  // Three KPI tiles: one row on wide screens, a pair plus a full-width
  // payroll tile on tablets, a single column on phones.
  const kpiColumns = screens.lg ? 3 : screens.sm ? 2 : 1;
  const gutter: [number, number] = isMobile ? [12, 12] : [20, 20];

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
      {/* ─── KPI summaries ──────────────────────────────────────────── */}
      <div
        role="list"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${kpiColumns}, minmax(0, 1fr))`,
          gap: gutter[0],
          marginBottom: isMobile ? 12 : 20,
        }}
      >
        <div role="listitem">
          <StatCard
            title={t("hr.dashboard.totalEmployees")}
            value={totalEmployees.toLocaleString()}
            caption={activeInactiveCaption}
            icon={<TeamOutlined />}
            color="#f97316"
            compact={isMobile}
            onClick={() => navigate("/hr/employees")}
            ariaLabel={`${t("hr.dashboard.totalEmployees")}: ${totalEmployees}. ${activeInactiveCaption}`}
            animDelay={0}
          />
        </div>
        <div role="listitem">
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
        </div>
        <div
          role="listitem"
          style={{ gridColumn: kpiColumns === 2 ? "1 / -1" : undefined }}
        >
          <StatCard
            title={t("hr.dashboard.latestPayrollRun")}
            value={
              payrollNet === null ? (
                "—"
              ) : (
                <AmountWithSAR
                  amount={payrollNet}
                  size={isMobile ? 16 : 20}
                  color="#334155"
                />
              )
            }
            caption={payrollCaption}
            trend={payrollTrendLabel}
            trendLabel={t("hr.dashboard.vsPreviousMonth")}
            note={
              payrollNet !== null && payrollTrendLabel === null
                ? { label: t("hr.dashboard.noComparison"), tone: "info" }
                : undefined
            }
            icon={<DollarOutlined />}
            color="#059669"
            compact={isMobile}
            onClick={() => navigate("/hr/payroll")}
            ariaLabel={`${t("hr.dashboard.latestPayrollRun")}: ${payrollCaption}`}
            animDelay={240}
          />
        </div>
      </div>

      {/* ─── Workforce analytics ────────────────────────────────────── */}
      <Row gutter={gutter} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={24} lg={12}>
          <DashboardPanel
            title={t("hr.dashboard.workforceStatus")}
            description={t("hr.dashboard.workforceStatusDesc")}
            bodyPadding={18}
            animDelay={220}
          >
            <WorkforceStatusChart status={workforceStatus} />
          </DashboardPanel>
        </Col>
        <Col xs={24} lg={12}>
          <DashboardPanel
            title={t("hr.dashboard.nationality")}
            description={t("hr.dashboard.nationalityDesc")}
            bodyPadding={18}
            animDelay={260}
          >
            <NationalityChart breakdown={nationalityBreakdown} />
          </DashboardPanel>
        </Col>
      </Row>

      {/* ─── Expiring documents + announcements (equal height) ─────── */}
      <Row gutter={gutter} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={24} lg={15}>
          <DashboardPanel
            title={t("hr.dashboard.expiringDocsTitle")}
            description={t("hr.dashboard.expiringDocsDesc", {
              count: expiringDocuments.employee_count.toString(),
              days: expiringDocuments.window_days.toString(),
            })}
            action={
              <Button
                type="link"
                onClick={openExpiries}
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
            bodyPadding={18}
            animDelay={340}
          >
            <ExpiringDocumentsPanel
              summary={expiringDocuments}
              onOpen={openExpiries}
            />
          </DashboardPanel>
        </Col>

        <Col xs={24} lg={9}>
          <div
            className="animate-fade-in-up"
            style={{ animationDelay: "380ms", height: "100%" }}
          >
            <AnnouncementWidget role="hr" />
          </div>
        </Col>
      </Row>

      {/* ─── Recent activity (full width) ────────────────────────────── */}
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
        animDelay={420}
      >
        <RecentActivityFeed
          items={recentActivity}
          showCompany={isHeadOffice}
          stacked={stackActivity}
        />
      </DashboardPanel>
    </div>
  );
}
