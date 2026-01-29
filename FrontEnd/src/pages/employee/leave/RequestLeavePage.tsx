import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Select, DatePicker, Input, Alert, notification } from "antd";
import { ArrowLeftOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import PageHeader from "../../../components/ui/PageHeader";
import { getLeaveTypes, createLeaveRequest, getMyLeaveBalance, type LeaveType, type LeaveBalance } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";

const { Option } = Select;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

export default function RequestLeavePage() {
    const navigate = useNavigate();
    const [form] = Form.useForm();

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [balances, setBalances] = useState<Record<string, LeaveBalance>>({}); // Map by type name or id

    // Calculated state
    const [daysCount, setDaysCount] = useState(0);
    const [balanceError, setBalanceError] = useState<string | null>(null);

    // Initial Load
    useEffect(() => {
        async function init() {
            setLoading(true);
            try {
                // Load Types
                const typesRes = await getLeaveTypes();
                if (!isApiError(typesRes)) {
                    setLeaveTypes(typesRes.data || []);
                }

                // Load Balance
                const balanceRes = await getMyLeaveBalance();
                if (!isApiError(balanceRes)) {
                    // Index by leave_type name for quick lookup if needed, 
                    // ideally backend gives ID but DTO says string "leave_type". 
                    // Let's rely on matching name for now or just display generic if mismatch
                    const map: Record<string, LeaveBalance> = {};
                    (balanceRes.data || []).forEach(b => {
                        map[b.leave_type] = b;
                    });
                    setBalances(map);
                }
            } catch (e) {
                console.error(e);
                notification.error({ message: "Init Error", description: "Failed to load leave types or balance" });
            } finally {
                setLoading(false);
            }
        }
        init();
    }, []);

    // Form Watcher for Days Calculation
    const handleValuesChange = (changedValues: any, allValues: any) => {
        if (changedValues.dates || changedValues.leave_type) {
            const { dates, leave_type } = allValues;

            if (dates && dates[0] && dates[1]) {
                const start = dates[0];
                const end = dates[1];
                const diff = end.diff(start, 'day') + 1; // Inclusive
                setDaysCount(diff > 0 ? diff : 0);

                // Check Balance Logic
                if (leave_type) {
                    const typeObj = leaveTypes.find(t => t.id === leave_type);
                    if (typeObj) {
                        const bal = balances[typeObj.name];
                        // Note: matching by name is risky if backend names differ. 
                        // Assuming consistency for F3.
                        if (bal) {
                            if (bal.remaining_days < diff) {
                                setBalanceError(`Insufficient balance. You have ${bal.remaining_days} days remaining, but requested ${diff}.`);
                            } else {
                                setBalanceError(null);
                            }
                        } else {
                            // No balance record found - usually implies 0 or unknown. 
                            // Warn if strict, otherwise clear
                            setBalanceError(null);
                        }
                    }
                }
            } else {
                setDaysCount(0);
                setBalanceError(null);
            }
        }
    };

    const handleFinish = async (values: any) => {
        if (balanceError) {
            notification.error({ message: "Validation Error", description: "Please resolve balance issues before submitting." });
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                leave_type_id: values.leave_type,
                start_date: values.dates[0].format("YYYY-MM-DD"),
                end_date: values.dates[1].format("YYYY-MM-DD"),
                reason: values.reason
            };

            const res = await createLeaveRequest(payload);

            if (isApiError(res)) {
                // If it's a 422 or business logic error, res.message should cover it
                notification.error({ message: "Submission Failed", description: res.message || "Invalid request." });
            } else {
                notification.success({ message: "Success", description: "Leave request submitted successfully." });
                navigate("/employee/leave/requests");
            }
        } catch (err: any) {
            notification.error({ message: "System Error", description: err.message || "Something went wrong." });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate("/employee/leave/requests")}
                style={{ paddingLeft: 0, marginBottom: 16 }}
            >
                Back to My Requests
            </Button>

            <PageHeader
                title="Request Leave"
                subtitle="Submit a new leave application"
            />

            <Card style={{ borderRadius: 16 }} loading={loading}>
                {balanceError && (
                    <Alert
                        type="error"
                        message={balanceError}
                        showIcon
                        style={{ marginBottom: 24 }}
                    />
                )}

                <Form
                    layout="vertical"
                    form={form}
                    onFinish={handleFinish}
                    onValuesChange={handleValuesChange}
                >
                    <Form.Item
                        label="Leave Type"
                        name="leave_type"
                        rules={[{ required: true, message: "Please select a leave type" }]}
                    >
                        <Select placeholder="Select leave type">
                            {leaveTypes.map(t => (
                                <Option key={t.id} value={t.id}>{t.name}</Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label="Dates"
                        name="dates"
                        rules={[{ required: true, message: "Please select start and end dates" }]}
                    >
                        <RangePicker
                            style={{ width: '100%' }}
                            format="YYYY-MM-DD"
                            disabledDate={(current) => current && current < dayjs().startOf('day')}
                        />
                    </Form.Item>

                    {daysCount > 0 && (
                        <div style={{ marginBottom: 24, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
                            <strong>Total Days:</strong> {daysCount}
                        </div>
                    )}

                    <Form.Item
                        label="Reason"
                        name="reason"
                        rules={[{ required: true, message: "Please provide a reason" }]}
                    >
                        <TextArea rows={4} placeholder="Reason for leave..." />
                    </Form.Item>

                    <Button
                        type="primary"
                        htmlType="submit"
                        icon={<SendOutlined />}
                        block
                        size="large"
                        loading={submitting}
                        disabled={!!balanceError}
                    >
                        Submit Request
                    </Button>
                </Form>
            </Card>
        </div>
    );
}
