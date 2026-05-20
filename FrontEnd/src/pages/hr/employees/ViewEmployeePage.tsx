import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Space, Modal, Select, message, Tooltip, Avatar, Row, Col, Tabs, Tag, Typography, Divider } from "antd";
import { ArrowLeftOutlined, EditOutlined, UserAddOutlined, DisconnectOutlined, UserOutlined, ContainerOutlined, DollarOutlined, FolderOpenOutlined, MailOutlined, PhoneOutlined, SafetyCertificateOutlined, InboxOutlined } from "@ant-design/icons";
import { getCountryFlag } from "../../../utils/countries";
import EmployeeLeaveBalances from "./components/EmployeeLeaveBalances";
import EmployeeDocumentArchive from "../../../components/employees/EmployeeDocumentArchive";
import PageHeader from "../../../components/ui/PageHeader";
import LoadingState from "../../../components/ui/LoadingState";
import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";
import { getEmployee } from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";
import { listUsers } from "../../../services/api/usersApi";
import { api } from "../../../services/api/apiClient";
import type { UserDto } from "../../../services/api/apiTypes";
import { isApiError } from "../../../services/api/apiTypes";
import { isForbidden } from "../../../services/api/httpErrors";
import AmountWithSAR from "../../../components/ui/AmountWithSAR";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";

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
    // If already in YYYY-MM-DD format, return as is
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.split("T")[0]; // Remove time component if present
    }
    return formatValue(value);
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
                <Text strong><SafetyCertificateOutlined /> {label}</Text>
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

export default function ViewEmployeePage() {
    const { t } = useI18n();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const activeOrganizationId = useAuthStore((state) => state.user?.active_organization_id ?? state.user?.default_organization_id ?? null);


    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [notAvailableInSelectedCompany, setNotAvailableInSelectedCompany] = useState(false);

    // Linking User State
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [users, setUsers] = useState<UserDto[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [linking, setLinking] = useState(false);

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
                    "This employee belongs to another company. You have been returned to the employee list."
                )
            );
            navigate("/hr/employees", { replace: true });
        }
    }, [activeOrganizationId, employee, navigate, t]);

    /**
     * Load Users for Linking
     */
    useEffect(() => {
        if (isLinkModalOpen) {
            const fetchUsers = async () => {
                setUsersLoading(true);
                try {
                    const response = await listUsers({ page_size: 1000 });
                    // Response structure is { status: "success", data: { items: [...] } }
                    // listUsers returns the body.
                    // So response.data.items is the array.
                    // However, we need to be safe.
                    const userList = (response as any).data?.items || (response as any).data?.results || [];
                    setUsers(userList as any[]);
                } catch (error) {
                    message.error(t("hr.employees.loadUsersFailed"));
                } finally {
                    setUsersLoading(false);
                }
            };
            fetchUsers();
        }
    }, [isLinkModalOpen]);

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
            loadEmployee();
        } catch (err: any) {
            message.error(err.message || t("hr.employees.linkFailed"));
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
                    loadEmployee();
                } catch (err: any) {
                    message.error(err.message || t("hr.employees.unlinkFailed"));
                }
            }
        });
    }

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
                    "This employee is not available in the currently selected company."
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


    return (
        <div>
            <PageHeader
                title={t("hr.employees.view")}
                breadcrumb={t("layout.hrManagement")}
                subtitle={employee.full_name}
                secondarySubtitle={employee.mobile ? `Mobile: ${employee.mobile}` : undefined}
                actions={
                    <Space>
                        <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
                            {t("hr.employees.back")}
                        </Button>
                        {employee.user_id ? (
                            <Tooltip title={`Linked to: ${employee.email}`}>
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
                                onClick={() => setIsLinkModalOpen(true)}
                            >
                                {t("hr.employees.connectUser")}
                            </Button>
                        )}
                        <Button type="primary" icon={<EditOutlined />} onClick={handleEdit}>
                            {t("hr.employees.edit")}
                        </Button>
                    </Space>
                }
            />

            {/* Hero Banner */}
            <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', marginBottom: 24, background: 'linear-gradient(135deg, #fff7f0 0%, #fff 100%)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                    <Avatar
                        size={88}
                        style={{ backgroundColor: '#f56a00', fontSize: 36, flexShrink: 0, boxShadow: '0 0 0 4px #fff2e8' }}
                    >
                        {employee.full_name?.charAt(0).toUpperCase()}
                    </Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Title level={3} style={{ margin: 0 }}>{employee.full_name}</Title>
                        <Text type="secondary" style={{ fontSize: 15 }}>{employee.position || "—"}</Text>
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            {employee.department && <Tag color="orange">{employee.department}</Tag>}
                            <Tag color={employee.employment_status === 'ACTIVE' ? 'success' : 'default'}>
                                {employee.employment_status || 'ACTIVE'}
                            </Tag>
                            <Tag style={{ fontFamily: 'monospace', background: '#f5f5f5', border: '1px solid #d9d9d9', color: '#595959' }}>
                                #{employee.employee_id}
                            </Tag>
                            {!employee.user_id && (
                                <Tag color="warning">{t("hr.employees.notLinked")}</Tag>
                            )}
                        </div>
                        {employee.mobile && (
                            <div style={{ marginTop: 8 }}>
                                <Space>
                                    <PhoneOutlined style={{ color: '#bfbfbf' }} />
                                    <a href={`tel:${employee.mobile}`} style={{ fontSize: 13, color: 'inherit' }}>{employee.mobile}</a>
                                </Space>
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            <div style={{ paddingBottom: 24 }}>
                <Row gutter={24}>
                    {/* Left Column: Main Tabs */}
                    <Col xs={24} lg={17}>
                        <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                            <Tabs
                                defaultActiveKey="1"
                                items={[
                                    {
                                        key: '1',
                                        label: (
                                            <span>
                                                <UserOutlined />
                                                {t("hr.employees.personalInfo")}
                                            </span>
                                        ),
                                        children: (
                                            <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                <Descriptions.Item label={t("hr.employees.fullName")}>{formatValue(employee.full_name)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.dateOfBirth")}>{formatDate((employee as any).date_of_birth)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.nationality")}>
                                                    <Space>
                                                        <span>{getCountryFlag((employee as any).nationality)}</span>
                                                        {formatValue((employee as any).nationality)}
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.empNumber")}>{formatValue((employee as any).employee_number)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.mobile")}>
                                                    <Space>
                                                        <PhoneOutlined style={{ color: '#bfbfbf' }} />
                                                        {formatValue(employee.mobile)}
                                                    </Space>
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t("hr.employees.linkedAccount")}>
                                                    {employee.user_id ? (
                                                        <Space>
                                                            <MailOutlined style={{ color: '#bfbfbf' }} />
                                                            <span style={{ color: '#1890ff' }}>{employee.email}</span>
                                                        </Space>
                                                    ) : (
                                                        <Tag color="warning">{t("hr.employees.notLinked")}</Tag>
                                                    )}
                                                </Descriptions.Item>
                                            </Descriptions>
                                        ),
                                    },
                                    {
                                        key: '2',
                                        label: (
                                            <span>
                                                <ContainerOutlined />
                                                {t("hr.employees.employmentInfo")}
                                            </span>
                                        ),
                                        children: (
                                            <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                <Descriptions.Item label={t("employees.form.department")}>{formatValue(employee.department)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.position")}>{formatValue(employee.position)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.taskGroup")}>{formatValue(employee.task_group)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.sponsor")}>{formatValue(employee.sponsor)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.jobOffer")}>{formatValue((employee as any).job_offer)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.joiningDate")}>{formatDate((employee as any).join_date || employee.hire_date)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.contractDate")}>{formatDate((employee as any).contract_date)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.contractExpiry")}>{formatDate((employee as any).contract_expiry)}</Descriptions.Item>
                                                <Descriptions.Item label={t("employees.form.allowedOvertime")}>{formatValue((employee as any).allowed_overtime)} {t("hr.employees.hours")}</Descriptions.Item>
                                            </Descriptions>
                                        ),
                                    },
                                    {
                                        key: '3',
                                        label: (
                                            <span>
                                                <DollarOutlined />
                                                {t("hr.employees.salaryDetails")}
                                            </span>
                                        ),
                                        children: (
                                            <div>
                                                <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" style={{ marginTop: 16 }}>
                                                    <Descriptions.Item label={t("employees.form.basicSalary")}>{formatCurrency((employee as any).basic_salary)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.totalSalary")}>
                                                        <AmountWithSAR
                                                            amount={(employee as any).total_salary}
                                                            size={16}
                                                            color="#52c41a"
                                                            fontWeight="bold"
                                                            style={{ fontSize: 16 }}
                                                        />
                                                    </Descriptions.Item>
                                                </Descriptions>

                                                <Divider style={{ margin: '12px 0', fontSize: 13, color: '#8c8c8c' }}>{t("employees.form.allowances")}</Divider>

                                                <Descriptions column={{ xs: 1, sm: 2, md: 3 }} layout="vertical" size="small">
                                                    <Descriptions.Item label={t("employees.form.transportation")}>{formatCurrency((employee as any).transportation_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.accommodation")}>{formatCurrency((employee as any).accommodation_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.telephone")}>{formatCurrency((employee as any).telephone_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.petrol")}>{formatCurrency((employee as any).petrol_allowance)}</Descriptions.Item>
                                                    <Descriptions.Item label={t("employees.form.other")}>{formatCurrency((employee as any).other_allowance)}</Descriptions.Item>
                                                </Descriptions>
                                            </div>
                                        ),
                                    },
                                    {
                                        key: '4',
                                        label: (
                                            <span>
                                                <ContainerOutlined />
                                                {t("hr.employees.leaveBalances")}
                                            </span>
                                        ),
                                        children: <EmployeeLeaveBalances employeeId={Number(id)} />
                                    },
                                    {
                                        key: '5',
                                        label: (
                                            <span>
                                                <InboxOutlined />
                                                {t("archive.tabLabel", "Document Archive")}
                                            </span>
                                        ),
                                        children: <EmployeeDocumentArchive employeeId={Number(id)} />,
                                    },
                                ]}
                            />
                        </Card>
                    </Col>

                    {/* Right Column: Documents only */}
                    <Col xs={24} lg={7}>
                        <Card
                            title={
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FolderOpenOutlined style={{ color: '#fa8c16' }} />
                                    <span>{t("hr.employees.documents")}</span>
                                </div>
                            }
                            style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
                        >
                            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                                <DocCard
                                    label={t("employees.form.passport")}
                                    tagLabel="Passport"
                                    tagColor="cyan"
                                    number={formatValue(employee.passport || (employee as any).passport_no)}
                                    expiry={(employee as any).passport_expiry}
                                />
                                <DocCard
                                    label={t("employees.form.nationalId")}
                                    tagLabel="ID"
                                    tagColor="blue"
                                    number={formatValue((employee as any).national_id)}
                                    expiry={(employee as any).id_expiry}
                                />
                                <DocCard
                                    label={t("employees.form.healthCard")}
                                    tagLabel="Health"
                                    tagColor="green"
                                    number={formatValue((employee as any).health_card)}
                                    expiry={(employee as any).health_card_expiry}
                                />
                            </Space>
                        </Card>
                    </Col>
                </Row>
            </div>

            <Modal
                title={t("hr.employees.connectUserTitle")}
                open={isLinkModalOpen}
                onOk={handleLinkUser}
                onCancel={() => setIsLinkModalOpen(false)}
                confirmLoading={linking}
                okText={t("hr.employees.connectUser")}
                okButtonProps={{ disabled: !selectedUserId }}
            >
                <p>{t("hr.employees.connectUserDesc")}</p>
                <Select
                    showSearch
                    style={{ width: '100%' }}
                    placeholder={t("hr.employees.searchUserPlaceholder")}
                    optionFilterProp="children"
                    onChange={(value) => setSelectedUserId(value)}
                    loading={usersLoading}
                    filterOption={(input, option) => {
                        const label = (option?.label ?? '').toString().toLowerCase();
                        return label.includes(input.toLowerCase());
                    }}
                    options={users.map((u: any) => {
                        const isLinked = !!u.linked_employee_id;
                        return {
                            value: u.id,
                            label: `${u.full_name} (${u.email}) ${isLinked ? `[${t("hr.employees.linkedAccount")}: ${u.linked_employee_name}]` : ''}`,
                            disabled: isLinked
                        };
                    })}
                />
            </Modal>
        </div>
    );
}
