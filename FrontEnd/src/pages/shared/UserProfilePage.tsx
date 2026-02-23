import { useEffect, useState } from "react";
import {
    Card,
    Descriptions,
    Space,
    Button,
    Avatar,
    Row,
    Col,
    Tabs,
    Tag,
    Typography,
    Divider,
    Alert,
} from "antd";
import {
    UserOutlined,
    ContainerOutlined,
    DollarOutlined,
    FolderOpenOutlined,
    PhoneOutlined,
    SafetyCertificateOutlined,
    ReloadOutlined,
    MailOutlined,
    CalendarOutlined,
} from "@ant-design/icons";
import { getCountryFlag } from "../../utils/countries";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import { getEmployee } from "../../services/api/employeesApi";
import { getMe } from "../../services/api/usersApi";
import type { Employee } from "../../services/api/employeesApi";
import type { UserDto } from "../../services/api/apiTypes";
import { isApiError } from "../../services/api/apiTypes";
import { formatNumber } from "../../utils/currency";
import { useI18n } from "../../i18n/useI18n";

// Helper functions
const formatValue = (val: any) => {
    if (val === null || val === undefined || val === "") return "—";
    return String(val);
};

const formatDate = (val: any) => {
    if (!val) return "—";
    if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) {
        return val.split("T")[0];
    }
    return formatValue(val);
};

const formatCurrency = (val: any) => {
    if (val === null || val === undefined || val === "") return "—";
    return formatNumber(val);
};

const { Title, Text } = Typography;

export default function UserProfilePage() {
    const { t } = useI18n();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [user, setUser] = useState<UserDto | null>(null);

    const loadProfile = async () => {
        setLoading(true);
        setError(null);
        setEmployee(null);
        setUser(null);

        try {
            // 1. Try to get Employee Profile
            const empResponse = await getEmployee("me");

            if (!isApiError(empResponse)) {
                setEmployee(empResponse.data);
            } else if (empResponse.status === "error" && empResponse.message.includes("404")) {
                // 404 is expected for non-employee users, try generic User profile
                const userResponse = await getMe();
                if (isApiError(userResponse)) {
                    setError(userResponse.message || t("profile.loadError"));
                } else {
                    setUser(userResponse.data);
                }
            } else {
                // Real error from employee endpoint (e.g. 500)
                setError(empResponse.message || t("profile.loadError"));
            }
        } catch (err: any) {
            // Check if 404, if so try getMe
            // However, getEmployee uses api wrapper which captures errors usually. 
            // If wrapper throws, we handle here.
            if (err.response && err.response.status === 404) {
                const userResponse = await getMe();
                if (isApiError(userResponse)) {
                    setError(userResponse.message || t("profile.loadError"));
                } else {
                    setUser(userResponse.data);
                }
            } else {
                setError(err.message || t("profile.loadError"));
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProfile();
    }, []);

    if (loading) return <LoadingState title={t("profile.loadingProfile")} />;

    if (error) {
        return (
            <ErrorState
                title={t("profile.loadError")}
                description={error}
                onRetry={loadProfile}
            />
        );
    }

    // --- RENDERING ---

    // 1. FULL EMPLOYEE PROFILE
    if (employee) {
        const directManagerName = employee.manager_profile_name || employee.manager_name || "—";
        return (
            <div>
                {/* Header / Actions */}
                <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Title level={4} style={{ margin: 0 }}>{t("profile.myProfile")}</Title>
                    <Button icon={<ReloadOutlined />} onClick={loadProfile}>
                        {t("profile.refresh")}
                    </Button>
                </div>

                <Row gutter={24}>
                    <Col xs={24} lg={16}>
                        <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                            <Tabs
                                defaultActiveKey="1"
                                items={[
                                    {
                                        key: '1',
                                        label: <span><UserOutlined /> {t("profile.personalInfo")}</span>,
                                        children: (
                                            <Descriptions column={2} layout="vertical" style={{ marginTop: 16 }}>
                                                <Descriptions.Item label={t("profile.fullName")}>{formatValue(employee.full_name)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.dateOfBirth")}>{formatDate((employee as any).date_of_birth)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.nationality")}>
                                                    <Space>
                                                        <span>{getCountryFlag((employee as any).nationality)}</span>
                                                        {formatValue((employee as any).nationality)}
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("profile.employeeNumber")}>{formatValue((employee as any).employee_number)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.mobileNumber")}>
                                                    <Space>
                                                        <PhoneOutlined style={{ color: '#bfbfbf' }} />
                                                        {formatValue(employee.mobile)}
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("auth.email")}>
                                                    <span style={{ color: '#1890ff' }}>{employee.email}</span>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("profile.directManager")}>{formatValue(directManagerName)}</Descriptions.Item>
                                            </Descriptions>
                                        ),
                                    },
                                    {
                                        key: '2',
                                        label: <span><ContainerOutlined /> {t("profile.employmentInfo")}</span>,
                                        children: (
                                            <Descriptions column={2} layout="vertical" style={{ marginTop: 16 }}>
                                                <Descriptions.Item label={t("profile.department")}>{formatValue(employee.department)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.position")}>{formatValue(employee.position)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.taskGroup")}>{formatValue(employee.task_group)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.sponsor")}>{formatValue(employee.sponsor)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.jobOffer")}>{formatValue((employee as any).job_offer)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.joiningDate")}>{formatDate((employee as any).join_date || employee.hire_date)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.contractDate")}>{formatDate((employee as any).contract_date)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.contractExpiry")}>{formatDate((employee as any).contract_expiry)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.allowedOvertime")}>{formatValue((employee as any).allowed_overtime)} {t("profile.hours")}</Descriptions.Item>
                                            </Descriptions>
                                        ),
                                    },
                                    {
                                        key: '3',
                                        label: <span><DollarOutlined /> {t("profile.salaryDetails")}</span>,
                                        children: (
                                            <div>
                                                <Descriptions column={2} layout="vertical" style={{ marginTop: 16 }}>
                                                    <Descriptions.Item label={t("profile.basicSalary")}>{formatCurrency((employee as any).basic_salary)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("profile.totalSalary")}>
                                                        <Text strong style={{ fontSize: 16, color: '#52c41a' }}>
                                                            {formatCurrency((employee as any).total_salary)}
                                                        </Text>
                                                    </Descriptions.Item>
                                                </Descriptions>
                                                <Divider style={{ margin: '12px 0', fontSize: 13, color: '#8c8c8c' }}>{t("profile.allowances")}</Divider>
                                                <Descriptions column={3} layout="vertical" size="small">
                                                    <Descriptions.Item label={t("profile.transportation")}>{formatCurrency((employee as any).transportation_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("profile.accommodation")}>{formatCurrency((employee as any).accommodation_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("profile.telephone")}>{formatCurrency((employee as any).telephone_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("profile.petrol")}>{formatCurrency((employee as any).petrol_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("profile.other")}>{formatCurrency((employee as any).other_allowance)}</Descriptions.Item>
                                                </Descriptions>
                                            </div>
                                        ),
                                    },
                                ]}
                            />
                        </Card>
                    </Col>

                    <Col xs={24} lg={8}>
                        <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', marginBottom: 24, textAlign: 'center' }}>
                            <div style={{ marginBottom: 16 }}>
                                <Avatar size={100} style={{ backgroundColor: '#1890ff', fontSize: 36 }}>
                                    {employee.full_name?.charAt(0).toUpperCase()}
                                </Avatar>
                            </div>
                            <Title level={3} style={{ marginBottom: 4 }}>{employee.full_name}</Title>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{employee.position || t("profile.noPosition")}</Text>
                            <Tag color={employee.employment_status === 'ACTIVE' ? 'success' : 'default'} style={{ padding: '4px 12px', fontSize: 14 }}>
                                {employee.employment_status || t("profile.statusActive")}
                            </Tag>
                            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                                <div style={{ marginBottom: 10 }}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>{t("profile.directManager")}</Text>
                                    <div style={{ fontSize: 14, fontWeight: 500 }}>{formatValue(directManagerName)}</div>
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>{t("profile.employeeId")}</Text>
                                <div style={{ fontSize: 16, fontWeight: 500 }}>{employee.employee_id}</div>
                            </div>
                        </Card>

                        <Card
                            title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FolderOpenOutlined style={{ color: '#fa8c16' }} /><span>{t("profile.documents")}</span></div>}
                            style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
                        >
                            <Space direction="vertical" style={{ width: '100%' }} size={16}>
                                {/* Passport */}
                                <div style={{ padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                        <Text strong><SafetyCertificateOutlined /> {t("profile.passport")}</Text>
                                        <Tag color="cyan">{t("profile.doc")}</Tag>
                                    </div>
                                    <div style={{ fontSize: 13, color: '#595959', marginBottom: 4 }}>
                                        {formatValue(employee.passport || (employee as any).passport_no)}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                        {t("profile.expires")}: {formatDate((employee as any).passport_expiry)}
                                    </div>
                                </div>
                                {/* National ID */}
                                <div style={{ padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                        <Text strong>{t("profile.nationalId")}</Text>
                                        <Tag color="blue">{t("profile.id")}</Tag>
                                    </div>
                                    <div style={{ fontSize: 13, color: '#595959', marginBottom: 4 }}>
                                        {formatValue((employee as any).national_id)}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                        {t("profile.expires")}: {formatDate((employee as any).id_expiry)}
                                    </div>
                                </div>
                            </Space>
                        </Card>
                    </Col>
                </Row>
            </div>
        );
    }

    // 2. BASIC USER PROFILE (Admin/User without Employee record)
    if (user) {
        return (
            <div>
                <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Title level={4} style={{ margin: 0 }}>{t("profile.myProfile")}</Title>
                    <Button icon={<ReloadOutlined />} onClick={loadProfile}>
                        {t("profile.refresh")}
                    </Button>
                </div>

                <Row gutter={24}>
                    <Col xs={24} md={16} lg={12}>
                        <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                            <div style={{ textAlign: 'center', marginBottom: 24 }}>
                                <Avatar size={100} style={{ backgroundColor: '#722ed1', fontSize: 36 }}>
                                    {user.full_name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                                </Avatar>
                                <Title level={3} style={{ marginBottom: 4, marginTop: 16 }}>{user.full_name || t("profile.systemUser")}</Title>
                                <Tag color="geekblue" style={{ marginTop: 8 }}>{user.role}</Tag>
                            </div>

                            <Divider />

                            <Descriptions column={1} bordered size="small">
                                <Descriptions.Item label={<span style={{ color: '#8c8c8c' }}><MailOutlined /> {t("auth.email")}</span>}>
                                    {user.email}
                                </Descriptions.Item>
                                <Descriptions.Item label={<span style={{ color: '#8c8c8c' }}><CalendarOutlined /> {t("profile.joined")}</span>}>
                                    {formatDate((user as any).date_joined)}
                                </Descriptions.Item>
                                <Descriptions.Item label={<span style={{ color: '#8c8c8c' }}><SafetyCertificateOutlined /> {t("profile.status")}</span>}>
                                    <Tag color={user.is_active ? "success" : "error"}>{user.is_active ? t("profile.active") : t("profile.inactive")}</Tag>
                                </Descriptions.Item>
                            </Descriptions>

                            <div style={{ marginTop: 24 }}>
                                <Alert
                                    message={t("profile.limitedProfile")}
                                    description={t("profile.limitedProfileDesc")}
                                    type="info"
                                    showIcon
                                />
                            </div>
                        </Card>
                    </Col>
                </Row>
            </div>
        );
    }

    return <ErrorState title={t("profile.notFound")} onRetry={loadProfile} />;
}
