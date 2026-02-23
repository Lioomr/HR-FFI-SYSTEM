import { DatePicker, Divider, Form, Input, InputNumber, Select, Row, Col, Tabs, Card, Typography, Alert, Switch, Space } from "antd";
import { UserOutlined, ContainerOutlined, DollarOutlined, FolderOpenOutlined, FileTextOutlined, IdcardOutlined, MedicineBoxOutlined, TeamOutlined } from "@ant-design/icons";
import { COUNTRIES, getDialCodeByCountryCode, getDialCodeByNationality } from "../../../utils/countries";
import SARIcon from "../../../components/icons/SARIcon";
import type { FormInstance } from "antd";
import type { Department } from "../../../services/api/departmentsApi";
import type { Position } from "../../../services/api/positionsApi";
import type { TaskGroup } from "../../../services/api/taskGroupsApi";
import type { Sponsor } from "../../../services/api/sponsorsApi";
import type { Employee } from "../../../services/api/employeesApi";
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/useI18n";

interface EmployeeFormProps {
    form: FormInstance;
    loadingRefs?: boolean;
    refOptions: {
        departments: Department[];
        positions: Position[];
        taskGroups: TaskGroup[];
        sponsors: Sponsor[];
        employees?: Employee[]; // For manager selection
    };
}

/**
 * Shared employee form component used by both Create and Edit pages
 * Supports bilingual names, Saudi/Foreign distinction, and manager profile selection
 */
export default function EmployeeForm({ form, loadingRefs, refOptions }: EmployeeFormProps) {
    const { t } = useI18n();
    const { departments, positions, taskGroups, sponsors, employees = [] } = refOptions;
    const [isSaudi, setIsSaudi] = useState<boolean>(false);

    // Sync isSaudi with form value on initial render (for Edit page)
    useEffect(() => {
        const initialIsSaudi = form.getFieldValue("is_saudi");
        if (initialIsSaudi !== undefined) {
            setIsSaudi(!!initialIsSaudi);
        }
    }, [form]);

    const nationality = Form.useWatch("nationality", form);

    useEffect(() => {
        const currentCode = form.getFieldValue("mobile_country_code");
        const autoCode = isSaudi
            ? "+966"
            : getDialCodeByNationality(nationality) || "+966";
        if (!currentCode || currentCode !== autoCode) {
            form.setFieldValue("mobile_country_code", autoCode);
        }
    }, [form, nationality, isSaudi]);

    const countryCodeOptions = COUNTRIES
        .map((c) => {
            const dial = getDialCodeByCountryCode(c.code);
            if (!dial) return null;
            return {
                label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <img
                            src={`https://flagcdn.com/24x18/${c.code.toLowerCase()}.png`}
                            alt={`${c.code} flag`}
                            width={16}
                            height={12}
                            style={{ borderRadius: 2, border: "1px solid #f0f0f0" }}
                            loading="lazy"
                        />
                        <span>{dial} ({c.code})</span>
                    </span>
                ),
                search: `${c.code} ${c.name} ${dial}`,
                value: dial,
            };
        })
        .filter((x): x is { label: React.ReactNode; value: string; search: string } => Boolean(x))
        .filter((option, index, arr) => arr.findIndex((x) => x.value === option.value) === index);

    return (
        <Form form={form} layout="vertical">
            <Row gutter={24}>
                {/* Left Column: Main Tabs */}
                <Col xs={24} lg={16}>
                    <Card style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                        <Tabs
                            defaultActiveKey="1"
                            items={[
                                {
                                    key: '1',
                                    label: (
                                        <span>
                                            <UserOutlined />
                                            {t("employees.form.personalInfo")}
                                        </span>
                                    ),
                                    children: (
                                        <div style={{ paddingTop: 16 }}>
                                            <Row gutter={16}>
                                                {/* Saudi / Foreign Toggle */}
                                                <Col span={24}>
                                                    <Form.Item name="is_saudi" valuePropName="checked" label={t("employees.form.isSaudi")}>
                                                        <Switch
                                                            checkedChildren={t("employees.form.saudi")}
                                                            unCheckedChildren={t("employees.form.foreign")}
                                                            onChange={(val) => {
                                                                setIsSaudi(val);
                                                                if (val) {
                                                                    // Clear passport fields for Saudi employees
                                                                    form.setFieldsValue({ passport_no: undefined, passport_expiry: undefined });
                                                                }
                                                            }}
                                                        />
                                                    </Form.Item>
                                                </Col>

                                                {/* English Name */}
                                                <Col span={12}>
                                                    <Form.Item
                                                        label={t("employees.form.fullNameEn")}
                                                        name="full_name_en"
                                                        rules={[{ required: true, message: t("employees.form.requiredNameEn") }]}
                                                    >
                                                        <Input size="large" placeholder={t("employees.form.fullNameEnPlaceholder")} />
                                                    </Form.Item>
                                                </Col>

                                                {/* Arabic Name */}
                                                <Col span={12}>
                                                    <Form.Item
                                                        label={t("employees.form.fullNameAr")}
                                                        name="full_name_ar"
                                                    >
                                                        <Input size="large" placeholder={t("employees.form.fullNameArPlaceholder")} dir="rtl" style={{ textAlign: 'right' }} />
                                                    </Form.Item>
                                                </Col>

                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.dateOfBirth")} name="date_of_birth">
                                                        <DatePicker style={{ width: "100%" }} size="large" format="YYYY-MM-DD" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    {/* Nationality only shown for non-Saudi */}
                                                    {!isSaudi ? (
                                                        <Form.Item label={t("employees.form.nationality")} name="nationality">
                                                            <Select
                                                                placeholder={t("employees.form.selectNationality")}
                                                                showSearch
                                                                optionFilterProp="label"
                                                                allowClear
                                                                size="large"
                                                                filterOption={(input, option) => {
                                                                    const labelText = `${(option as any)?.value || ""} ${(option as any)?.label || ""}`.toLowerCase();
                                                                    return labelText.includes(input.toLowerCase());
                                                                }}
                                                            >
                                                                {COUNTRIES.map((c) => (
                                                                    <Select.Option key={c.code} value={c.name}>
                                                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                                                            <img
                                                                                src={`https://flagcdn.com/24x18/${c.code.toLowerCase()}.png`}
                                                                                alt={`${c.code} flag`}
                                                                                width={16}
                                                                                height={12}
                                                                                style={{ borderRadius: 2, border: "1px solid #f0f0f0" }}
                                                                                loading="lazy"
                                                                            />
                                                                            <span>{c.name}</span>
                                                                        </span>
                                                                    </Select.Option>
                                                                ))}
                                                            </Select>
                                                        </Form.Item>
                                                    ) : (
                                                        <Form.Item label={t("employees.form.nationality")}>
                                                            <Input size="large" value={t("employees.form.saudiArabia")} disabled />
                                                        </Form.Item>
                                                    )}
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.mobile")} required>
                                                        <Space.Compact style={{ width: "100%" }}>
                                                            <Form.Item name="mobile_country_code" noStyle initialValue="+966">
                                                                <Select
                                                                    style={{ width: 130 }}
                                                                    showSearch
                                                                    optionFilterProp="search"
                                                                    options={countryCodeOptions}
                                                                    defaultValue="+966"
                                                                />
                                                            </Form.Item>
                                                            <Form.Item
                                                                name="mobile_local"
                                                                noStyle
                                                                getValueFromEvent={(e) => (e?.target?.value || "").replace(/[^\d]/g, "")}
                                                            >
                                                                <Input
                                                                    size="large"
                                                                    placeholder={t("employees.form.mobilePlaceholder")}
                                                                />
                                                            </Form.Item>
                                                        </Space.Compact>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.empNumber")} name="employee_number">
                                                        <Input size="large" placeholder={t("employees.form.empNumberPlaceholder")} />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        </div>
                                    ),
                                },
                                {
                                    key: '2',
                                    label: (
                                        <span>
                                            <ContainerOutlined />
                                            {t("employees.form.employmentInfo")}
                                        </span>
                                    ),
                                    children: (
                                        <div style={{ paddingTop: 16 }}>
                                            <Row gutter={16}>
                                                <Col span={12}>
                                                    <Form.Item
                                                        label={t("employees.form.department")}
                                                        name="department_id"
                                                        rules={[{ required: true, message: t("employees.form.requiredDept") }]}
                                                    >
                                                        <Select size="large" placeholder={t("employees.form.departmentPlaceholder")} loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {departments.map((dept) => <Select.Option key={dept.id} value={dept.id}>{dept.name}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item
                                                        label={t("employees.form.position")}
                                                        name="position_id"
                                                        rules={[{ required: true, message: t("employees.form.requiredPos") }]}
                                                    >
                                                        <Select size="large" placeholder={t("employees.form.positionPlaceholder")} loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {positions.map((pos) => <Select.Option key={pos.id} value={pos.id}>{pos.name}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.taskGroup")} name="task_group_id">
                                                        <Select size="large" placeholder={t("employees.form.taskGroupPlaceholder")} loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {taskGroups.map((tg) => <Select.Option key={tg.id} value={tg.id}>{tg.name}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.sponsor")} name="sponsor_id">
                                                        <Select size="large" placeholder={t("employees.form.sponsorPlaceholder")} loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {sponsors.map((sp) => <Select.Option key={sp.id} value={sp.id}>{sp.code} {sp.name ? `- ${sp.name}` : ""}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>

                                                {/* Manager Selection */}
                                                <Col span={24}>
                                                    <Form.Item
                                                        label={
                                                            <Space>
                                                                <TeamOutlined />
                                                                {t("employees.form.directManager")}
                                                            </Space>
                                                        }
                                                        name="manager_profile_id"
                                                        tooltip={t("employees.form.managerTooltip")}
                                                    >
                                                        <Select
                                                            size="large"
                                                            placeholder={t("employees.form.managerPlaceholder")}
                                                            showSearch
                                                            allowClear
                                                            optionFilterProp="label"
                                                            loading={loadingRefs}
                                                            options={employees.map((emp) => ({
                                                                label: emp.full_name_en || emp.full_name || emp.employee_id,
                                                                value: emp.id,
                                                            }))}
                                                        />
                                                    </Form.Item>
                                                </Col>

                                                <Col span={24}>
                                                    <Divider style={{ margin: '12px 0' }} />
                                                </Col>

                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.joiningDate")} name="join_date" rules={[{ required: true, message: t("employees.form.requiredJoinDate") }]}>
                                                        <DatePicker style={{ width: "100%" }} size="large" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.jobOffer")} name="job_offer">
                                                        <Input size="large" placeholder={t("employees.form.jobOfferPlaceholder")} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.contractDate")} name="contract_date">
                                                        <DatePicker style={{ width: "100%" }} size="large" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.contractExpiry")} name="contract_expiry">
                                                        <DatePicker style={{ width: "100%" }} size="large" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.allowedOvertime")} name="allowed_overtime">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        </div>
                                    ),
                                },
                                {
                                    key: '3',
                                    label: (
                                        <span>
                                            <DollarOutlined />
                                            {t("employees.form.salaryDetails")}
                                        </span>
                                    ),
                                    children: (
                                        <div style={{ paddingTop: 16 }}>
                                            <Row gutter={16}>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.basicSalary")} name="basic_salary">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} prefix={<SARIcon size={14} />} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label={t("employees.form.totalSalary")} name="total_salary">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} prefix={<SARIcon size={14} />} />
                                                    </Form.Item>
                                                </Col>

                                                <Col span={24}>
                                                    <Typography.Title level={5} style={{ marginTop: 0 }}>{t("employees.form.allowances")}</Typography.Title>
                                                </Col>

                                                <Col span={8}>
                                                    <Form.Item label={t("employees.form.transportation")} name="transportation_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label={t("employees.form.accommodation")} name="accommodation_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label={t("employees.form.telephone")} name="telephone_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label={t("employees.form.petrol")} name="petrol_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label={t("employees.form.other")} name="other_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        </div>
                                    ),
                                },
                            ]}
                        />
                    </Card>
                </Col>

                {/* Right Column: Sidebar (Documents) */}
                <Col xs={24} lg={8}>

                    {/* Documents Edit Section */}
                    <Card
                        title={
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <FolderOpenOutlined style={{ color: '#fa8c16' }} />
                                <span>{t("employees.form.documents")}</span>
                            </div>
                        }
                        style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
                        headStyle={{ borderBottom: '1px solid #f0f0f0' }}
                    >
                        <Alert message={t("employees.form.editDocumentsDesc")} type="info" showIcon style={{ marginBottom: 16, borderRadius: 8 }} />

                        {/* Passport – hidden for Saudi employees */}
                        {!isSaudi && (
                            <div style={{ marginBottom: 16, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                                <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("employees.form.passport")}</div>
                                <Form.Item name="passport_no" style={{ marginBottom: 8 }}>
                                    <Input placeholder={t("employees.form.passportPlaceholder")} prefix={<FileTextOutlined style={{ color: '#bfbfbf' }} />} />
                                </Form.Item>
                                <Form.Item name="passport_expiry" style={{ marginBottom: 0 }}>
                                    <DatePicker placeholder={t("employees.form.expiryDate")} style={{ width: '100%' }} />
                                </Form.Item>
                            </div>
                        )}

                        {/* National ID */}
                        <div style={{ marginBottom: 16, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("employees.form.nationalId")}</div>
                            <Form.Item name="national_id" style={{ marginBottom: 8 }}>
                                <Input placeholder={t("employees.form.nationalIdPlaceholder")} prefix={<IdcardOutlined style={{ color: '#bfbfbf' }} />} />
                            </Form.Item>
                            <Form.Item name="id_expiry" style={{ marginBottom: 0 }}>
                                <DatePicker placeholder={t("employees.form.expiryDate")} style={{ width: '100%' }} />
                            </Form.Item>
                        </div>

                        {/* Health Card */}
                        <div style={{ marginBottom: 0, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("employees.form.healthCard")}</div>
                            <Form.Item name="health_card" style={{ marginBottom: 8 }}>
                                <Input placeholder={t("employees.form.healthCardPlaceholder")} prefix={<MedicineBoxOutlined style={{ color: '#bfbfbf' }} />} />
                            </Form.Item>
                            <Form.Item name="health_card_expiry" style={{ marginBottom: 0 }}>
                                <DatePicker placeholder={t("employees.form.expiryDate")} style={{ width: '100%' }} />
                            </Form.Item>
                        </div>
                    </Card>
                </Col>
            </Row>
        </Form>
    );
}
