import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  DatePicker,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useI18n } from "../../../../i18n/useI18n";
import { usePayrollEnums } from "../../../../hooks/usePayrollEnums";
import { REASON_MAX_LENGTH } from "../../../../components/payroll/ReasonModal";
import { listEmployees } from "../../../../services/api/employeesApi";
import { listRents, type RentItem } from "../../../../services/api/rentsApi";
import {
  createAssignment,
  listAssignments,
  updateAssignment,
} from "../../../../services/api/accommodationApi";
import {
  parsePayrollError,
  payrollErrorSummary,
} from "../../../../services/api/payrollErrors";
import type {
  AccommodationAssignment,
  AccommodationStatus,
  UpdateAssignmentRequest,
} from "../../../../services/api/payrollTypes";

interface FormValues {
  employee_profile_id?: number;
  status: AccommodationStatus;
  rent_id?: number | null;
  start_date?: Dayjs;
  end_date?: Dayjs;
  reason: string;
}

interface EmployeeOption {
  value: number;
  label: string;
}

const STATUSES: AccommodationStatus[] = ["assigned", "none", "unknown"];
const DATE = "YYYY-MM-DD";

/**
 * Create/edit an accommodation assignment (contract 7.5). HR/Admin only: rents
 * and employee lookup are HR+Admin APIs. Both dates are required and inclusive;
 * an overlapping interval is a 409 assignment_overlap shown in the dialog.
 */
export default function AssignmentFormModal({
  open,
  assignment,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create. */
  assignment: AccommodationAssignment | null;
  onClose: () => void;
  onSaved: (saved: AccommodationAssignment) => void;
}) {
  const { t, language } = useI18n();
  const { label } = usePayrollEnums();
  const [form] = Form.useForm<FormValues>();
  const [rents, setRents] = useState<RentItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = assignment !== null;
  const saveLock = useRef(false);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setOverlap(null);
    form.resetFields();
    if (assignment) {
      form.setFieldsValue({
        employee_profile_id: assignment.employee_profile_id,
        status: assignment.status,
        rent_id: assignment.rent_id,
        start_date: dayjs(assignment.start_date),
        end_date: dayjs(assignment.end_date),
        reason: "",
      });
      setEmployees([
        {
          value: assignment.employee_profile_id,
          label: `${assignment.employee_name} (${assignment.employee_id})`,
        },
      ]);
    } else {
      form.setFieldsValue({ status: "assigned", rent_id: null, reason: "" });
    }
    listRents({ page: 1, page_size: 200 })
      .then((response) => {
        if (response.status === "success") setRents(response.data.items ?? []);
      })
      .catch(() => setRents([]));
  }, [open, assignment, form]);

  const searchEmployees = useCallback(
    (search: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(async () => {
        setSearching(true);
        try {
          const response = await listEmployees({
            search: search || undefined,
            page_size: 20,
          });
          if (response.status !== "success") return;
          const payload = response.data as unknown as {
            results?: Array<Record<string, unknown>>;
            items?: Array<Record<string, unknown>>;
          };
          const rows = payload.results ?? payload.items ?? [];
          setEmployees(
            rows.map((row) => {
              const name =
                (language === "ar" ? row.full_name_ar : row.full_name_en) ??
                row.full_name ??
                "";
              return {
                value: Number(row.id),
                label: `${String(name)} (${String(row.employee_id ?? "")})`,
              };
            }),
          );
        } catch {
          setEmployees([]);
        } finally {
          setSearching(false);
        }
      }, 300);
    },
    [language],
  );

  const rentOptions = useMemo(
    () =>
      rents.map((rent) => ({
        value: rent.id,
        disabled:
          rent.annual_rent_value === null || rent.annual_rent_value === "",
        label: `${(language === "ar" ? rent.property_name_ar : rent.property_name_en) || rent.property_name_en || `#${rent.id}`}${
          rent.annual_rent_value === null || rent.annual_rent_value === ""
            ? ` · ${t("payroll.ui.rentValueMissing")}`
            : ""
        }`,
      })),
    [rents, language, t],
  );

  const submit = async () => {
    if (saveLock.current) return;
    saveLock.current = true;
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      saveLock.current = false;
      return;
    }
    const status = values.status;
    const rentId = status === "assigned" ? (values.rent_id ?? null) : null;
    const start = values.start_date!.format(DATE);
    const end = values.end_date!.format(DATE);
    const reason = values.reason.trim();
    setSaving(true);
    setFormError(null);
    setOverlap(null);
    try {
      let saved: AccommodationAssignment;
      if (assignment) {
        const patch: UpdateAssignmentRequest = { reason };
        if (status !== assignment.status) patch.status = status;
        if (rentId !== assignment.rent_id) patch.rent_id = rentId;
        if (start !== assignment.start_date) patch.start_date = start;
        if (end !== assignment.end_date) patch.end_date = end;
        saved = await updateAssignment(assignment.id, patch);
      } else {
        saved = await createAssignment({
          employee_profile_id: values.employee_profile_id!,
          status,
          rent_id: rentId,
          start_date: start,
          end_date: end,
          reason,
        });
      }
      onSaved(saved);
    } catch (err) {
      const parsed = parsePayrollError(err);
      if (parsed.httpStatus === 409) {
        try {
          const page = await listAssignments({
            employee_profile_id: values.employee_profile_id,
            page: 1,
            page_size: 1000,
          });
          const ranges = page.items
            .filter(
              (row) =>
                row.id !== assignment?.id &&
                row.start_date <= end &&
                row.end_date >= start,
            )
            .map((row) => `${row.start_date} – ${row.end_date}`)
            .join(" · ");
          setOverlap(
            [
              payrollErrorSummary(
                parsed,
                t("payroll.validation.assignment_overlap"),
              ),
              ranges,
            ]
              .filter(Boolean)
              .join(" · "),
          );
        } catch {
          setOverlap(
            payrollErrorSummary(
              parsed,
              t("payroll.validation.assignment_overlap"),
            ),
          );
        }
        return;
      }
      if (parsed.codes.includes("assignment_overlap")) {
        setOverlap(
          payrollErrorSummary(
            parsed,
            t("payroll.validation.assignment_overlap"),
          ),
        );
        return;
      }
      if (parsed.fieldErrors.length) {
        form.setFields(
          parsed.fieldErrors as Parameters<typeof form.setFields>[0],
        );
      }
      if (parsed.formMessages.length || !parsed.fieldErrors.length) {
        setFormError(payrollErrorSummary(parsed, t("payroll.ui.saveFailed")));
      }
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        editing ? t("payroll.ui.editAssignment") : t("payroll.ui.newAssignment")
      }
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      okButtonProps={{ loading: saving }}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
      maskClosable={!saving}
    >
      {overlap && (
        <Alert
          type="error"
          showIcon
          role="alert"
          style={{ marginBottom: 12 }}
          message={overlap}
          description={t("payroll.ui.assignmentOverlapHelp")}
        />
      )}
      {formError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={formError}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        requiredMark
        onFinish={() => void submit()}
      >
        <Form.Item
          name="employee_profile_id"
          label={t("payroll.ui.employee")}
          rules={[
            { required: true, message: t("payroll.ui.employeeRequired") },
          ]}
        >
          <Select
            showSearch
            disabled={editing}
            filterOption={false}
            onSearch={searchEmployees}
            onFocus={() => {
              if (!editing && employees.length === 0) searchEmployees("");
            }}
            loading={searching}
            options={employees}
            placeholder={t("payroll.ui.searchEmployees")}
            aria-label={t("payroll.ui.employee")}
          />
        </Form.Item>
        <Form.Item name="status" label={t("payroll.ui.accommodationStatus")}>
          <Radio.Group>
            <Space orientation="vertical">
              {STATUSES.map((value) => (
                <Radio value={value} key={value}>
                  {label(
                    "accommodation_status",
                    value,
                    `payroll.accommodation_status.${value}`,
                  )}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.status !== b.status}>
          {({ getFieldValue }) =>
            getFieldValue("status") === "assigned" ? (
              <Form.Item
                name="rent_id"
                label={t("payroll.ui.property")}
                rules={[
                  { required: true, message: t("payroll.ui.propertyRequired") },
                ]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={rentOptions}
                  aria-label={t("payroll.ui.property")}
                />
              </Form.Item>
            ) : null
          }
        </Form.Item>
        <Space wrap style={{ width: "100%" }}>
          <Form.Item
            name="start_date"
            label={t("payroll.ui.startDate")}
            rules={[{ required: true, message: t("payroll.ui.dateRequired") }]}
          >
            <DatePicker format={DATE} aria-label={t("payroll.ui.startDate")} />
          </Form.Item>
          <Form.Item
            name="end_date"
            label={t("payroll.ui.endDate")}
            dependencies={["start_date"]}
            rules={[
              { required: true, message: t("payroll.ui.dateRequired") },
              ({ getFieldValue }) => ({
                validator: (_, value?: Dayjs) => {
                  const start: Dayjs | undefined = getFieldValue("start_date");
                  return !value || !start || !value.isBefore(start, "day")
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(t("payroll.validation.invalid_date_range")),
                      );
                },
              }),
            ]}
          >
            <DatePicker format={DATE} aria-label={t("payroll.ui.endDate")} />
          </Form.Item>
        </Space>
        <Form.Item
          name="reason"
          label={t("payroll.ui.reasonLabel")}
          extra={t("payroll.ui.reasonHelp")}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t("payroll.ui.reasonRequired"),
            },
            { max: REASON_MAX_LENGTH, message: t("payroll.ui.reasonTooLong") },
          ]}
        >
          <Input.TextArea
            rows={2}
            maxLength={REASON_MAX_LENGTH}
            showCount
            aria-label={t("payroll.ui.reasonLabel")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
