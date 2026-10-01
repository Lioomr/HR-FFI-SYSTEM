import BackButton from "../../../components/ui/BackButton";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Space,
  Modal,
  Select,
  message,
  Tooltip,
  Avatar,
  Row,
  Col,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  EditOutlined,
  UserAddOutlined,
  DisconnectOutlined,
  UserOutlined,
  ContainerOutlined,
  DollarOutlined,
  FolderOpenOutlined,
  MailOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  InboxOutlined,
  ApartmentOutlined,
  BankOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  GlobalOutlined,
  IdcardOutlined,
  PlusCircleOutlined,
  SolutionOutlined,
  TeamOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import "./ViewEmployeePage.css";
import { getCountryFlag } from "../../../utils/countries";
import EmployeeLeaveBalances from "./components/EmployeeLeaveBalances";
import EmployeeDocumentArchive from "../../../components/employees/EmployeeDocumentArchive";
import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";
import {
  getEmployee,
  restoreEmployee,
} from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";
import {
  listLinkCandidates,
  type LinkCandidateDto,
} from "../../../services/api/usersApi";
import { api } from "../../../services/api/apiClient";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

/**
 * Format value for display (show "—" for missing values)
 */
const formatValue = (value: any): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
};

/**
 * Format currency value
 */
const formatCurrency = (value: any): React.ReactNode => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return <AmountWithSAR amount={value} size={12} />;
};

/**
 * Format date value (YYYY-MM-DD)
 */
const formatDate = (value: any): string => {
  if (!value) {
    return "—";
  }
  // Keep the date portion of ISO and space-separated timestamps.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return formatValue(value);
};

const ALLOWANCE_FIELDS = [
  ["employees.form.transportation", "transportation_allowance"],
  ["employees.form.accommodation", "accommodation_allowance"],
  ["employees.form.telephone", "telephone_allowance"],
  ["employees.form.petrol", "petrol_allowance"],
  ["employees.form.other", "other_allowance"],
] as const;

type ExpiryStatus = "expired" | "warning" | "ok" | "unknown";

function getExpiryInfo(dateStr: string | undefined): {
  status: ExpiryStatus;
  days: number | null;
} {
  if (!dateStr) return { status: "unknown", days: null };
  const expiry = new Date(dateStr);
  if (Number.isNaN(expiry.getTime())) return { status: "unknown", days: null };
  const days = Math.floor((expiry.getTime() - Date.now()) / 86400000);
  if (days < 0) return { status: "expired", days };
  if (days <= 60) return { status: "warning", days };
  return { status: "ok", days };
}

function ExpiryTag({ status }: { status: ExpiryStatus }) {
  const { t } = useI18n();
  if (status === "expired")
    return <Tag color="error">{t("status.expired", "Expired")}</Tag>;
  if (status === "warning") {
    return (
      <Tag color="warning">{t("status.expiringSoon", "Expiring Soon")}</Tag>
    );
  }
  if (status === "ok")
    return <Tag color="success">{t("status.valid", "Valid")}</Tag>;
  return <Tag>{t("status.unknown", "Unknown")}</Tag>;
}

/** "N days left" / "Expired N days ago" for a dated document or contract. */
function useExpiryHint() {
  const { t } = useI18n();
  return (days: number | null) => {
    if (days === null) return null;
    return days < 0
      ? t("employees.view.expiredDaysAgo", { days: Math.abs(days) })
      : t("employees.view.daysLeft", { days });
  };
}

/** Whole years and months since the joining date, or null when unknown. */
function getServiceLength(dateStr: string | undefined) {
  if (!dateStr) return null;
  const start = new Date(dateStr);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12 };
}

function InfoField({
  icon,
  label,
  children,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`emp-field ${className ?? ""}`}>
      <span className="emp-field__icon">{icon}</span>
      <div className="emp-field__body">
        <div className="emp-field__label">{label}</div>
        <div className="emp-field__value">{children}</div>
      </div>
    </div>
  );
}

function StatItem({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: ExpiryStatus;
}) {
  return (
    <div className="emp-stat">
      <span className="emp-stat__icon">{icon}</span>
      <div className="emp-stat__body">
        <div className="emp-stat__label">{label}</div>
        <div
          className={`emp-stat__value ${tone && !hint ? `emp-tone--${tone}` : ""}`}
        >
          {value}
        </div>
        {hint && (
          <div className={`emp-stat__hint ${tone ? `emp-tone--${tone}` : ""}`}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function DocCard({
  label,
  tagLabel,
  tagColor,
  number,
  expiry,
  testId,
}: {
  label: string;
  tagLabel: string;
  tagColor: string;
  number?: string;
  expiry: string | undefined;
  testId?: string;
}) {
  const { t } = useI18n();
  const expiryHint = useExpiryHint();
  const { status, days } = getExpiryInfo(expiry);
  return (
    <div data-testid={testId} className={`emp-doc emp-doc--${status}`}>
      <span className="emp-doc__icon">
        <SafetyCertificateOutlined />
      </span>
      <div className="emp-doc__body">
        <div className="emp-doc__head">
          <span className="emp-doc__label">{label}</span>
          <Space size={4}>
            <ExpiryTag status={status} />
            <Tag color={tagColor}>{tagLabel}</Tag>
          </Space>
        </div>
        {number && number !== "—" && (
          <div className="emp-doc__number" dir="ltr">
            <IdcardOutlined aria-hidden="true" />
            <span>{number}</span>
          </div>
        )}
        <div className="emp-doc__meta">
          <span>
            {t("hr.employees.expires", "Expires")}:{" "}
            <bdi className="emp-doc__expiry-date">{formatDate(expiry)}</bdi>
          </span>
          {status !== "ok" && days !== null && (
            <span className="emp-doc__days">{expiryHint(days)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const { Title, Text } = Typography;

export default function ViewEmployeePage() {
  const { t } = useI18n();
  const expiryHint = useExpiryHint();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeOrganizationId = useAuthStore(
    (state) =>
      state.user?.active_organization_id ??
      state.user?.default_organization_id ??
      null,
  );
  const role = useAuthStore((state) => state.user?.role);
  const canRestoreEmployee = role === "SystemAdmin" || role === "HRManager";
  /** Mirrors the backend rule for document delete and OCR re-run. */
  const canManageDocuments = role === "SystemAdmin" || role === "HRManager";

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [notAvailableInSelectedCompany, setNotAvailableInSelectedCompany] =
    useState(false);

  // Linking User State
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkCandidates, setLinkCandidates] = useState<LinkCandidateDto[]>([]);
  const [linkSearch, setLinkSearch] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);

  // Restore (archived employees only)
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  /**
   * Load employee data
   */
  const loadEmployee = async () => {
    if (!id) {
      setError(t("hr.employees.noIdError"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setForbidden(false);
    setNotAvailableInSelectedCompany(false);

    try {
      const response = await getEmployee(id);

      if (isApiError(response)) {
        if ((response.message || "").toLowerCase().includes("not found")) {
          setNotAvailableInSelectedCompany(true);
          setEmployee(null);
        } else {
          setError(response.message || t("hr.employees.loadFailed"));
        }
        setLoading(false);
        return;
      }

      setEmployee(response.data);
      setLoading(false);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        setLoading(false);
        return;
      }

      if (err?.response?.status === 404) {
        setNotAvailableInSelectedCompany(true);
        setEmployee(null);
        setLoading(false);
        return;
      }

      setError(err.message || t("hr.employees.loadFailed"));
      setLoading(false);
    }
  };
  useEffect(() => {
    loadEmployee();
  }, [id]);

  useEffect(() => {
    if (!employee?.company_id || activeOrganizationId == null) return;

    if (Number(employee.company_id) !== Number(activeOrganizationId)) {
      message.info(
        t(
          "hr.employees.changedCompanyRedirect",
          "This employee belongs to another company. You have been returned to the employee list.",
        ),
      );
      navigate("/hr/employees", { replace: true });
    }
  }, [activeOrganizationId, employee, navigate, t]);

  /** Load a small, company-scoped candidate list instead of the full user directory. */
  useEffect(() => {
    if (!isLinkModalOpen) return;

    let cancelled = false;
    const timer = window.setTimeout(
      async () => {
        setUsersLoading(true);
        try {
          const response = await listLinkCandidates({
            ...(linkSearch.trim() ? { search: linkSearch.trim() } : {}),
            limit: 20,
          });
          if (!cancelled) {
            setLinkCandidates(isApiError(response) ? [] : response.data.items);
          }
        } catch {
          if (!cancelled) message.error(t("hr.employees.loadUsersFailed"));
        } finally {
          if (!cancelled) setUsersLoading(false);
        }
      },
      linkSearch ? 250 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isLinkModalOpen, linkSearch, t]);

  /**
   * Handle Linking User
   */
  const handleLinkUser = async () => {
    if (!selectedUserId || !employee) return;
    setLinking(true);
    try {
      await api.patch(`/employees/${id}`, { user_id: selectedUserId });

      message.success(t("hr.employees.linkSuccess"));
      setIsLinkModalOpen(false);
      setSelectedUserId(null);
      setLinkSearch("");
      loadEmployee();
    } catch (err: any) {
      message.error(
        getDetailedHttpErrorMessage(t, err, "hr.employees.linkFailed"),
      );
    } finally {
      setLinking(false);
    }
  };

  /**
   * Handle Unlink User (Optional, but good UX)
   */
  const handleUnlinkUser = async () => {
    if (!employee) return;
    Modal.confirm({
      title: t("hr.employees.unlinkUser"),
      content: t("hr.employees.unlinkUserConfirm"),
      onOk: async () => {
        try {
          await api.patch(`/employees/${id}`, { user_id: null });
          message.success(t("hr.employees.unlinkSuccess"));
          setLinkCandidates([]);
          setLinkSearch("");
          loadEmployee();
        } catch (err: any) {
          message.error(
            getDetailedHttpErrorMessage(t, err, "hr.employees.unlinkFailed"),
          );
        }
      },
    });
  };

  const handleRestore = async () => {
    if (!employee) return;
    setRestoreError(null);
    setRestoring(true);
    try {
      const response = await restoreEmployee(employee.id);
      if (isApiError(response)) {
        setRestoreError(
          response.message || t("employees.restore.errorGeneric"),
        );
        setRestoring(false);
        return;
      }
      message.success(t("employees.restore.success"));
      setRestoreOpen(false);
      setRestoring(false);
      loadEmployee();
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      if (httpStatus === 403 || isForbidden(err)) {
        setRestoreError(t("employees.restore.errorForbidden"));
      } else if (httpStatus === 422) {
        setRestoreError(t("employees.restore.errorNotArchived"));
      } else {
        setRestoreError(err?.message || t("employees.restore.errorGeneric"));
      }
      setRestoring(false);
    }
  };

  const handleBack = () => {
    navigate("/hr/employees");
  };

  const handleEdit = () => {
    navigate(`/hr/employees/${id}/edit`);
  };

  if (forbidden) {
    return <Unauthorized403Page />;
  }

  if (loading) {
    return <LoadingState title={t("common.loading")} />;
  }

  if (error) {
    return (
      <ErrorState
        title={t("hr.employees.loadFailed")}
        description={error}
        onRetry={loadEmployee}
      />
    );
  }

  if (notAvailableInSelectedCompany) {
    return (
      <EmptyState
        title={t("hr.employees.notFound", "Employee not found")}
        description={t(
          "hr.employees.notAvailableInSelectedCompany",
          "This employee is not available in the currently selected company.",
        )}
        actionText={t("hr.employees.backToList")}
        onAction={handleBack}
      />
    );
  }

  if (!employee) {
    return (
      <EmptyState
        title={t("hr.employees.noData")}
        description={t("hr.employees.notFound")}
        actionText={t("hr.employees.backToList")}
        onAction={handleBack}
      />
    );
  }

  const joinDate = (employee as any).join_date || employee.hire_date;
  const serviceLength = getServiceLength(joinDate);
  const contractInfo = getExpiryInfo((employee as any).contract_expiry);
  const documents = [
    {
      label: t("employees.form.passport"),
      tagLabel: t("employees.form.passport"),
      tagColor: "cyan",
      number: formatValue(employee.passport || (employee as any).passport_no),
      expiry: (employee as any).passport_expiry,
    },
    {
      label: t("employees.form.nationalId"),
      tagLabel: t("employees.view.idTag"),
      tagColor: "blue",
      number: formatValue((employee as any).national_id),
      expiry: (employee as any).id_expiry,
    },
    {
      label: t("employees.form.healthCard"),
      tagLabel: t("employees.view.healthTag"),
      tagColor: "green",
      number: formatDate((employee as any).health_card),
      expiry: (employee as any).health_card_expiry,
    },
    {
      label: t("employees.form.workLicense"),
      tagLabel: t("employees.form.workLicenseTag"),
      tagColor: "purple",
      expiry: employee.work_license_expiry,
      testId: "work-license-expiry-card",
    },
  ];
  const docsNeedingAttention = documents.filter((doc) => {
    const { status } = getExpiryInfo(doc.expiry);
    return status === "expired" || status === "warning";
  }).length;

  return (
    <div className="emp-profile">
      <PageHeader
        title={t("hr.employees.view")}
        breadcrumb={t("layout.hrManagement")}
        actions={
          <Space>
            {employee.user_id ? (
              <Tooltip
                title={t("employees.view.linkedTo", {
                  email: employee.email,
                })}
              >
                <Button
                  icon={<DisconnectOutlined />}
                  onClick={handleUnlinkUser}
                  danger
                >
                  {t("hr.employees.unlinkUser")}
                </Button>
              </Tooltip>
            ) : (
              <Button
                icon={<UserAddOutlined />}
                onClick={() => {
                  setSelectedUserId(null);
                  setLinkSearch("");
                  setIsLinkModalOpen(true);
                }}
              >
                {t("hr.employees.connectUser")}
              </Button>
            )}
            <Button type="primary" icon={<EditOutlined />} onClick={handleEdit}>
              {t("hr.employees.edit")}
            </Button>
            <BackButton onClick={handleBack}>
              {t("hr.employees.back")}
            </BackButton>
          </Space>
        }
      />

      {employee.is_archived && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16, borderRadius: 12 }}
          message={t("employees.archive.archivedBanner")}
          description={
            <Space direction="vertical" size={4}>
              <Text>{t("employees.archive.archivedBannerDescription")}</Text>
              {employee.archive_reason && (
                <Text type="secondary">
                  {t("employees.archive.colArchiveReason")}:{" "}
                  {t(
                    `employees.removal.archiveReason.${employee.archive_reason}`,
                  )}
                </Text>
              )}
              {employee.archived_at && (
                <Text type="secondary">
                  {t("employees.archive.archivedAt")}:{" "}
                  {formatDate(employee.archived_at)}
                </Text>
              )}
              {employee.archived_by_name?.trim() && (
                <Text type="secondary">
                  {t("employees.archive.archivedBy")}:{" "}
                  {employee.archived_by_name}
                </Text>
              )}
            </Space>
          }
          action={
            canRestoreEmployee ? (
              <Button
                size="small"
                onClick={() => {
                  setRestoreError(null);
                  setRestoreOpen(true);
                }}
              >
                {t("employees.restore.action")}
              </Button>
            ) : undefined
          }
        />
      )}

      <section className="emp-hero">
        <div className="emp-hero__cover" />
        <div className="emp-hero__body">
          <Avatar size={76} className="emp-hero__avatar">
            {employee.full_name?.charAt(0).toUpperCase()}
          </Avatar>
          <div className="emp-hero__identity">
            <Title level={3} className="emp-hero__name">
              {employee.full_name}
            </Title>
            <Text className="emp-hero__position">
              {employee.position || "—"}
            </Text>
            <div className="emp-hero__chips">
              {employee.department && (
                <Tag color="orange">{employee.department}</Tag>
              )}
              {employee.is_archived && (
                <Tag color="default">{t("employees.archive.archivedTag")}</Tag>
              )}
              <Tag
                color={
                  employee.employment_status === "ACTIVE"
                    ? "success"
                    : "default"
                }
              >
                {t(
                  `employees.status.${(employee.employment_status || "ACTIVE").toLowerCase()}`,
                  employee.employment_status || "ACTIVE",
                )}
              </Tag>
              <Tag className="emp-hero__id-tag" dir="ltr">
                #{employee.employee_id}
              </Tag>
              {!employee.user_id && (
                <Tag color="warning">{t("hr.employees.notLinked")}</Tag>
              )}
            </div>
          </div>
          <div className="emp-hero__contact">
            {employee.mobile && (
              <a
                className="emp-contact-pill"
                href={`tel:${employee.mobile}`}
                dir="ltr"
              >
                <PhoneOutlined />
                <span>{employee.mobile}</span>
              </a>
            )}
            {employee.user_id && employee.email && (
              <a className="emp-contact-pill" href={`mailto:${employee.email}`}>
                <MailOutlined />
                <span>{employee.email}</span>
              </a>
            )}
          </div>
        </div>
        <div className="emp-hero__stats">
          <StatItem
            icon={<CalendarOutlined />}
            label={t("employees.form.joiningDate")}
            value={formatDate(joinDate)}
            hint={
              serviceLength &&
              (serviceLength.years > 0
                ? t("employees.view.serviceYearsMonths", serviceLength)
                : t("employees.view.serviceMonths", serviceLength))
            }
          />
          <StatItem
            icon={<FileDoneOutlined />}
            label={t("employees.form.contractExpiry")}
            value={formatDate((employee as any).contract_expiry)}
            hint={expiryHint(contractInfo.days)}
            tone={contractInfo.status}
          />
          <StatItem
            icon={<ApartmentOutlined />}
            label={t("employees.view.directManager")}
            value={formatValue(
              employee.manager_profile_name || employee.manager_name,
            )}
          />
          <StatItem
            icon={<SafetyCertificateOutlined />}
            label={t("employees.view.documentsStatus")}
            value={
              docsNeedingAttention > 0
                ? t("employees.view.docsNeedAttention", {
                    count: docsNeedingAttention,
                  })
                : t("employees.view.docsAllValid")
            }
            tone={docsNeedingAttention > 0 ? "warning" : "ok"}
          />
        </div>
      </section>

      <Row gutter={[20, 20]}>
        {/* Main Tabs */}
        <Col xs={24} lg={16} xxl={17}>
          <Card className="emp-panel">
            <Tabs
              defaultActiveKey="1"
              items={[
                {
                  key: "1",
                  label: (
                    <span>
                      <UserOutlined />
                      {t("hr.employees.personalInfo")}
                    </span>
                  ),
                  children: (
                    <div className="emp-fields">
                      <InfoField
                        icon={<UserOutlined />}
                        label={t("hr.employees.fullName")}
                      >
                        {formatValue(employee.full_name)}
                      </InfoField>
                      <InfoField
                        icon={<CalendarOutlined />}
                        label={t("employees.form.dateOfBirth")}
                      >
                        {formatDate((employee as any).date_of_birth)}
                      </InfoField>
                      <InfoField
                        icon={<GlobalOutlined />}
                        label={t("employees.form.nationality")}
                      >
                        <Space size={6}>
                          <span>
                            {getCountryFlag((employee as any).nationality)}
                          </span>
                          {formatValue((employee as any).nationality)}
                        </Space>
                      </InfoField>
                      <InfoField
                        icon={<IdcardOutlined />}
                        label={t("employees.form.empNumber")}
                      >
                        {formatValue((employee as any).employee_number)}
                      </InfoField>
                      <InfoField
                        icon={<PhoneOutlined />}
                        label={t("employees.form.mobile")}
                      >
                        <span dir="ltr">{formatValue(employee.mobile)}</span>
                      </InfoField>
                      <InfoField
                        icon={<MailOutlined />}
                        label={t("hr.employees.linkedAccount")}
                      >
                        {employee.user_id ? (
                          <a href={`mailto:${employee.email}`}>
                            {employee.email}
                          </a>
                        ) : (
                          <Tag color="warning">
                            {t("hr.employees.notLinked")}
                          </Tag>
                        )}
                      </InfoField>
                    </div>
                  ),
                },
                {
                  key: "2",
                  label: (
                    <span>
                      <ContainerOutlined />
                      {t("hr.employees.employmentInfo")}
                    </span>
                  ),
                  children: (
                    <div className="emp-fields">
                      <InfoField
                        icon={<ApartmentOutlined />}
                        label={t("employees.form.department")}
                      >
                        {formatValue(employee.department)}
                      </InfoField>
                      <InfoField
                        icon={<SolutionOutlined />}
                        label={t("employees.form.position")}
                      >
                        {formatValue(employee.position)}
                      </InfoField>
                      <InfoField
                        icon={<TeamOutlined />}
                        label={t("employees.form.taskGroup")}
                      >
                        {formatValue(employee.task_group)}
                      </InfoField>
                      <InfoField
                        icon={<BankOutlined />}
                        label={t("employees.form.sponsor")}
                      >
                        {formatValue(employee.sponsor)}
                      </InfoField>
                      <InfoField
                        icon={<FileTextOutlined />}
                        label={t("employees.form.jobOffer")}
                      >
                        {formatValue((employee as any).job_offer)}
                      </InfoField>
                      <InfoField
                        icon={<CalendarOutlined />}
                        label={t("employees.form.joiningDate")}
                      >
                        {formatDate(joinDate)}
                      </InfoField>
                      <InfoField
                        icon={<CalendarOutlined />}
                        label={t("employees.form.contractDate")}
                      >
                        {formatDate((employee as any).contract_date)}
                      </InfoField>
                      <InfoField
                        icon={<FileDoneOutlined />}
                        label={t("employees.form.contractExpiry")}
                      >
                        {formatDate((employee as any).contract_expiry)}
                      </InfoField>
                      <InfoField
                        icon={<ClockCircleOutlined />}
                        label={t("employees.form.allowedOvertime")}
                      >
                        {formatValue((employee as any).allowed_overtime)}{" "}
                        {t("hr.employees.hours")}
                      </InfoField>
                    </div>
                  ),
                },
                {
                  key: "3",
                  label: (
                    <span>
                      <DollarOutlined />
                      {t("hr.employees.salaryDetails")}
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="emp-fields">
                        <InfoField
                          icon={<WalletOutlined />}
                          label={t("employees.form.basicSalary")}
                        >
                          {formatCurrency((employee as any).basic_salary)}
                        </InfoField>
                        <InfoField
                          icon={<DollarOutlined />}
                          label={t("employees.form.totalSalary")}
                          className="emp-salary-total"
                        >
                          <AmountWithSAR
                            amount={(employee as any).total_salary}
                            size={16}
                            color="#16a34a"
                            fontWeight="bold"
                            style={{ fontSize: 16 }}
                          />
                        </InfoField>
                      </div>

                      <div className="emp-section-title">
                        {t("employees.form.allowances")}
                      </div>

                      <div className="emp-fields">
                        {ALLOWANCE_FIELDS.map(([labelKey, field]) => (
                          <InfoField
                            key={field}
                            icon={<PlusCircleOutlined />}
                            label={t(labelKey)}
                          >
                            {formatCurrency((employee as any)[field])}
                          </InfoField>
                        ))}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "4",
                  label: (
                    <span>
                      <ContainerOutlined />
                      {t("hr.employees.leaveBalances")}
                    </span>
                  ),
                  children: <EmployeeLeaveBalances employeeId={Number(id)} />,
                },
                {
                  key: "5",
                  label: (
                    <span>
                      <InboxOutlined />
                      {t("archive.tabLabel", "Document Archive")}
                    </span>
                  ),
                  children: (
                    <EmployeeDocumentArchive
                      employeeId={Number(id)}
                      canManageDocuments={canManageDocuments}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        {/* Documents */}
        <Col xs={24} lg={8} xxl={7}>
          <Card
            className="emp-panel emp-docs"
            title={
              <div className="emp-docs__title">
                <FolderOpenOutlined />
                <span>{t("hr.employees.documents")}</span>
              </div>
            }
            extra={
              docsNeedingAttention > 0 ? (
                <Tag color="warning" style={{ margin: 0, borderRadius: 999 }}>
                  {t("employees.view.docsNeedAttention", {
                    count: docsNeedingAttention,
                  })}
                </Tag>
              ) : undefined
            }
          >
            <div className="emp-docs__list">
              {documents.map((doc) => (
                <DocCard key={doc.tagLabel} {...doc} />
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <Modal
        title={t("hr.employees.connectUserTitle")}
        open={isLinkModalOpen}
        onOk={handleLinkUser}
        onCancel={() => {
          setIsLinkModalOpen(false);
          setSelectedUserId(null);
          setLinkSearch("");
        }}
        confirmLoading={linking}
        okText={t("hr.employees.connectUser")}
        okButtonProps={{ disabled: !selectedUserId }}
      >
        <p>{t("hr.employees.connectUserDesc")}</p>
        <Select
          showSearch
          style={{ width: "100%" }}
          placeholder={t("hr.employees.searchUserPlaceholder")}
          onChange={(value) => setSelectedUserId(value)}
          onSearch={setLinkSearch}
          loading={usersLoading}
          filterOption={false}
          options={linkCandidates.map((user) => ({
            value: user.id,
            label: `${user.full_name || user.email} (${user.email})`,
          }))}
        />
      </Modal>

      <Modal
        open={restoreOpen}
        title={t("employees.restore.modalTitle")}
        okText={t("employees.restore.confirmButton")}
        okButtonProps={{ loading: restoring }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: restoring }}
        onOk={handleRestore}
        onCancel={() => {
          if (!restoring) {
            setRestoreOpen(false);
            setRestoreError(null);
          }
        }}
        closable={!restoring}
        maskClosable={!restoring}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {t("employees.restore.modalIntro", {
              name: employee.full_name || employee.email,
            })}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("employees.restore.modalNote")}
          </Text>
          {restoreError && (
            <Alert type="error" showIcon message={restoreError} />
          )}
        </Space>
      </Modal>
    </div>
  );
}
