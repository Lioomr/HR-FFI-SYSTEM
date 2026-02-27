import { useEffect, useState } from "react";
import { Table, Button, Modal, Form, InputNumber, Input, Select, message, Space, Tag } from "antd";
import { CalculatorOutlined } from "@ant-design/icons";
import { getLeaveBalances, getLeaveTypes, createLeaveAdjustment } from "../../../../services/api/leaveApi";
import type { LeaveBalance, LeaveType } from "../../../../services/api/leaveApi";
import { useI18n } from "../../../../i18n/useI18n";

interface EmployeeLeaveBalancesProps {
    employeeId: number;
}

export default function EmployeeLeaveBalances({ employeeId }: EmployeeLeaveBalancesProps) {
    const { t } = useI18n();
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
            message.error(t("hr.employees.balances.loadFailed"));
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
            message.success(t("hr.employees.balances.adjustSuccess"));
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
            message.error(error.message || t("hr.employees.balances.adjustFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const columns = [
        {
            title: t("hr.employees.balances.leaveType"),
            dataIndex: "leave_type",
            key: "leave_type",
            render: (text: string) => {
                const translationKey = `leave.balance.${text.toLowerCase().replace(/\s+/g, '.')}`;
                const translated = t(translationKey, text);
                return <Tag color="blue">{translated}</Tag>;
            }
        },
        {
            title: t("hr.employees.balances.totalQuota"),
            dataIndex: "total_days",
            key: "total_days",
            render: (val: any) => Number(val || 0).toFixed(1)
        },
        {
            title: t("hr.employees.balances.used"),
            dataIndex: "used_days",
            key: "used_days",
            render: (val: any) => <span style={{ color: "orange" }}>{Number(val || 0).toFixed(1)}</span>
        },
        {
            title: t("hr.employees.balances.remaining"),
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
                <h3>{t("hr.employees.balances.title")}</h3>
                <Button
                    type="primary"
                    icon={<CalculatorOutlined />}
                    onClick={() => setIsModalOpen(true)}
                >
                    {t("hr.employees.balances.adjustBtn")}
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
                title={t("hr.employees.balances.adjustTitle")}
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                footer={null}
            >
                <Form layout="vertical" form={form} onFinish={handleAdjust}>
                    <Form.Item
                        label={t("hr.employees.balances.leaveType")}
                        name="leave_type"
                        rules={[{ required: true, message: t("hr.employees.balances.selectLeaveType") }]}
                    >
                        <Select placeholder={t("hr.employees.balances.selectLeaveType")}>
                            {leaveTypes.map(lt => {
                                const translationKey = `leave.balance.${lt.name.toLowerCase().replace(/\s+/g, '.')}`;
                                const translated = t(translationKey, lt.name);
                                return <Select.Option key={lt.id} value={lt.id}>{translated}</Select.Option>;
                            })}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label={t("hr.employees.balances.adjustmentDays")}
                        name="adjustment_days"
                        rules={[{ required: true, message: t("hr.employees.balances.enterDays") }]}
                        help={t("hr.employees.balances.adjustmentHelp")}
                    >
                        <InputNumber style={{ width: "100%" }} step={0.5} placeholder={t("hr.employees.balances.adjustmentPlaceholder")} />
                    </Form.Item>

                    <Form.Item
                        label={t("hr.employees.balances.reason")}
                        name="reason"
                        rules={[{ required: true, message: t("hr.employees.balances.reasonRequired") }]}
                    >
                        <Input.TextArea rows={3} placeholder={t("hr.employees.balances.reasonPlaceholder")} />
                    </Form.Item>

                    <div style={{ textAlign: "right" }}>
                        <Space>
                            <Button onClick={() => setIsModalOpen(false)}>{t("common.cancel")}</Button>
                            <Button type="primary" htmlType="submit" loading={submitting}>
                                {t("hr.employees.balances.submit")}
                            </Button>
                        </Space>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
