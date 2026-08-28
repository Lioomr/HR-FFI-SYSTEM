import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Col,
  Grid,
  Row,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ContainerOutlined,
  EyeInvisibleOutlined,
  MailOutlined,
  PhoneOutlined,
  RightOutlined,
  UserOutlined,
} from "@ant-design/icons";

import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import DashboardPanel from "../../components/hr/dashboard/DashboardPanel";
import ApprovalStatusTag from "../../components/ceo/ApprovalStatusTag";
import { approvalStatusLabel } from "../../components/ceo/approvalStatusLabel";
import TeamMemberCell from "../../components/manager/TeamMemberCell";
import EmployeeLeaveBalances from "../hr/employees/components/EmployeeLeaveBalances";
import { getCountryFlag } from "../../utils/countries";
import { getEmployee, type Employee } from "../../services/api/employeesApi";
import {
  getManagerWorkSummary,
  type ManagerPendingItem,
} from "../../services/api/managerSummaryApi";
import { isApiError } from "../../services/api/apiTypes";
import { requestAgeLabel } from "../../utils/requestAge";
import { useI18n } from "../../i18n/useI18n";

const { useBreakpoint } = Grid;
const { Text } = Typography;

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

const formatDate = (value: unknown): string => {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
    return value.split("T")[0];
  return formatValue(value);
};

/** One labelled fact inside a detail panel. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#94a3b8",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: "#0f172a", overflowWrap: "anywhere" }}>
        {children}
      </div>
    </div>
  );
}

function FieldGrid({
  children,
  isMobile,
}: {
  children: React.ReactNode;
  isMobile: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile
          ? "1fr"
          : "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 18,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Read-only profile of a direct report.
 *
 * A manager reviews people here but never edits them, so the page carries no
 * write affordances at all — record changes stay with HR.
 */
export default function ManagerEmployeeProfilePage() {
  const { t, language } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const isRtl = language === "ar";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [notInTeam, setNotInTeam] = useState(false);
  const [pendingItems, setPendingItems] = useState<ManagerPendingItem[] | null>(
    null,
  );

  const loadEmployee = useCallback(async () => {
    if (!id) {
      setError(t("manager.team.profile.loadFailed"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotInTeam(false);
    try {
      const response = await getEmployee(id);
      if (isApiError(response)) {
        const msg = (response.message || "").toLowerCase();
        if (
          msg.includes("not found") ||
          msg.includes("403") ||
          msg.includes("forbidden")
        ) {
          setNotInTeam(true);
        } else {
          setError(response.message || t("manager.team.profile.loadFailed"));
        }
        return;
      }
      setEmployee(response.data);
    } catch (err: unknown) {
      const anyErr = err as {
        response?: { status?: number };
        message?: string;
      };
      if (
        anyErr?.response?.status === 404 ||
        anyErr?.response?.status === 403
      ) {
        setNotInTeam(true);
      } else {
        setError(anyErr?.message || t("manager.team.profile.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void loadEmployee();
  }, [loadEmployee]);

  // Open requests are supporting context: a failure here leaves the panel out
  // rather than breaking the profile.
  useEffect(() => {
    let cancelled = false;
    getManagerWorkSummary()
      .then((summary) => {
        if (!cancelled) setPendingItems(summary.items);
      })
      .catch(() => {
        if (!cancelled) setPendingItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const employeeEmail = employee?.email?.toLowerCase() || "";
  const openRequests = useMemo(() => {
    if (!pendingItems || !employeeEmail) return [];
    return pendingItems.filter(
      (item) => item.employeeEmail.toLowerCase() === employeeEmail,
    );
  }, [pendingItems, employeeEmail]);

  const handleBack = () => navigate("/manager/team");

  if (loading) return <LoadingState title={t("common.loading")} />;

  if (error) {
    return (
      <ErrorState
        title={t("manager.team.profile.loadFailed")}
        description={error}
        onRetry={loadEmployee}
      />
    );
  }

  if (notInTeam || !employee) {
    return (
      <EmptyState
        title={t("manager.team.profile.notFound")}
        description={t("manager.team.profile.notFoundDesc")}
        actionText={t("manager.team.profile.back")}
        onAction={handleBack}
      />
    );
  }

  const emp = employee as unknown as Record<string, unknown>;
  const gutter: [number, number] = isMobile ? [12, 12] : [20, 20];

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", paddingBottom: 24 }}>
      <Button
        type="link"
        icon={
          isRtl ? (
            <ArrowRightOutlined aria-hidden />
          ) : (
            <ArrowLeftOutlined aria-hidden />
          )
        }
        onClick={handleBack}
        style={{ paddingInlineStart: 0, marginBottom: 8, fontWeight: 600 }}
      >
        {t("manager.team.profile.back")}
      </Button>

      <PageHeader
        title={employee.full_name || t("manager.team.profile.title")}
        subtitle={employee.position || undefined}
        secondarySubtitle={employee.department || undefined}
        breadcrumb={t("manager.team.title")}
        tags={
          <Space size={6} wrap>
            {employee.employee_id && (
              <Tag
                className="tabular-nums"
                style={{
                  marginInlineEnd: 0,
                  borderRadius: 999,
                  paddingInline: 10,
                  background: "#f8fafc",
                  borderColor: "#e2e8f0",
                  color: "#475569",
                  fontWeight: 600,
                }}
              >
                #{employee.employee_id}
              </Tag>
            )}
            <Tag
              color={
                String(employee.employment_status || "ACTIVE").toUpperCase() ===
                "ACTIVE"
                  ? "green"
                  : "default"
              }
              style={{
                marginInlineEnd: 0,
                borderRadius: 999,
                paddingInline: 10,
                fontWeight: 600,
              }}
            >
              {employee.employment_status || "ACTIVE"}
            </Tag>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        icon={<EyeInvisibleOutlined aria-hidden />}
        message={t("manager.team.profile.readOnlyNote")}
        style={{ borderRadius: 12, marginBottom: isMobile ? 12 : 20 }}
      />

      <Row gutter={gutter} align="top">
        <Col xs={24} lg={15}>
          <Space
            direction="vertical"
            size={isMobile ? 12 : 20}
            style={{ width: "100%" }}
          >
            <DashboardPanel
              title={t("manager.team.profile.identitySection")}
              animDelay={0}
            >
              <TeamMemberCell
                name={employee.full_name}
                secondary={
                  employee.position || employee.department || undefined
                }
                size={52}
              />
              <div style={{ marginTop: 18 }}>
                <FieldGrid isMobile={isMobile}>
                  <Field label={t("common.email")}>
                    {employee.email ? (
                      <Space size={6}>
                        <MailOutlined
                          aria-hidden
                          style={{ color: "#94a3b8" }}
                        />
                        <a href={`mailto:${employee.email}`}>
                          {employee.email}
                        </a>
                      </Space>
                    ) : (
                      "—"
                    )}
                  </Field>
                  <Field label={t("employees.form.mobile")}>
                    {employee.mobile ? (
                      <Space size={6}>
                        <PhoneOutlined
                          aria-hidden
                          style={{ color: "#94a3b8" }}
                        />
                        <a
                          className="tabular-nums"
                          href={`tel:${employee.mobile}`}
                        >
                          {employee.mobile}
                        </a>
                      </Space>
                    ) : (
                      "—"
                    )}
                  </Field>
                  <Field label={t("employees.form.nationality")}>
                    <Space size={6}>
                      <span aria-hidden>
                        {getCountryFlag(emp.nationality as string)}
                      </span>
                      {formatValue(emp.nationality)}
                    </Space>
                  </Field>
                  <Field label={t("employees.form.dateOfBirth")}>
                    <span className="tabular-nums">
                      {formatDate(emp.date_of_birth)}
                    </span>
                  </Field>
                </FieldGrid>
              </div>
            </DashboardPanel>

            <DashboardPanel
              title={t("manager.team.profile.detailsSection")}
              bodyPadding="0 16px 16px"
              animDelay={60}
            >
              <Tabs
                defaultActiveKey="employment"
                items={[
                  {
                    key: "employment",
                    label: (
                      <span>
                        <ContainerOutlined aria-hidden />{" "}
                        {t("hr.employees.employmentInfo")}
                      </span>
                    ),
                    children: (
                      <FieldGrid isMobile={isMobile}>
                        <Field label={t("employees.form.department")}>
                          {formatValue(employee.department)}
                        </Field>
                        <Field label={t("employees.form.position")}>
                          {formatValue(employee.position)}
                        </Field>
                        <Field label={t("employees.form.taskGroup")}>
                          {formatValue(employee.task_group)}
                        </Field>
                        <Field label={t("employees.form.sponsor")}>
                          {formatValue(employee.sponsor)}
                        </Field>
                        <Field label={t("employees.form.joiningDate")}>
                          <span className="tabular-nums">
                            {formatDate(emp.join_date || employee.hire_date)}
                          </span>
                        </Field>
                        <Field label={t("employees.form.contractExpiry")}>
                          <span className="tabular-nums">
                            {formatDate(emp.contract_expiry)}
                          </span>
                        </Field>
                        <Field label={t("employees.form.allowedOvertime")}>
                          <span className="tabular-nums">
                            {formatValue(emp.allowed_overtime)}{" "}
                            {t("hr.employees.hours")}
                          </span>
                        </Field>
                      </FieldGrid>
                    ),
                  },
                  {
                    key: "leave",
                    label: (
                      <span>
                        <UserOutlined aria-hidden />{" "}
                        {t("hr.employees.leaveBalances")}
                      </span>
                    ),
                    children: <EmployeeLeaveBalances employeeId={Number(id)} />,
                  },
                  // Compensation is deliberately absent: a manager
                  // reviews people here, and pay data belongs to the
                  // HR and payroll surfaces.
                ]}
              />
            </DashboardPanel>
          </Space>
        </Col>

        <Col xs={24} lg={9}>
          <div style={{ marginTop: isMobile ? 12 : 0 }}>
            <DashboardPanel
              title={t("manager.team.profile.openRequests")}
              titleSuffix={
                openRequests.length > 0 ? (
                  <Tag
                    color="orange"
                    style={{ margin: 0, borderRadius: 999, fontWeight: 700 }}
                  >
                    {openRequests.length}
                  </Tag>
                ) : undefined
              }
              bodyPadding={0}
              animDelay={120}
            >
              {openRequests.length === 0 ? (
                <div
                  style={{
                    padding: "16px 18px",
                    fontSize: 13,
                    color: "#64748b",
                  }}
                >
                  {pendingItems === null
                    ? t("common.loading")
                    : t("manager.team.profile.noOpenRequests")}
                </div>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {openRequests.map((item, index) => (
                    <li
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        padding: "12px 18px",
                        borderTop:
                          index === 0 ? undefined : "1px solid #f1f5f9",
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 140 }}>
                        <span
                          style={{
                            display: "block",
                            fontWeight: 600,
                            fontSize: 13.5,
                            color: "#0f172a",
                          }}
                        >
                          {t(`manager.queue.type.${item.queue}`)}
                        </span>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {requestAgeLabel(t, item.submittedAt)}
                        </Text>
                      </span>
                      <ApprovalStatusTag
                        label={approvalStatusLabel(item.status, t)}
                        status={item.status}
                      />
                      <Button
                        size="small"
                        icon={<RightOutlined aria-hidden />}
                        onClick={() => navigate(item.path)}
                        aria-label={`${t("common.review")}: ${t(
                          `manager.queue.type.${item.queue}`,
                        )}`}
                        style={{ borderRadius: 8, fontWeight: 600 }}
                      >
                        {t("common.review")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </DashboardPanel>
          </div>
        </Col>
      </Row>
    </div>
  );
}
