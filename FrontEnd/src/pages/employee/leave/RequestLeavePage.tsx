import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Select, DatePicker, Input, Alert, notification, Upload } from "antd";
import { ArrowLeftOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { UploadFile } from "antd/es/upload/interface";

import PageHeader from "../../../components/ui/PageHeader";
import { useI18n } from "../../../i18n/useI18n";
import { getLeaveTypes, createLeaveRequest, getMyLeaveBalance, type LeaveType, type LeaveBalance } from "../../../services/api/leaveApi";
import { isApiError } from "../../../services/api/apiTypes";
import { getDetailedHttpErrorMessage } from "../../../services/api/userErrorMessages";

const { Option } = Select;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

export default function RequestLeavePage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [form] = Form.useForm();

    // Translate leave type names coming from the API
    const translateLeaveType = (name?: string): string => {
        if (!name) return '';
        const key = `leave.type.${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '')}`;
        const translated = t(key);
        return translated === key ? name : translated;
    };

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [balances, setBalances] = useState<Record<number, LeaveBalance>>({});

    const [daysCount, setDaysCount] = useState(0);
    const [balanceError, setBalanceError] = useState<string | null>(null);
    const [isOtherSelected, setIsOtherSelected] = useState(false);
    const [isSickSelected, setIsSickSelected] = useState(false);

    useEffect(() => {
        async function init() {
            setLoading(true);
            try {
                const typesRes = await getLeaveTypes();
                if (!isApiError(typesRes)) {
                    setLeaveTypes(typesRes.data || []);
                }

                const balanceRes = await getMyLeaveBalance();
                if (!isApiError(balanceRes)) {
                    const map: Record<number, LeaveBalance> = {};
                    (balanceRes.data || []).forEach(b => {
                        map[b.leave_type_id] = b;
                    });
                    setBalances(map);
                }
            } catch (e) {
                console.error(e);
                notification.error({ message: t("common.error"), description: t("common.tryAgain") });
            } finally {
                setLoading(false);
            }
        }
        init();
    }, []);

    const handleValuesChange = (changedValues: any, allValues: any) => {
        if (changedValues.leave_type) {
            const typeObj = leaveTypes.find(t => t.id === changedValues.leave_type);
            setIsOtherSelected(typeObj?.code === 'OTHER');
            setIsSickSelected(["SICK", "SICK_LEAVE"].includes((typeObj?.code || "").toUpperCase()));
        }

        if (changedValues.dates || changedValues.leave_type) {
            const { dates, leave_type } = allValues;

            if (dates && dates[0] && dates[1]) {
                const start = dates[0];
                const end = dates[1];
                const diff = end.diff(start, 'day') + 1;
                setDaysCount(diff > 0 ? diff : 0);

                if (leave_type) {
                    const typeObj = leaveTypes.find(t => t.id === leave_type);
                    if (typeObj) {
                        if (typeObj.code === 'OTHER') {
                            setBalanceError(null);
                        } else {
                            const bal = balances[typeObj.id];
                            if (bal) {
                                if (bal.remaining_days < diff) {
                                    setBalanceError(t("leave.insufficientBalance"));
                                } else {
                                    setBalanceError(null);
                                }
                            } else {
                                setBalanceError(null);
                            }
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
            notification.error({ message: t("common.error"), description: balanceError });
            return;
        }

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

            await createLeaveRequest(payload);

            notification.success({ message: t("common.submit"), description: t("leave.submitRequest") });
            navigate("/employee/leave/requests");

        } catch (err: any) {
            console.error("Submit Error:", err);

            const data = err.apiData || err.response?.data;
            let description = getDetailedHttpErrorMessage(t, err);
            if (data?.errors) {
                if (Array.isArray(data.errors)) {
                    description = data.errors
                        .map((entry: unknown) => {
                            if (typeof entry === "string") return entry;
                            if (entry && typeof entry === "object" && "message" in entry) {
                                const msg = (entry as { message?: unknown }).message;
                                return typeof msg === "string" ? msg : "";
                            }
                            return "";
                        })
                        .filter(Boolean)
                        .join(", ");
                } else {
                    description = Object.values(data.errors).flat().join(", ");
                }
            }

            notification.error({ message: t("common.error"), description });
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
                {t("leave.backToRequests")}
            </Button>

            <PageHeader
                title={t("leave.requestTitle")}
                subtitle={t("leave.requestSubtitle")}
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
                        label={t("leave.type")}
                        name="leave_type"
                        rules={[{ required: true, message: t("common.required") }]}
                    >
                        <Select placeholder={t("leave.selectType")}>
                            {leaveTypes.map(lt => (
                                <Option key={lt.id} value={lt.id}>{translateLeaveType(lt.name)}</Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label={t("common.date")}
                        name="dates"
                        rules={[{ required: true, message: t("common.required") }]}
                    >
                        <RangePicker
                            style={{ width: '100%' }}
                            format="YYYY-MM-DD"
                            disabledDate={(current) => current && current < dayjs().startOf('day')}
                        />
                    </Form.Item>

                    {daysCount > 0 && (
                        <div style={{ marginBottom: 24, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
                            <strong>{t("leave.totalDays")}:</strong> {daysCount}
                        </div>
                    )}

                    <Form.Item
                        label={isOtherSelected ? t("leave.reasonRequired") : t("leave.reasonOptional")}
                        name="reason"
                        rules={[{ required: isOtherSelected, message: t("common.required") }]}
                    >
                        <TextArea rows={4} placeholder={t("leave.reason")} />
                    </Form.Item>

                    <Form.Item
                        label={isSickSelected ? t("leave.docRequired") : t("leave.docOptional")}
                        name="document"
                        valuePropName="fileList"
                        getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList || [])}
                        rules={[
                            {
                                validator: (_, value: UploadFile[]) => {
                                    if (!isSickSelected) return Promise.resolve();
                                    return value && value.length > 0
                                        ? Promise.resolve()
                                        : Promise.reject(new Error(t("common.required")));
                                },
                            },
                        ]}
                    >
                        <Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx">
                            <Button>{t("leave.chooseFile")}</Button>
                        </Upload>
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
                        {t("leave.submitRequest")}
                    </Button>
                </Form>
            </Card>
        </div>
    );
}
