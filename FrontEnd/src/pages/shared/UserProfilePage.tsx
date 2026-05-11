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
    Tooltip,
    message,
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
    CopyOutlined,
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

function getExpiryStatus(dateStr: string | undefined): 'expired' | 'warning' | 'ok' | 'unknown' {
    if (!dateStr) return 'unknown';
    const expiry = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((expiry.getTime() - now.getTime()) / 86400000);
    if (diffDays < 0) return 'expired';
    if (diffDays <= 60) return 'warning';
    return 'ok';
}

function ExpiryTag({ status }: { status: ReturnType<typeof getExpiryStatus> }) {
    if (status === 'expired') return <Tag color="error">Expired</Tag>;
    if (status === 'warning') return <Tag color="warning">Expiring Soon</Tag>;
    if (status === 'ok') return <Tag color="success">Valid</Tag>;
    return <Tag>Unknown</Tag>;
}

function DocCard({ label, tagLabel, tagColor, number, expiry }: {
    label: string; tagLabel: string; tagColor: string;
    number: string; expiry: string | undefined;
}) {
    const status = getExpiryStatus(expiry);
    const borderColor = status === 'expired' ? '#ff4d4f' : status === 'warning' ? '#faad14' : '#f0f0f0';
    return (
        <div style={{ padding: 12, background: '#fafafa', borderRadius: 8, border: `1px solid ${borderColor}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Typography.Text strong><SafetyCertificateOutlined /> {label}</Typography.Text>
                <Space size={4}>
                    <ExpiryTag status={status} />
                    <Tag color={tagColor}>{tagLabel}</Tag>
                </Space>
            </div>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 4 }}>{number}</div>
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>Expires: {formatDate(expiry)}</div>
        </div>
    );
}

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
            const empResponse = await getEmployee("me");

            if (!isApiError(empResponse)) {
                setEmployee(empResponse.data);
            } else if (empResponse.status === "error" && empResponse.message.includes("404")) {
                const userResponse = await getMe();
                if (isApiError(userResponse)) {
                    setError(userResponse.message || t("profile.loadError"));
                } else {
                    setUser(userResponse.data);
                }
            } else {
                setError(empResponse.message || t("profile.loadError"));
            }
        } catch (err: any) {
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

    // 1. FULL EMPLOYEE PROFILE
    if (employee) {
        const directManagerName = employee.manager_profile_name || employee.manager_name || "—";
        return (
            <div>
                {/* Hero Banner */}
                <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', marginBottom: 24, background: 'linear-gradient(135deg, #f8faff 0%, #fff 100%)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                        <Avatar
                            size={88}
                            style={{ backgroundColor: '#1890ff', fontSize: 36, flexShrink: 0, boxShadow: '0 0 0 4px #e6f4ff' }}
                        >
                            {employee.full_name?.charAt(0).toUpperCase()}
                        </Avatar>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <Title level={3} style={{ margin: 0 }}>{employee.full_name}</Title>
                            <Text type="secondary" style={{ fontSize: 15 }}>{employee.position || "—"}</Text>
                            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                {employee.department && <Tag color="blue">{employee.department}</Tag>}
                                <Tag color={employee.employment_status === 'ACTIVE' ? 'success' : 'default'}>
                                    {employee.employment_status || 'ACTIVE'}
                                </Tag>
                                <Tag style={{ fontFamily: 'monospace', background: '#f5f5f5', border: '1px solid #d9d9d9', color: '#595959' }}>
                                    #{employee.employee_id}
                                </Tag>
                            </div>
                            <div style={{ marginTop: 8 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    Manager: <Text style={{ fontSize: 12 }}>{directManagerName}</Text>
                                </Text>
                            </div>
                        </div>
                        <Button icon={<ReloadOutlined />} onClick={loadProfile} style={{ alignSelf: 'flex-start' }}>
                            {t("profile.refresh")}
                        </Button>
                    </div>
                </Card>

                <Row gutter={24}>
                    <Col xs={24} lg={17}>
                        <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                            <Tabs
                                defaultActiveKey="1"
                                items={[
                                    {
                                        key: '1',
                                        label: <span><UserOutlined /> {t("profile.personalInfo")}</span>,
                                        children: (
                                            <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                <Descriptions.Item label={t("profile.fullName")}>{formatValue(employee.full_name)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.dateOfBirth")}>{formatDate((employee as any).date_of_birth)}</Descriptions.Item>
                                                <Descriptions.Item label={t("profile.nationality")}>
                                                    <Space>
                                                        <span>{getCountryFlag((employee as any).nationality)}</span>
                                                        {formatValue((employee as any).nationality)}
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("profile.employeeNumber")}>
                                                    <Space>
                                                        {formatValue((employee as any).employee_number)}
                                                        <Tooltip title="Copy">
                                                            <Button
                                                                type="text"
                                                                size="small"
                                                                icon={<CopyOutlined />}
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(String((employee as any).employee_number || ''));
                                                                    message.success('Copied!');
                                                                }}
                                                            />
                                                        </Tooltip>
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("profile.mobileNumber")}>
                                                    <Space>
                                                        <PhoneOutlined style={{ color: '#bfbfbf' }} />
                                                        <a href={`tel:${employee.mobile}`} style={{ color: 'inherit' }}>{formatValue(employee.mobile)}</a>
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("auth.email")}>
                                                    <Space>
                                                        <MailOutlined style={{ color: '#bfbfbf' }} />
                                                        <a href={`mailto:${employee.email}`}>{employee.email}</a>
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("profile.directManager")}>{formatValue(directManagerName)}</Descriptions.Item>
                                            </Descriptions>
                                        ),
                                    },
                                    {
                                        key: '2',
                                        label: <span><ContainerOutlined /> {t("profile.employmentInfo")}</span>,
                                        children: (
                                            <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
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
                                                <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                    <Descriptions.Item label={t("profile.basicSalary")}>{formatCurrency((employee as any).basic_salary)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("profile.totalSalary")}>
                                                        <Text strong style={{ fontSize: 16, color: '#52c41a' }}>
                                                            {formatCurrency((employee as any).total_salary)}
                                                        </Text>
                                                    </Descriptions.Item>
                                                </Descriptions>
                                                <Divider style={{ margin: '12px 0', fontSize: 13, color: '#8c8c8c' }}>{t("profile.allowances")}</Divider>
                                                <Descriptions column={{ xs: 1, sm: 2, md: 3 }} layout="vertical" size="small">
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

                    <Col xs={24} lg={7}>
                        <Card
                            title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FolderOpenOutlined style={{ color: '#fa8c16' }} /><span>{t("profile.documents")}</span></div>}
                            style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
                        >
                            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                                <DocCard
                                    label={t("profile.passport")}
                                    tagLabel="Passport"
                                    tagColor="cyan"
                                    number={formatValue(employee.passport || (employee as any).passport_no)}
                                    expiry={(employee as any).passport_expiry}
                                />
                                <DocCard
                                    label={t("profile.nationalId")}
                                    tagLabel="ID"
                                    tagColor="blue"
                                    number={formatValue((employee as any).national_id)}
                                    expiry={(employee as any).id_expiry}
                                />
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
                {/* Simple hero for non-employee users */}
                <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', marginBottom: 24, background: 'linear-gradient(135deg, #f9f0ff 0%, #fff 100%)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                        <Avatar size={88} style={{ backgroundColor: '#722ed1', fontSize: 36, flexShrink: 0, boxShadow: '0 0 0 4px #f9f0ff' }}>
                            {user.full_name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                        </Avatar>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <Title level={3} style={{ margin: 0 }}>{user.full_name || t("profile.systemUser")}</Title>
                            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <Tag color="geekblue">{user.role}</Tag>
                                <Tag color={user.is_active ? "success" : "error"}>{user.is_active ? t("profile.active") : t("profile.inactive")}</Tag>
                            </div>
                            <div style={{ marginTop: 8 }}>
                                <Space>
                                    <MailOutlined style={{ color: '#bfbfbf' }} />
                                    <a href={`mailto:${user.email}`} style={{ fontSize: 13 }}>{user.email}</a>
                                </Space>
                            </div>
                        </div>
                        <Button icon={<ReloadOutlined />} onClick={loadProfile} style={{ alignSelf: 'flex-start' }}>
                            {t("profile.refresh")}
                        </Button>
                    </div>
                </Card>

                <Row gutter={24}>
                    <Col xs={24} md={16} lg={12}>
                        <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                            <Descriptions column={1} bordered size="small">
                                <Descriptions.Item label={<span style={{ color: '#8c8c8c' }}><MailOutlined /> {t("auth.email")}</span>}>
                                    <a href={`mailto:${user.email}`}>{user.email}</a>
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
