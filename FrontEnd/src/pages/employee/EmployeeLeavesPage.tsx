import React, { useEffect, useState, useCallback } from "react";
import { Card, DatePicker, Row, Col, Typography, message, Button, Modal, Form, Select, Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import leavesApi from "../../services/api/leavesApi";
import type { LeaveBalance } from "../../services/api/apiTypes";
import LeaveBalanceTable from "../../components/leaves/LeaveBalanceTable";

const { Title } = Typography;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

const EmployeeLeavesPage: React.FC = () => {
    const [year, setYear] = useState<dayjs.Dayjs>(dayjs());
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form] = Form.useForm();

    const fetchBalances = useCallback(async () => {
        setLoading(true);
        try {
            const selectedYear = year.year();
            const response = await leavesApi.getMyBalances(selectedYear);

            if (response && response.status === "success" && Array.isArray(response.data)) {
                setBalances(response.data);
            } else {
                setBalances([]);
            }
        } catch (error) {
            console.error("Failed to fetch leave balances:", error);
            message.error("Failed to load leave balances.");
        } finally {
            setLoading(false);
        }
    }, [year]);

    useEffect(() => {
        fetchBalances();
    }, [fetchBalances]);

    const handleRequestLeave = () => {
        setIsModalOpen(true);
    };

    const handleCancel = () => {
        setIsModalOpen(false);
        form.resetFields();
    };

    const handleSubmit = async (values: any) => {
        setSubmitting(true);
        try {
            const payload = {
                leave_type: values.leave_type,
                start_date: values.dates[0].format("YYYY-MM-DD"),
                end_date: values.dates[1].format("YYYY-MM-DD"),
                reason: values.reason || "",
            };

            const response = await leavesApi.createLeaveRequest(payload);

            if (response && response.status === "success") {
                message.success("Leave request submitted successfully!");
                setIsModalOpen(false);
                form.resetFields();
                fetchBalances(); // Refresh balances
            } else {
                message.error(response.message || "Failed to submit leave request.");
            }
        } catch (error: any) {
            console.error("Failed to submit leave request:", error);
            message.error(error?.response?.data?.message || "Failed to submit leave request.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                <Col>
                    <Title level={2}>My Leave Balances</Title>
                </Col>
                <Col>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleRequestLeave}
                        style={{ marginRight: 16 }}
                    >
                        Request Leave
                    </Button>
                    <span style={{ marginRight: 8, fontWeight: 500 }}>Select Year:</span>
                    <DatePicker
                        picker="year"
                        value={year}
                        onChange={(val) => val && setYear(val)}
                        allowClear={false}
                    />
                </Col>
            </Row>

            <Card>
                <LeaveBalanceTable balances={balances} loading={loading} />
            </Card>

            <div style={{ marginTop: 24, padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
                <Title level={4}>How it works</Title>
                <ul>
                    <li><strong>Opening Balance:</strong> Quota + Carry-over from previous year.</li>
                    <li><strong>Used:</strong> Approved leave requests in this year.</li>
                    <li><strong>Remaining:</strong> Look at this number to know what you can request!</li>
                </ul>
            </div>

            <Modal
                title="Request Leave"
                open={isModalOpen}
                onCancel={handleCancel}
                onOk={() => form.submit()}
                confirmLoading={submitting}
                okText="Submit Request"
                width={600}
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                >
                    <Form.Item
                        name="leave_type"
                        label="Leave Type"
                        rules={[{ required: true, message: "Please select a leave type" }]}
                    >
                        <Select placeholder="Select leave type">
                            {balances.map((balance) => (
                                <Select.Option key={balance.leave_type_id} value={balance.leave_type_id}>
                                    {balance.leave_type_name} (Remaining: {balance.remaining} days)
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="dates"
                        label="Leave Period"
                        rules={[{ required: true, message: "Please select leave dates" }]}
                    >
                        <RangePicker
                            style={{ width: "100%" }}
                            disabledDate={(current) => current && current < dayjs().startOf('day')}
                        />
                    </Form.Item>

                    <Form.Item
                        name="reason"
                        label="Reason (Optional)"
                    >
                        <TextArea
                            rows={4}
                            placeholder="Enter reason for leave request"
                            maxLength={500}
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default EmployeeLeavesPage;
