import { Form, InputNumber, Space, TimePicker } from "antd";
import dayjs from "dayjs";
import type { AttendancePolicySettings } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";

const HHMM_RE = /^(\d{1,2}):(\d{2})/;

/**
 * Clock settings travel as "HH:MM" strings, but antd's TimePicker works in
 * dayjs. Parsing is done by hand rather than `dayjs(value, "HH:mm")` so this
 * does not depend on the customParseFormat plugin being registered.
 */
function toClock(value: unknown): dayjs.Dayjs | undefined {
  if (dayjs.isDayjs(value)) return value;
  if (typeof value === "string") {
    const match = HHMM_RE.exec(value);
    if (match) {
      return dayjs()
        .hour(Number(match[1]))
        .minute(Number(match[2]))
        .second(0)
        .millisecond(0);
    }
  }
  return undefined;
}

type ClockField = {
  name: keyof AttendancePolicySettings;
  label: string;
  help: string;
};

type NumberField = ClockField & { min: number; max: number };

/**
 * The global attendance policy controls, bound under `attendance.*` of the
 * surrounding settings form. Ranges mirror the server serializer. Kept
 * separate so an attendance-only (HR Manager) settings screen can reuse it.
 */
export default function AttendancePolicyFields() {
  const { t } = useI18n();

  const clockFields: ClockField[] = [
    {
      name: "work_day_start_time",
      label: t("admin.settings.lblWorkDayStart"),
      help: t("admin.settings.helpWorkDayStart"),
    },
    {
      name: "default_shift_end_time",
      label: t("admin.settings.lblDefaultShiftEnd"),
      help: t("admin.settings.helpDefaultShiftEnd"),
    },
  ];

  const numberFields: NumberField[] = [
    {
      name: "grace_window_minutes",
      label: t("admin.settings.lblGraceWindow"),
      help: t("admin.settings.helpGraceWindow"),
      min: 0,
      max: 240,
    },
    {
      name: "post_grace_tolerance_minutes",
      label: t("admin.settings.lblPostGraceTolerance"),
      help: t("admin.settings.helpPostGraceTolerance"),
      min: 0,
      max: 240,
    },
    {
      name: "approved_late_permission_limit_per_month",
      label: t("admin.settings.lblLatePermissionLimit"),
      help: t("admin.settings.helpLatePermissionLimit"),
      min: 0,
      max: 31,
    },
    {
      name: "during_shift_permission_max_minutes",
      label: t("admin.settings.lblDuringShiftMax"),
      help: t("admin.settings.helpDuringShiftMax"),
      min: 1,
      max: 1440,
    },
    {
      name: "permission_request_advance_limit_days",
      label: t("admin.settings.lblAdvanceLimit"),
      help: t("admin.settings.helpAdvanceLimit"),
      min: 0,
      max: 365,
    },
  ];

  return (
    <Space style={{ width: "100%" }} align="start" wrap>
      {clockFields.map((field) => (
        <Form.Item
          key={field.name}
          label={field.label}
          name={["attendance", field.name]}
          getValueProps={(value) => ({ value: toClock(value) })}
          getValueFromEvent={(_time, timeString) => timeString || undefined}
          extra={field.help}
          style={{ minWidth: 260, maxWidth: 360 }}
        >
          <TimePicker
            style={{ width: "100%" }}
            format="HH:mm"
            minuteStep={5}
            allowClear={false}
            aria-label={field.label}
          />
        </Form.Item>
      ))}
      {numberFields.map((field) => (
        <Form.Item
          key={field.name}
          label={field.label}
          name={["attendance", field.name]}
          extra={field.help}
          rules={[
            {
              type: "integer",
              min: field.min,
              max: field.max,
              message: t("admin.settings.rangeError", {
                min: field.min,
                max: field.max,
              }),
            },
          ]}
          style={{ minWidth: 260, maxWidth: 360 }}
        >
          <InputNumber
            min={field.min}
            max={field.max}
            precision={0}
            style={{ width: "100%" }}
            aria-label={field.label}
          />
        </Form.Item>
      ))}
    </Space>
  );
}
