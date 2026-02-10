import { DatePicker, Divider, Form, Input, InputNumber, Select, Row, Col, Tabs, Card, Typography, Alert } from "antd";
import { UserOutlined, ContainerOutlined, DollarOutlined, FolderOpenOutlined, FileTextOutlined, IdcardOutlined, MedicineBoxOutlined } from "@ant-design/icons";
import { COUNTRIES } from "../../../utils/countries";
import type { FormInstance } from "antd";
import type { Department } from "../../../services/api/departmentsApi";
import type { Position } from "../../../services/api/positionsApi";
import type { TaskGroup } from "../../../services/api/taskGroupsApi";
import type { Sponsor } from "../../../services/api/sponsorsApi";

interface EmployeeFormProps {
    form: FormInstance;
    loadingRefs?: boolean;
    refOptions: {
        departments: Department[];
        positions: Position[];
        taskGroups: TaskGroup[];
        sponsors: Sponsor[];
    };
}

/**
 * Shared employee form component used by both Create and Edit pages
 * Contains all 27 fields with exact labels from HR Manager specs
 */
export default function EmployeeForm({ form, loadingRefs, refOptions }: EmployeeFormProps) {
    const { departments, positions, taskGroups, sponsors } = refOptions;

    // Watch relevant fields for the sidebar preview (optional, nice to have)
    // const fullName = Form.useWatch("full_name", form);

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
                                            Personal Info
                                        </span>
                                    ),
                                    children: (
                                        <div style={{ paddingTop: 16 }}>
                                            <Row gutter={16}>
                                                <Col span={24}>
                                                    <Form.Item
                                                        label="Full Name"
                                                        name="full_name"
                                                        rules={[{ required: true, message: "Please enter employee full name" }]}
                                                    >
                                                        <Input size="large" placeholder="John Doe" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Date Of Birth" name="date_of_birth">
                                                        <DatePicker style={{ width: "100%" }} size="large" format="YYYY-MM-DD" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Nationality" name="nationality">
                                                        <Select
                                                            placeholder="Select nationality"
                                                            showSearch
                                                            optionFilterProp="children"
                                                            allowClear
                                                            size="large"
                                                            filterOption={(input, option) =>
                                                                (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())
                                                            }
                                                        >
                                                            {COUNTRIES.map((c) => (
                                                                <Select.Option key={c.code} value={c.name}>
                                                                    <span style={{ marginRight: 8 }}>{c.flag}</span>
                                                                    {c.name}
                                                                </Select.Option>
                                                            ))}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Mobile Number" name="mobile">
                                                        <Input size="large" placeholder="+966 5X XXX XXXX" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Employee number" name="employee_number">
                                                        <Input size="large" placeholder="Phone/Emp No" />
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
                                            Employment Info
                                        </span>
                                    ),
                                    children: (
                                        <div style={{ paddingTop: 16 }}>
                                            <Row gutter={16}>
                                                <Col span={12}>
                                                    <Form.Item
                                                        label="Department"
                                                        name="department_id"
                                                        rules={[{ required: true, message: "Please select department" }]}
                                                    >
                                                        <Select size="large" placeholder="Select department" loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {departments.map((dept) => <Select.Option key={dept.id} value={dept.id}>{dept.name}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item
                                                        label="Position"
                                                        name="position_id"
                                                        rules={[{ required: true, message: "Please select position" }]}
                                                    >
                                                        <Select size="large" placeholder="Select position" loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {positions.map((pos) => <Select.Option key={pos.id} value={pos.id}>{pos.name}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Task Group" name="task_group_id">
                                                        <Select size="large" placeholder="Select task group" loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {taskGroups.map((tg) => <Select.Option key={tg.id} value={tg.id}>{tg.name}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Sponsor" name="sponsor_id">
                                                        <Select size="large" placeholder="Select sponsor" loading={loadingRefs} showSearch optionFilterProp="children">
                                                            {sponsors.map((sp) => <Select.Option key={sp.id} value={sp.id}>{sp.code} {sp.name ? `- ${sp.name}` : ""}</Select.Option>)}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>

                                                <Col span={24}>
                                                    <Divider style={{ margin: '12px 0' }} />
                                                </Col>

                                                <Col span={12}>
                                                    <Form.Item label="Joining Date" name="join_date" rules={[{ required: true, message: "Please select joining date" }]}>
                                                        <DatePicker style={{ width: "100%" }} size="large" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Job Offer" name="job_offer">
                                                        <Input size="large" placeholder="Job offer details" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Contract Date" name="contract_date">
                                                        <DatePicker style={{ width: "100%" }} size="large" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Contract Expiry" name="contract_expiry">
                                                        <DatePicker style={{ width: "100%" }} size="large" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Allowed Overtime" name="allowed_overtime">
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
                                            Salary Details
                                        </span>
                                    ),
                                    children: (
                                        <div style={{ paddingTop: 16 }}>
                                            <Row gutter={16}>
                                                <Col span={12}>
                                                    <Form.Item label="Basic Salary" name="basic_salary">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} prefix="$" />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                    <Form.Item label="Total Salary" name="total_salary">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} prefix="$" />
                                                    </Form.Item>
                                                </Col>

                                                <Col span={24}>
                                                    <Typography.Title level={5} style={{ marginTop: 0 }}>Allowances</Typography.Title>
                                                </Col>

                                                <Col span={8}>
                                                    <Form.Item label="Transportation" name="transportation_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="Accommodation" name="accommodation_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="Telephone" name="telephone_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="Petrol" name="petrol_allowance">
                                                        <InputNumber style={{ width: "100%" }} size="large" min={0} precision={2} />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    <Form.Item label="Other" name="other_allowance">
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
                                <span>Documents</span>
                            </div>
                        }
                        style={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
                        headStyle={{ borderBottom: '1px solid #f0f0f0' }}
                    >
                        <Alert message="Edit document details below" type="info" showIcon style={{ marginBottom: 16, borderRadius: 8 }} />

                        {/* Passport */}
                        <div style={{ marginBottom: 16, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>Passport</div>
                            <Form.Item name="passport_no" style={{ marginBottom: 8 }}>
                                <Input placeholder="Passport Number" prefix={<FileTextOutlined style={{ color: '#bfbfbf' }} />} />
                            </Form.Item>
                            <Form.Item name="passport_expiry" style={{ marginBottom: 0 }}>
                                <DatePicker placeholder="Expiry Date" style={{ width: '100%' }} />
                            </Form.Item>
                        </div>

                        {/* National ID */}
                        <div style={{ marginBottom: 16, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>National ID</div>
                            <Form.Item name="national_id" style={{ marginBottom: 8 }}>
                                <Input placeholder="National ID" prefix={<IdcardOutlined style={{ color: '#bfbfbf' }} />} />
                            </Form.Item>
                            <Form.Item name="id_expiry" style={{ marginBottom: 0 }}>
                                <DatePicker placeholder="Expiry Date" style={{ width: '100%' }} />
                            </Form.Item>
                        </div>

                        {/* Health Card */}
                        <div style={{ marginBottom: 0, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>Health Card</div>
                            <Form.Item name="health_card" style={{ marginBottom: 8 }}>
                                <Input placeholder="Health Card No" prefix={<MedicineBoxOutlined style={{ color: '#bfbfbf' }} />} />
                            </Form.Item>
                            <Form.Item name="health_card_expiry" style={{ marginBottom: 0 }}>
                                <DatePicker placeholder="Expiry Date" style={{ width: '100%' }} />
                            </Form.Item>
                        </div>
                    </Card>
                </Col>
            </Row>
        </Form>
    );
}
