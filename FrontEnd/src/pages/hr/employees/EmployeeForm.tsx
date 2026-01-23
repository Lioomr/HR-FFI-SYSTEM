import { DatePicker, Divider, Form, Input, InputNumber, Select } from "antd";
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

    return (
        <Form form={form} layout="vertical">
            {/* Personal Info Section */}
            <Divider>Personal Info</Divider>

            <Form.Item
                label="Emp Full Name"
                name="full_name"
                rules={[{ required: true, message: "Please enter employee full name" }]}
            >
                <Input placeholder="Enter full name" />
            </Form.Item>

            <Form.Item label="Employee number" name="employee_number">
                <Input placeholder="Phone number" />
            </Form.Item>

            <Form.Item label="Nationality" name="nationality">
                <Input placeholder="Enter nationality" />
            </Form.Item>

            <Form.Item label="Passport Number" name="passport_no">
                <Input placeholder="Enter passport number" />
            </Form.Item>

            <Form.Item label="Passport Expiry" name="passport_expiry">
                <DatePicker style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="ID" name="national_id">
                <Input placeholder="Enter national ID" />
            </Form.Item>

            <Form.Item label="ID Expiry" name="id_expiry">
                <DatePicker style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Date Of Birth" name="date_of_birth">
                <DatePicker style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Mobile Number" name="mobile">
                <Input placeholder="Enter mobile number" />
            </Form.Item>

            {/* Employment Info Section */}
            <Divider>Employment Info</Divider>

            <Form.Item
                label="department"
                name="department_id"
                rules={[{ required: true, message: "Please select department" }]}
            >
                <Select
                    placeholder="Select department"
                    showSearch
                    optionFilterProp="children"
                    allowClear
                    loading={loadingRefs}
                >
                    {departments.map((dept) => (
                        <Select.Option key={dept.id} value={dept.id}>
                            {dept.name}
                        </Select.Option>
                    ))}
                </Select>
            </Form.Item>

            <Form.Item
                label="Position Name"
                name="position_id"
                rules={[{ required: true, message: "Please select position" }]}
            >
                <Select
                    placeholder="Select position"
                    showSearch
                    optionFilterProp="children"
                    allowClear
                    loading={loadingRefs}
                >
                    {positions.map((pos) => (
                        <Select.Option key={pos.id} value={pos.id}>
                            {pos.name}
                        </Select.Option>
                    ))}
                </Select>
            </Form.Item>

            <Form.Item label="Task Group Name" name="task_group_id">
                <Select
                    placeholder="Select task group"
                    showSearch
                    optionFilterProp="children"
                    allowClear
                    loading={loadingRefs}
                >
                    {taskGroups.map((tg) => (
                        <Select.Option key={tg.id} value={tg.id}>
                            {tg.name}
                        </Select.Option>
                    ))}
                </Select>
            </Form.Item>

            <Form.Item label="Sponsor Code" name="sponsor_id">
                <Select
                    placeholder="Select sponsor"
                    showSearch
                    optionFilterProp="children"
                    allowClear
                    loading={loadingRefs}
                >
                    {sponsors.map((sponsor) => (
                        <Select.Option key={sponsor.id} value={sponsor.id}>
                            {sponsor.code} {sponsor.name ? `- ${sponsor.name}` : ""}
                        </Select.Option>
                    ))}
                </Select>
            </Form.Item>

            <Form.Item label="JOB OFFER" name="job_offer">
                <Input placeholder="Enter job offer details" />
            </Form.Item>

            <Form.Item
                label="Joining Date"
                name="join_date"
                rules={[{ required: true, message: "Please select joining date" }]}
            >
                <DatePicker style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Contract date" name="contract_date">
                <DatePicker style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Contract Expiry Date" name="contract_expiry">
                <DatePicker style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="Allowed Overtime" name="allowed_overtime">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter allowed overtime hours"
                    min={0}
                />
            </Form.Item>

            {/* Documents Section */}
            <Divider>Documents</Divider>

            <Form.Item label="Health Card" name="health_card">
                <Input placeholder="Enter health card number" />
            </Form.Item>

            <Form.Item label="Health Card Expiry" name="health_card_expiry">
                <DatePicker style={{ width: "100%" }} />
            </Form.Item>

            {/* Salary & Allowances Section */}
            <Divider>Salary & Allowances</Divider>

            <Form.Item label="Basic Salary" name="basic_salary">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter basic salary"
                    min={0}
                    precision={2}
                />
            </Form.Item>

            <Form.Item label="Transportation Allowance" name="transportation_allowance">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter transportation allowance"
                    min={0}
                    precision={2}
                />
            </Form.Item>

            <Form.Item label="Accommodation Allowance" name="accommodation_allowance">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter accommodation allowance"
                    min={0}
                    precision={2}
                />
            </Form.Item>

            <Form.Item label="Telephone Allowance" name="telephone_allowance">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter telephone allowance"
                    min={0}
                    precision={2}
                />
            </Form.Item>

            <Form.Item label="Petrol Allowance" name="petrol_allowance">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter petrol allowance"
                    min={0}
                    precision={2}
                />
            </Form.Item>

            <Form.Item label="Other Allowance" name="other_allowance">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter other allowance"
                    min={0}
                    precision={2}
                />
            </Form.Item>

            <Form.Item label="Total Salary" name="total_salary">
                <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enter total salary"
                    min={0}
                    precision={2}
                />
            </Form.Item>
        </Form>
    );
}
