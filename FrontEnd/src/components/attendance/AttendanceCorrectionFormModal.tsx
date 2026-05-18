import { useEffect, useState } from "react";
import { DatePicker, Form, Input, Modal, Select, TimePicker, notification } from "antd";
import dayjs from "dayjs";

import { useI18n } from "../../i18n/useI18n";
import {
  createAttendanceCorrectionRequest,
  submitAttendanceCorrectionRequest,
  type AttendanceCorrectionRequest,
  type AttendanceRecordStatus,
  type CreateAttendanceCorrectionPayload,
} from "../../services/api/attendanceCorrectionsApi";
import { isApiError } from "../../services/api/apiTypes";
import { getDetailedApiMessage, getDetailedHttpErrorMessage } from "../../services/api/userErrorMessages";

const { TextArea } = Input;

type FormValues = {
  date: dayjs.Dayjs;
  requested_check_in_at?: dayjs.Dayjs | null;
  requested_check_out_at?: dayjs.Dayjs | null;
  requested_status?: AttendanceRecordStatus | "";
  reason: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (request: AttendanceCorrectionRequest) => void;
  submitImmediately?: boolean;
};

export default function AttendanceCorrectionFormModal({
  open,
  onClose,
  onCreated,
  submitImmediately = true,
}: Props) {
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const datePart = values.date.format("YYYY-MM-DD");

      const checkIn = values.requested_check_in_at;
      const checkOut = values.requested_check_out_at;

      if (!checkIn && !checkOut && !values.requested_status) {
        notification.error({
          message: t(
            "attendanceCorrections.errors.atLeastOne",
            "Provide at least one of: check-in, check-out, or status."
          ),
        });
        return;
      }

      if (checkIn && checkOut && checkOut.isBefore(checkIn)) {
        notification.error({
          message: t(
            "attendanceCorrections.errors.checkOutBeforeCheckIn",
            "Requested check-out cannot be before requested check-in."
          ),
        });
        return;
      }

      const payload: CreateAttendanceCorrectionPayload = {
        date: datePart,
        reason: values.reason.trim(),
        requested_check_in_at: checkIn ? `${datePart}T${checkIn.format("HH:mm:00")}` : null,
        requested_check_out_at: checkOut ? `${datePart}T${checkOut.format("HH:mm:00")}` : null,
        requested_status: values.requested_status || "",
      };

      setSubmitting(true);
      const res = await createAttendanceCorrectionRequest(payload);
      if (isApiError(res)) {
        notification.error({
          message: t("attendanceCorrections.errors.createFailed", "Failed to create correction request"),
          description: getDetailedApiMessage(t, res.message),
        });
        return;
      }

      let finalRequest = res.data;

      if (submitImmediately) {
        try {
          const submitRes = await submitAttendanceCorrectionRequest(res.data.id);
          if (!isApiError(submitRes)) {
            finalRequest = submitRes.data;
          }
        } catch {
          notification.warning({
            message: t(
              "attendanceCorrections.notice.savedAsDraft",
              "Saved as draft. You can submit it later."
            ),
          });
        }
      }

      notification.success({
        message: submitImmediately
          ? t("attendanceCorrections.success.submitted", "Correction request submitted.")
          : t("attendanceCorrections.success.created", "Correction request created."),
      });
      onCreated?.(finalRequest);
      onClose();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) {
        return;
      }
      notification.error({
        message: t("attendanceCorrections.errors.createFailed", "Failed to create correction request"),
        description: getDetailedHttpErrorMessage(t, err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("attendanceCorrections.form.title", "New correction request")}
      onCancel={() => {
        if (!submitting) onClose();
      }}
      onOk={handleSubmit}
      okText={
        submitImmediately
          ? t("attendanceCorrections.form.submit", "Submit request")
          : t("common.save", "Save")
      }
      cancelText={t("common.cancel", "Cancel")}
      confirmLoading={submitting}
      destroyOnClose
      maskClosable={false}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{ date: dayjs(), requested_status: "" }}
        preserve={false}
      >
        <Form.Item
          name="date"
          label={t("attendanceCorrections.form.date", "Date")}
          rules={[
            {
              required: true,
              message: t("attendanceCorrections.form.dateRequired", "Date is required"),
            },
          ]}
        >
          <DatePicker
            style={{ width: "100%" }}
            format="YYYY-MM-DD"
            disabledDate={(d) => d && d.isAfter(dayjs().endOf("day"))}
          />
        </Form.Item>

        <Form.Item
          name="requested_check_in_at"
          label={t("attendanceCorrections.form.requestedCheckIn", "Requested check-in")}
        >
          <TimePicker style={{ width: "100%" }} format="HH:mm" minuteStep={5} />
        </Form.Item>

        <Form.Item
          name="requested_check_out_at"
          label={t("attendanceCorrections.form.requestedCheckOut", "Requested check-out")}
        >
          <TimePicker style={{ width: "100%" }} format="HH:mm" minuteStep={5} />
        </Form.Item>

        <Form.Item
          name="requested_status"
          label={t("attendanceCorrections.form.requestedStatus", "Requested status")}
        >
          <Select
            allowClear
            placeholder={t("attendanceCorrections.form.requestedStatusPlaceholder", "Optional")}
            options={[
              { value: "PRESENT", label: t("attendanceCorrections.statusValue.PRESENT", "Present") },
              { value: "ABSENT", label: t("attendanceCorrections.statusValue.ABSENT", "Absent") },
              { value: "LATE", label: t("attendanceCorrections.statusValue.LATE", "Late") },
              { value: "REJECTED", label: t("attendanceCorrections.statusValue.REJECTED", "Rejected") },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="reason"
          label={t("attendanceCorrections.form.reason", "Reason")}
          rules={[
            {
              required: true,
              message: t("attendanceCorrections.errors.reasonRequired", "Reason is required"),
            },
          ]}
        >
          <TextArea
            rows={4}
            maxLength={1000}
            showCount
            placeholder={t(
              "attendanceCorrections.form.reasonPlaceholder",
              "Explain why this correction is needed (missing check-in, wrong time, etc.)."
            )}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
