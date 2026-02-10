import { useEffect, useState } from "react";
import { Table, Button, Modal, Form, InputNumber, Input, Select, message, Space, Tag } from "antd";
import { CalculatorOutlined } from "@ant-design/icons";
import { getLeaveBalances, getLeaveTypes, createLeaveAdjustment } from "../../../../services/api/leaveApi";
import type { LeaveBalance, LeaveType } from "../../../../services/api/leaveApi";

interface EmployeeLeaveBalancesProps {
    employeeId: number;
}

export default function EmployeeLeaveBalances({ employeeId }: EmployeeLeaveBalancesProps) {
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form] = Form.useForm();

    const loadData = async () => {
        setLoading(true);
        try {
            const [balRes, typeRes] = await Promise.all([
                getLeaveBalances(employeeId, new Date().getFullYear()),
                getLeaveTypes()
            ]);

            if (balRes.status === "success" && balRes.data) {
                setBalances(balRes.data);
            }
            if (typeRes.status === "success" && typeRes.data) {
                setLeaveTypes(typeRes.data);
            }
        } catch (error) {
            message.error("Failed to load leave data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (employeeId) {
            loadData();
        }
    }, [employeeId]);

    const handleAdjust = async (values: any) => {
        setSubmitting(true);
        try {
            await createLeaveAdjustment({
                employee_id: employeeId,
                leave_type: values.leave_type,
                adjustment_days: values.adjustment_days,
                reason: values.reason
            });
            message.success("Balance adjusted successfully");
            setIsModalOpen(false);
            form.resetFields();
            loadData(); // Refresh
        } catch (error: any) {
            // Check for structured validation errors
            if (error.status === "error" && error.errors) {
                // If it's a list of strings
                if (Array.isArray(error.errors)) {
                    message.error(error.errors.join(", "));
                    return;
                }
            }
            message.error(error.message || "Failed to adjust balance");
        } finally {
            setSubmitting(false);
        }
    };

    const columns = [
        {
            title: "Leave Type",
            dataIndex: "leave_type",
            key: "leave_type",
            render: (text: string) => <Tag color="blue">{text}</Tag>
        },
        {
            title: "Total Quota (incl. Adjustments)",
            dataIndex: "total_days",
            key: "total_days",
            render: (val: any) => Number(val || 0).toFixed(1)
        },
        {
            title: "Used",
            dataIndex: "used_days",
            key: "used_days",
            render: (val: any) => <span style={{ color: "orange" }}>{Number(val || 0).toFixed(1)}</span>
        },
        {
            title: "Remaining",
            dataIndex: "remaining_days",
            key: "remaining_days",
            render: (val: any) => {
                const num = Number(val || 0);
                return (
                    <span style={{ color: num < 0 ? "red" : "green", fontWeight: "bold" }}>
                        {num.toFixed(1)}
                    </span>
                );
            }
        },
    ];

    return (
        <div>
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3>Leave Balances</h3>
                <Button
                    type="primary"
                    icon={<CalculatorOutlined />}
                    onClick={() => setIsModalOpen(true)}
                >
                    Adjust Balance
                </Button>
            </div>

            <Table
                dataSource={balances}
                columns={columns}
                rowKey="leave_type_id"
                pagination={false}
                loading={loading}
                size="small"
                bordered
            />

            <Modal
                title="Adjust Leave Balance"
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                footer={null}
            >
                <Form layout="vertical" form={form} onFinish={handleAdjust}>
                    <Form.Item
                        label="Leave Type"
                        name="leave_type"
                        rules={[{ required: true, message: "Select leave type" }]}
                    >
                        <Select placeholder="Select leave type">
                            {leaveTypes.map(lt => (
                                <Select.Option key={lt.id} value={lt.id}>{lt.name}</Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label="Adjustment Days (+/-)"
                        name="adjustment_days"
                        rules={[{ required: true, message: "Enter days" }]}
                        help="Enter positive number to add days, negative to deduct."
                    >
                        <InputNumber style={{ width: "100%" }} step={0.5} placeholder="e.g. 5 or -2" />
                    </Form.Item>

                    <Form.Item
                        label="Reason"
                        name="reason"
                        rules={[{ required: true, message: "Reason is required" }]}
                    >
                        <Input.TextArea rows={3} placeholder="e.g. Compensation for weekend work" />
                    </Form.Item>

                    <div style={{ textAlign: "right" }}>
                        <Space>
                            <Button onClick={() => setIsModalOpen(false)}>Cancel</Button>
                            <Button type="primary" htmlType="submit" loading={submitting}>
                                Submit Adjustment
                            </Button>
                        </Space>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
