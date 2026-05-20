import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Space, Avatar, Row, Col, Tabs, Tag, Typography, Divider } from "antd";
import { ArrowLeftOutlined, UserOutlined, ContainerOutlined, DollarOutlined, FolderOpenOutlined, PhoneOutlined, MailOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { getCountryFlag } from "../../utils/countries";
import EmployeeLeaveBalances from "../hr/employees/components/EmployeeLeaveBalances";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import { getEmployee } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import AmountWithSAR from "../../components/ui/AmountWithSAR";
import { useI18n } from "../../i18n/useI18n";

const { Title, Text } = Typography;

const formatValue = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    return String(value);
};

const formatCurrency = (value: unknown): React.ReactNode => {
    if (value === null || value === undefined || value === "") return "—";
    return <AmountWithSAR amount={value as number} size={12} />;
};

const formatDate = (value: unknown): string => {
    if (!value) return "—";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.split("T")[0];
    }
    return formatValue(value);
};

function getExpiryStatus(dateStr: string | undefined): "expired" | "warning" | "ok" | "unknown" {
    if (!dateStr) return "unknown";
    const expiry = new Date(dateStr);
    const diffDays = Math.floor((expiry.getTime() - Date.now()) / 86400000);
    if (diffDays < 0) return "expired";
    if (diffDays <= 60) return "warning";
    return "ok";
}

function ExpiryTag({ status }: { status: ReturnType<typeof getExpiryStatus> }) {
    if (status === "expired") return <Tag color="error">Expired</Tag>;
    if (status === "warning") return <Tag color="warning">Expiring Soon</Tag>;
    if (status === "ok") return <Tag color="success">Valid</Tag>;
    return <Tag>Unknown</Tag>;
}

function DocCard({ label, tagLabel, tagColor, number, expiry }: {
    label: string; tagLabel: string; tagColor: string;
    number: string; expiry: string | undefined;
}) {
    const status = getExpiryStatus(expiry);
    const borderColor = status === "expired" ? "#ff4d4f" : status === "warning" ? "#faad14" : "#f0f0f0";
    return (
        <div style={{ padding: 12, background: "#fafafa", borderRadius: 8, border: `1px solid ${borderColor}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <Text strong><SafetyCertificateOutlined /> {label}</Text>
                <Space size={4}>
                    <ExpiryTag status={status} />
                    <Tag color={tagColor}>{tagLabel}</Tag>
                </Space>
            </div>
            <div style={{ fontSize: 13, color: "#595959", marginBottom: 4 }}>{number}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>Expires: {formatDate(expiry)}</div>
        </div>
    );
}

export default function ManagerEmployeeProfilePage() {
    const { t } = useI18n();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [notInTeam, setNotInTeam] = useState(false);

    const loadEmployee = async () => {
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
                if (msg.includes("not found") || msg.includes("403") || msg.includes("forbidden")) {
                    setNotInTeam(true);
                } else {
                    setError(response.message || t("manager.team.profile.loadFailed"));
                }
                setLoading(false);
                return;
            }
            setEmployee(response.data);
        } catch (err: unknown) {
            const anyErr = err as { response?: { status?: number }; message?: string };
            if (anyErr?.response?.status === 404 || anyErr?.response?.status === 403) {
                setNotInTeam(true);
            } else {
                setError(anyErr?.message || t("manager.team.profile.loadFailed"));
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadEmployee();
    }, [id]);

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

    return (
        <div>
            <PageHeader
                title={t("manager.team.profile.title")}
                breadcrumb={t("manager.team.title")}
                subtitle={employee.full_name}
                actions={
                    <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
                        {t("manager.team.profile.back")}
                    </Button>
                }
            />

            {/* Hero Banner */}
            <Card style={{ borderRadius: 16, border: "none", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", marginBottom: 24, background: "linear-gradient(135deg, #fff7f0 0%, #fff 100%)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                    <Avatar
                        size={88}
                        style={{ backgroundColor: "#f56a00", fontSize: 36, flexShrink: 0, boxShadow: "0 0 0 4px #fff2e8" }}
                    >
                        {employee.full_name?.charAt(0).toUpperCase()}
                    </Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Title level={3} style={{ margin: 0 }}>{employee.full_name}</Title>
                        <Text type="secondary" style={{ fontSize: 15 }}>{employee.position || "—"}</Text>
                        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            {employee.department && <Tag color="orange">{employee.department}</Tag>}
                            <Tag color={employee.employment_status === "ACTIVE" ? "success" : "default"}>
                                {employee.employment_status || "ACTIVE"}
                            </Tag>
                            <Tag style={{ fontFamily: "monospace", background: "#f5f5f5", border: "1px solid #d9d9d9", color: "#595959" }}>
                                #{employee.employee_id}
                            </Tag>
                        </div>
                        {employee.mobile && (
                            <div style={{ marginTop: 8 }}>
                                <Space>
                                    <PhoneOutlined style={{ color: "#bfbfbf" }} />
                                    <a href={`tel:${employee.mobile}`} style={{ fontSize: 13, color: "inherit" }}>{employee.mobile}</a>
                                </Space>
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            <div style={{ paddingBottom: 24 }}>
                <Row gutter={24}>
                    {/* Left Column: Tabs */}
                    <Col xs={24} lg={17}>
                        <Card style={{ borderRadius: 16, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
                            <Tabs
                                defaultActiveKey="1"
                                items={[
                                    {
                                        key: "1",
                                        label: <span><UserOutlined />{t("hr.employees.personalInfo")}</span>,
                                        children: (
                                            <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                <Descriptions.Item label={t("hr.employees.fullName")}>{formatValue(employee.full_name)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.dateOfBirth")}>{formatDate(emp.date_of_birth)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.nationality")}>
                                                    <Space>
                                                        <span>{getCountryFlag(emp.nationality as string)}</span>
                                                        {formatValue(emp.nationality)}
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.empNumber")}>{formatValue(emp.employee_number)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.mobile")}>
                                                    <Space>
                                                        <PhoneOutlined style={{ color: "#bfbfbf" }} />
                                                        {formatValue(employee.mobile)}
                                                    </Space>
                                                </Descriptions.Item>
                                                {employee.email && (
                                                    <Descriptions.Item label={t("common.email")}>
                                                        <Space>
                                                            <MailOutlined style={{ color: "#bfbfbf" }} />
                                                            <span>{employee.email}</span>
                                                        </Space>
                                                    </Descriptions.Item>
                                                )}
                                            </Descriptions>
                                        ),
                                    },
                                    {
                                        key: "2",
                                        label: <span><ContainerOutlined />{t("hr.employees.employmentInfo")}</span>,
                                        children: (
                                            <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                <Descriptions.Item label={t("employees.form.department")}>{formatValue(employee.department)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.position")}>{formatValue(employee.position)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.taskGroup")}>{formatValue(employee.task_group)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.sponsor")}>{formatValue(employee.sponsor)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.jobOffer")}>{formatValue(emp.job_offer)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.joiningDate")}>{formatDate(emp.join_date || employee.hire_date)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.contractDate")}>{formatDate(emp.contract_date)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.contractExpiry")}>{formatDate(emp.contract_expiry)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.allowedOvertime")}>{formatValue(emp.allowed_overtime)} {t("hr.employees.hours")}</Descriptions.Item>
                                            </Descriptions>
                                        ),
                                    },
                                    {
                                        key: "3",
                                        label: <span><DollarOutlined />{t("hr.employees.salaryDetails")}</span>,
                                        children: (
                                            <div>
                                                <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                    <Descriptions.Item label={t("employees.form.basicSalary")}>{formatCurrency(emp.basic_salary)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.totalSalary")}>
                                                        <AmountWithSAR
                                                            amount={emp.total_salary as number}
                                                            size={16}
                                                            color="#52c41a"
                                                            fontWeight="bold"
                                                            style={{ fontSize: 16 }}
                                                        />
                                                    </Descriptions.Item>
                                                </Descriptions>
                                                <Divider style={{ margin: "12px 0", fontSize: 13, color: "#8c8c8c" }}>{t("employees.form.allowances")}</Divider>
                                                <Descriptions column={{ xs: 1, sm: 2, md: 3 }} layout="vertical" size="small">
                                                    <Descriptions.Item label={t("employees.form.transportation")}>{formatCurrency(emp.transportation_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.accommodation")}>{formatCurrency(emp.accommodation_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.telephone")}>{formatCurrency(emp.telephone_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.petrol")}>{formatCurrency(emp.petrol_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.other")}>{formatCurrency(emp.other_allowance)}</Descriptions.Item>
                                                </Descriptions>
                                            </div>
                                        ),
                                    },
                                    {
                                        key: "4",
                                        label: <span><ContainerOutlined />{t("hr.employees.leaveBalances")}</span>,
                                        children: <EmployeeLeaveBalances employeeId={Number(id)} />,
                                    },
                                ]}
                            />
                        </Card>
                    </Col>

                    {/* Right Column: Document cards (data from employee object only) */}
                    <Col xs={24} lg={7}>
                        <Card
                            title={
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <FolderOpenOutlined style={{ color: "#fa8c16" }} />
                                    <span>{t("hr.employees.documents")}</span>
                                </div>
                            }
                            style={{ borderRadius: 16, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}
                        >
                            <Space direction="vertical" style={{ width: "100%" }} size={12}>
                                <DocCard
                                    label={t("employees.form.passport")}
                                    tagLabel="Passport"
                                    tagColor="cyan"
                                    number={formatValue(employee.passport || emp.passport_no)}
                                    expiry={emp.passport_expiry as string | undefined}
                                />
                                <DocCard
                                    label={t("employees.form.nationalId")}
                                    tagLabel="ID"
                                    tagColor="blue"
                                    number={formatValue(emp.national_id)}
                                    expiry={emp.id_expiry as string | undefined}
                                />
                                <DocCard
                                    label={t("employees.form.healthCard")}
                                    tagLabel="Health"
                                    tagColor="green"
                                    number={formatValue(emp.health_card)}
                                    expiry={emp.health_card_expiry as string | undefined}
                                />
                            </Space>
                        </Card>
                    </Col>
                </Row>
            </div>
        </div>
    );
}
