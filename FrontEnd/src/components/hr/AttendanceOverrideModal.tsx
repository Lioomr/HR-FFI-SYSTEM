import React, { useEffect } from "react";
import { Modal, Form, Select, DatePicker, Input, Alert } from "antd";
import dayjs from "dayjs";
import type { AttendanceRecord } from "../../types/attendance";

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
            title="Override Attendance Record"
            open={visible}
            onOk={handleOk}
            onCancel={onCancel}
            confirmLoading={loading}
            destroyOnClose
        >
            <Alert
                message="Audited Action"
                description="All changes are logged. 'Override Reason' is required when changing Status or Times."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
            />

            <Form
                form={form}
                layout="vertical"
                onValuesChange={handleValuesChange}
            >
                <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                    <Select>
                        <Option value="PRESENT">PRESENT</Option>
                        <Option value="ABSENT">ABSENT</Option>
                        <Option value="LATE">LATE</Option>
                    </Select>
                </Form.Item>

                <Form.Item name="check_in_at" label="Check In Time">
                    <DatePicker showTime />
                </Form.Item>

                <Form.Item name="check_out_at" label="Check Out Time">
                    <DatePicker showTime />
                </Form.Item>

                <Form.Item name="notes" label="Notes">
                    <TextArea rows={2} />
                </Form.Item>

                <Form.Item
                    name="override_reason"
                    label="Override Reason"
                    rules={[{ required: requireReason, message: "Please provide a reason for this override" }]}
                >
                    <TextArea rows={2} placeholder="Why are you changing this record?" />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export default AttendanceOverrideModal;
