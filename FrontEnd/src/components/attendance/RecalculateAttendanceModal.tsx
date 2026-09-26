import { useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Flex,
  Form,
  Modal,
  Radio,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import ResponsiveTable from "../ui/ResponsiveTable";
import { ViolationPenalty } from "./AttendanceViolationsTable";
import { useEmployeeOptions } from "./useEmployeeOptions";
import { useI18n } from "../../i18n/useI18n";
import { recalculateAttendance } from "../../services/api/attendanceApi";
import { isApiError } from "../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  getHttpStatus,
} from "../../services/api/httpErrors";
import type {
  AttendanceDailyResult,
  AttendanceRecalculationRequest,
} from "../../types/attendancePolicy";
import { formatDateOnly, formatTimeOnly } from "../../utils/dateTime";
import {
  fieldErrorsFromResponse,
  formatMinutes,
  graceReasonLabel,
  recalculationRangeError,
} from "../../utils/attendancePolicy";

const { RangePicker } = DatePicker;

export type RecalculationFormValues = {
  employee_profile_id?: number;
  mode: "single" | "range";
  date?: Dayjs;
  range?: [Dayjs, Dayjs];
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after a successful recalculation, e.g. to refresh a list. */
  onRecalculated?: () => void;
  initialValues?: Partial<RecalculationFormValues>;
};

function toPayload(
  values: RecalculationFormValues,
): AttendanceRecalculationRequest {
  const employee_profile_id = Number(values.employee_profile_id);
  if (values.mode === "range" && values.range) {
    return {
      employee_profile_id,
      date_from: values.range[0].format("YYYY-MM-DD"),
      date_to: values.range[1].format("YYYY-MM-DD"),
    };
  }
  return {
    employee_profile_id,
    date: (values.date as Dayjs).format("YYYY-MM-DD"),
  };
}

/** HR Manager / System Admin: rebuild one employee's days in the active company. */
export default function RecalculateAttendanceModal({
  open,
  onClose,
  onRecalculated,
  initialValues,
}: Props) {
  const { t } = useI18n();
  const [form] = Form.useForm<RecalculationFormValues>();
  // The hook-based dialog renders inside this tree, so it follows the app's
  // RTL direction and locale; the static Modal.confirm would not.
  const [modal, contextHolder] = Modal.useModal();
  const watchedMode = Form.useWatch("mode", form);
  const mode = watchedMode ?? initialValues?.mode ?? "single";
  const employees = useEmployeeOptions({ enabled: open });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<AttendanceDailyResult[] | null>(null);

  function applyFailure(error: unknown, submittedMode: string) {
    const status = getHttpStatus(error);
    if (status === 404) {
      form.setFields([
        {
          name: "employee_profile_id",
          errors: [t("attendancePolicy.recalc.notFound")],
        },
      ]);
      return;
    }
    if (status === 403) {
      setFormError(t("attendancePolicy.recalc.companyRequired"));
      return;
    }
    if (status === 422) {
      const dateField: keyof RecalculationFormValues =
        submittedMode === "range" ? "range" : "date";
      const fieldFor: Record<string, keyof RecalculationFormValues> = {
        employee_profile_id: "employee_profile_id",
        date: dateField,
        date_from: dateField,
        date_to: dateField,
      };
      const errors = fieldErrorsFromResponse(error);
      const unmatched: string[] = [];
      const fields: Array<{
        name: keyof RecalculationFormValues;
        errors: string[];
      }> = [];
      Object.entries(errors).forEach(([field, text]) => {
        if (fieldFor[field])
          fields.push({ name: fieldFor[field], errors: [text] });
        else unmatched.push(text);
      });
      form.setFields(fields);
      if (unmatched.length || fields.length === 0) {
        setFormError(unmatched[0] ?? getHttpErrorMessage(error));
      }
      return;
    }
    setFormError(getHttpErrorMessage(error));
  }

  async function run(values: RecalculationFormValues) {
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await recalculateAttendance(toPayload(values));
      if (isApiError(response)) {
        setFormError(response.message);
        return;
      }
      setResults(response.data.results);
      message.success(
        t("attendancePolicy.recalc.success", {
          count: response.data.results.length,
        }),
      );
      onRecalculated?.();
    } catch (error) {
      applyFailure(error, values.mode);
    } finally {
      setSubmitting(false);
    }
  }

  function confirm(values: RecalculationFormValues) {
    setFormError(null);
    const employee =
      employees.options.find(
        (option) => option.value === values.employee_profile_id,
      )?.label ?? `#${values.employee_profile_id}`;
    const payload = toPayload(values);
    const from = "date" in payload ? payload.date : payload.date_from;
    const to = "date" in payload ? payload.date : payload.date_to;
    modal.confirm({
      title: t("attendancePolicy.recalc.confirmTitle"),
      content: t("attendancePolicy.recalc.confirmBody", { employee, from, to }),
      okText: t("attendancePolicy.recalc.confirmOk"),
      cancelText: t("common.cancel"),
      onOk: () => run(values),
    });
  }

  const columns: ColumnsType<AttendanceDailyResult> = [
    {
      title: t("common.date"),
      dataIndex: "date",
      key: "date",
      render: (value: string) => formatDateOnly(value),
    },
    {
      title: t("common.status"),
      key: "status",
      render: (_: unknown, record: AttendanceDailyResult) => (
        <Tag
          color={record.status_input === "LATE" ? "orange" : "green"}
          style={{ marginInlineEnd: 0 }}
        >
          {t(`attendancePolicy.status.${record.status_input}`, {}, "")}
        </Tag>
      ),
    },
    {
      title: t("attendancePolicy.today.firstCheckIn"),
      key: "check_in",
      render: (_: unknown, record: AttendanceDailyResult) =>
        formatTimeOnly(record.first_check_in_at),
    },
    {
      title: t("attendancePolicy.today.finalCheckOut"),
      key: "check_out",
      render: (_: unknown, record: AttendanceDailyResult) =>
        formatTimeOnly(record.final_check_out_at),
    },
    {
      title: t("attendancePolicy.today.accounted"),
      key: "accounted",
      render: (_: unknown, record: AttendanceDailyResult) =>
        formatMinutes(t, record.accounted_attendance_minutes),
    },
    {
      title: t("attendancePolicy.today.missing"),
      key: "missing",
      render: (_: unknown, record: AttendanceDailyResult) =>
        formatMinutes(t, record.missing_minutes),
    },
    {
      title: t("attendancePolicy.recalc.grace"),
      key: "grace",
      render: (_: unknown, record: AttendanceDailyResult) =>
        graceReasonLabel(t, record.grace.reason),
    },
    {
      title: t("attendancePolicy.violation.title"),
      key: "violation",
      render: (_: unknown, record: AttendanceDailyResult) =>
        record.violation ? (
          <Flex vertical gap={2}>
            <span>
              {t("attendancePolicy.violation.occurrenceNumber", {
                number: record.violation.occurrence_number,
              })}
            </span>
            <ViolationPenalty violation={record.violation} />
          </Flex>
        ) : (
          t("attendancePolicy.recalc.noViolation")
        ),
    },
  ];

  return (
    <Modal
      open={open}
      title={t("attendancePolicy.recalc.title")}
      onCancel={onClose}
      footer={null}
      width={1040}
      destroyOnHidden
      afterClose={() => {
        form.resetFields();
        setResults(null);
        setFormError(null);
      }}
    >
      {contextHolder}
      <Typography.Paragraph type="secondary">
        {t("attendancePolicy.recalc.intro")}
      </Typography.Paragraph>
      <Form<RecalculationFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ mode: "single", ...initialValues }}
        onFinish={confirm}
      >
        <Form.Item
          name="employee_profile_id"
          label={t("attendancePolicy.recalc.employee")}
          rules={[
            {
              required: true,
              message: t("attendancePolicy.recalc.employeeRequired"),
            },
          ]}
        >
          <Select
            showSearch
            filterOption={false}
            aria-label={t("attendancePolicy.recalc.employee")}
            placeholder={t("attendancePreview.filters.employeePlaceholder")}
            loading={employees.loading}
            notFoundContent={
              employees.loading ? <Spin size="small" /> : undefined
            }
            onSearch={employees.onSearch}
            options={employees.options}
          />
        </Form.Item>
        <Form.Item name="mode" label={t("attendancePolicy.recalc.period")}>
          <Radio.Group
            optionType="button"
            options={[
              { value: "single", label: t("attendancePolicy.recalc.single") },
              { value: "range", label: t("attendancePolicy.recalc.range") },
            ]}
          />
        </Form.Item>
        {mode === "range" ? (
          <Form.Item
            name="range"
            label={t("attendancePolicy.recalc.range")}
            extra={t("attendancePolicy.recalc.rangeHelp")}
            rules={[
              {
                validator: (_, value?: [Dayjs, Dayjs]) => {
                  const problem = recalculationRangeError(
                    value?.[0],
                    value?.[1],
                  );
                  return problem
                    ? Promise.reject(new Error(t(problem)))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <RangePicker style={{ width: "100%" }} />
          </Form.Item>
        ) : (
          <Form.Item
            name="date"
            label={t("common.date")}
            rules={[
              {
                required: true,
                message: t("attendancePolicy.recalc.dateRequired"),
              },
            ]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        )}
        {formError && (
          <Alert
            type="error"
            showIcon
            title={formError}
            style={{ marginBottom: 16 }}
          />
        )}
        <Button type="primary" htmlType="submit" loading={submitting}>
          {t("attendancePolicy.recalc.submit")}
        </Button>
      </Form>

      {results && (
        <div style={{ marginTop: 24 }}>
          <Typography.Title level={5}>
            {t("attendancePolicy.recalc.resultsTitle")}
          </Typography.Title>
          <ResponsiveTable<AttendanceDailyResult>
            mobileCard={{ titleKey: "date", extraKey: "status" }}
            rowKey="date"
            dataSource={results}
            columns={columns}
            size="small"
            scroll={{ x: "max-content" }}
            pagination={false}
          />
        </div>
      )}
    </Modal>
  );
}
