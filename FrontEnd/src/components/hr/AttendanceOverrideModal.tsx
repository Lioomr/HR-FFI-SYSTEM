import React, { useEffect } from "react";
import { Modal, Form, Select, DatePicker, Input, Alert } from "antd";
import dayjs from "dayjs";
import type { AttendanceRecord } from "../../types/attendance";
import { useI18n } from "../../i18n/useI18n";

interface AttendanceOverrideModalProps {
    visible: boolean;
    record: AttendanceRecord | null;
    loading: boolean;
    onCancel: () => void;
    onSubmit: (id: string | number, values: any) => void;
}

const { Option } = Select;
const { TextArea } = Input;

const AttendanceOverrideModal: React.FC<AttendanceOverrideModalProps> = ({
    visible,
    record,
    loading,
    onCancel,
    onSubmit,
}) => {
    const { t } = useI18n();
    const [form] = Form.useForm();
    const [requireReason, setRequireReason] = React.useState(false);

    useEffect(() => {
        if (visible && record) {
            form.setFieldsValue({
                status: record.status,
                check_in_at: record.check_in_at ? dayjs(record.check_in_at) : null,
                check_out_at: record.check_out_at ? dayjs(record.check_out_at) : null,
                notes: record.notes,
                override_reason: "",
            });
            setRequireReason(false);
        } else {
            form.resetFields();
        }
    }, [visible, record, form]);

    const handleValuesChange = (_changedValues: any, allValues: any) => {
        if (!record) return;

        // Check if core fields changed
        const statusChanged = allValues.status !== undefined && allValues.status !== record.status;

        // Date comparison logic
        const origCheckIn = record.check_in_at ? dayjs(record.check_in_at) : null;
        const newCheckIn = allValues.check_in_at;
        const checkInChanged = (origCheckIn && !newCheckIn) || (!origCheckIn && newCheckIn) || (origCheckIn && newCheckIn && !origCheckIn.isSame(newCheckIn));

        const origCheckOut = record.check_out_at ? dayjs(record.check_out_at) : null;
        const newCheckOut = allValues.check_out_at;
        const checkOutChanged = (origCheckOut && !newCheckOut) || (!origCheckOut && newCheckOut) || (origCheckOut && newCheckOut && !origCheckOut.isSame(newCheckOut));

        if (statusChanged || checkInChanged || checkOutChanged) {
            setRequireReason(true);
        } else {
            setRequireReason(false);
        }
    };

    const handleOk = () => {
        form.validateFields().then((values) => {
            const payload = {
                ...values,
                check_in_at: values.check_in_at ? values.check_in_at.toISOString() : null,
                check_out_at: values.check_out_at ? values.check_out_at.toISOString() : null,
            };
            if (record) {
                onSubmit(record.id, payload);
            }
        });
    };

    return (
        <Modal
            title={t("hr.attendance.overrideTitle")}
            open={visible}
            onOk={handleOk}
            onCancel={onCancel}
            confirmLoading={loading}
            destroyOnClose
            style={{ borderRadius: 16 }}
        >
            <Alert
                message={t("hr.attendance.auditedAction")}
                description={t("hr.attendance.auditedDesc")}
                type="info"
                showIcon
                style={{ marginBottom: 24, borderRadius: 12 }}
            />

            <Form
                form={form}
                layout="vertical"
                onValuesChange={handleValuesChange}
            >
                <Form.Item name="status" label={t("common.status")} rules={[{ required: true }]}>
                    <Select size="large">
                        <Option value="PRESENT">{t("status.active")}</Option>
                        <Option value="ABSENT">{t("status.absent")}</Option>
                        <Option value="LATE">{t("hr.attendance.late")}</Option>
                    </Select>
                </Form.Item>

                <Form.Item name="check_in_at" label={t("hr.attendance.checkInTime")}>
                    <DatePicker showTime style={{ width: '100%' }} size="large" />
                </Form.Item>

                <Form.Item name="check_out_at" label={t("hr.attendance.checkOutTime")}>
                    <DatePicker showTime style={{ width: '100%' }} size="large" />
                </Form.Item>

                <Form.Item name="notes" label={t("common.notes")}>
                    <TextArea rows={2} placeholder={t("common.notes")} />
                </Form.Item>

                <Form.Item
                    name="override_reason"
                    label={t("hr.attendance.overrideReasonLabel")}
                    rules={[{ required: requireReason, message: t("hr.attendance.reasonRequired") }]}
                >
                    <TextArea rows={3} placeholder={t("hr.attendance.reasonPlaceholder")} />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export default AttendanceOverrideModal;
