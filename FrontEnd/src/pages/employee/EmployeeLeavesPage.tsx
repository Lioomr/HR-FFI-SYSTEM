import React, { useEffect, useState, useCallback } from "react";
import { Card, DatePicker, Row, Col, Typography, message, Button, Modal, Form, Select, Input, Upload } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import leavesApi from "../../services/api/leavesApi";
import type { LeaveBalance } from "../../services/api/apiTypes";
import LeaveBalanceTable from "../../components/leaves/LeaveBalanceTable";
import type { UploadFile } from "antd/es/upload/interface";
import { useI18n } from "../../i18n/useI18n";

const { Title } = Typography;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

const EmployeeLeavesPage: React.FC = () => {
    const { t } = useI18n();
    const [year, setYear] = useState<dayjs.Dayjs>(dayjs());
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [isSickSelected, setIsSickSelected] = useState(false);
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
            message.error(t("leaves.failedToLoadBalances"));
        } finally {
            setLoading(false);
        }
    }, [year, t]);

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
            const payload = new FormData();
            payload.append("leave_type", String(values.leave_type));
            payload.append("start_date", values.dates[0].format("YYYY-MM-DD"));
            payload.append("end_date", values.dates[1].format("YYYY-MM-DD"));
            payload.append("reason", values.reason || "");
            const fileList = (values.document || []) as UploadFile[];
            const file = fileList[0]?.originFileObj;
            if (file) {
                payload.append("document", file);
            }

            const response = await leavesApi.createLeaveRequest(payload);

            if (response && response.status === "success") {
                message.success(t("leaves.submitSuccess"));
                setIsModalOpen(false);
                form.resetFields();
                fetchBalances(); // Refresh balances
            } else {
                message.error(response.message || t("leaves.submitFailed"));
            }
        } catch (error: any) {
            console.error("Failed to submit leave request:", error);
            message.error(error?.response?.data?.message || t("leaves.submitFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                <Col>
                    <Title level={2}>{t("leaves.myBalances")}</Title>
                </Col>
                <Col>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleRequestLeave}
                        style={{ marginInlineEnd: 16 }}
                    >
                        {t("leaves.requestLeave")}
                    </Button>
                    <span style={{ marginInlineEnd: 8, fontWeight: 500 }}>{t("leaves.selectYear")}</span>
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
                <Title level={4}>{t("leaves.howItWorks")}</Title>
                <ul>
                    <li><strong>{t("leaves.openingBalance")}</strong> {t("leaves.openingBalanceDesc")}</li>
                    <li><strong>{t("leaves.used")}</strong> {t("leaves.usedDesc")}</li>
                    <li><strong>{t("leaves.remaining")}:</strong> {t("leaves.remainingDesc")}</li>
                </ul>
            </div>

            <Modal
                title={t("leaves.requestLeave")}
                open={isModalOpen}
                onCancel={handleCancel}
                onOk={() => form.submit()}
                confirmLoading={submitting}
                okText={t("common.submit")}
                width={600}
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                    onValuesChange={(changedValues) => {
                        if (changedValues.leave_type) {
                            const selected = balances.find((b) => b.leave_type_id === changedValues.leave_type);
                            const code = (selected as any)?.leave_code || selected?.leave_type || "";
                            setIsSickSelected(String(code).toUpperCase().includes("SICK"));
                        }
                    }}
                >
                    <Form.Item
                        name="leave_type"
                        label={t("leaves.leaveType")}
                        rules={[{ required: true, message: t("leaves.selectLeaveType") }]}
                    >
                        <Select placeholder={t("leaves.selectLeaveTypePlaceholder")}>
                            {balances.map((balance) => (
                                <Select.Option key={balance.leave_type_id} value={balance.leave_type_id}>
                                    {t(`leave.balance.${balance.leave_type.toLowerCase().replace(/\s+/g, '.')}`, balance.leave_type)} ({t("leaves.remaining")}: {balance.remaining_days} {t("leaves.days")})
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="dates"
                        label={t("leaves.leavePeriod")}
                        rules={[{ required: true, message: t("leaves.selectLeaveDates") }]}
                    >
                        <RangePicker
                            style={{ width: "100%" }}
                            disabledDate={(current) => current && current < dayjs().startOf('day')}
                        />
                    </Form.Item>

                    <Form.Item
                        name="reason"
                        label={t("leaves.reasonOptional")}
                    >
                        <TextArea
                            rows={4}
                            placeholder={t("leaves.enterReason")}
                            maxLength={500}
                        />
                    </Form.Item>

                    <Form.Item
                        name="document"
                        label={isSickSelected ? t("leaves.medicalReportReq") : t("leaves.documentOptional")}
                        valuePropName="fileList"
                        getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList || [])}
                        rules={[
                            {
                                validator: (_, value: UploadFile[]) => {
                                    if (!isSickSelected) return Promise.resolve();
                                    return value && value.length > 0
                                        ? Promise.resolve()
                                        : Promise.reject(new Error(t("leaves.uploadMedicalReport")));
                                },
                            },
                        ]}
                    >
                        <Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx">
                            <Button>{t("common.upload")}</Button>
                        </Upload>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default EmployeeLeavesPage;
