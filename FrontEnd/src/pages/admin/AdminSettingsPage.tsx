import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  InputNumber,
  Space,
  Switch,
  TimePicker,
  Typography,
  message,
} from "antd";
import { SaveOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import { getSettings, updateSettings } from "../../services/api/settingsApi";
import { isApiError } from "../../services/api/apiTypes";
import type { SettingsDto } from "../../services/api/apiTypes";
import { getFirstApiErrorMessage } from "../../utils/formErrors";
import { useI18n } from "../../i18n/useI18n";
import { WORK_WEEK_DAY_OPTIONS } from "./workWeekDays";

type FormValues = SettingsDto;

type UiMode = "loading" | "error" | "ok";

const HHMM_RE = /^(\d{1,2}):(\d{2})/;

/**
 * `attendance.work_day_start_time` travels as an "HH:MM" string, but antd's
 * TimePicker works in dayjs. Parsing is done by hand rather than
 * `dayjs(value, "HH:mm")` so this does not depend on the customParseFormat
 * plugin being registered.
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

export default function AdminSettingsPage() {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [mode, setMode] = useState<UiMode>("loading");
  const { t } = useI18n();

  const loadSettings = useCallback(async () => {
    setMode("loading");
    setError(null);
    setUnauthorized(false);

    try {
      const res = await getSettings();
      if (isApiError(res)) {
        setError(res.message || t("admin.settings.loadError"));
        setMode("error");
        return;
      }

      form.setFieldsValue(res.data);
      setMode("ok");
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      setError(t("admin.settings.loadError"));
      setMode("error");
    }
  }, [form, t]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function onSave(values: FormValues) {
    setError(null);
    setSaving(true);

    try {
      const res = await updateSettings(values);
      if (isApiError(res)) {
        // `errors` is contractually an array of {field, message}; render the
        // backend's own wording rather than stringifying the objects.
        const firstError = getFirstApiErrorMessage(res) || res.message;
        setError(firstError || t("admin.settings.saveError"));
        return;
      }

      form.setFieldsValue(res.data);
      message.success(t("admin.settings.saveSuccess"));
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      setError(e?.message || t("admin.settings.saveError"));
    } finally {
      setSaving(false);
    }
  }

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading")
    return <LoadingState title={t("admin.settings.loading")} />;
  if (mode === "error") {
    return (
      <ErrorState
        title={t("admin.settings.loadFailedState")}
        description={error || t("admin.settings.pleaseTryAgain")}
        onRetry={loadSettings}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t("layout.systemSettings")}
        subtitle={t("admin.settings.subtitle")}
      />

      <Card style={{ borderRadius: 16 }} bodyStyle={{ padding: 24 }}>
        {error && (
          <Alert
            style={{ marginBottom: 16 }}
            type="error"
            showIcon
            message={error}
          />
        )}

        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={onSave}
        >
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("admin.settings.secInvites")}
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label={t("admin.settings.lblDefaultInviteExpiry")}
              name={["invites", "default_expiry_hours"]}
              rules={[
                {
                  required: true,
                  message: t("admin.settings.reqInviteExpiry"),
                },
              ]}
              style={{ minWidth: 260 }}
            >
              <InputNumber
                min={1}
                max={720}
                style={{ width: "100%" }}
                placeholder="e.g. 168"
              />
            </Form.Item>
          </Space>

          <Divider />

          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("admin.settings.secSessions")}
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label={t("admin.settings.lblSessionTimeout")}
              name={["session", "timeout_minutes"]}
              rules={[
                {
                  required: true,
                  message: t("admin.settings.reqSessionTimeout"),
                },
              ]}
              style={{ minWidth: 260 }}
            >
              <InputNumber
                min={5}
                max={1440}
                style={{ width: "100%" }}
                placeholder="e.g. 60"
              />
            </Form.Item>
          </Space>

          <Divider />

          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("admin.settings.secPassword")}
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label={t("admin.settings.lblMinLength")}
              name={["password_policy", "min_length"]}
              rules={[
                { required: true, message: t("admin.settings.reqMinLength") },
              ]}
              style={{ minWidth: 260 }}
            >
              <InputNumber
                min={6}
                max={128}
                style={{ width: "100%" }}
                placeholder="e.g. 12"
              />
            </Form.Item>

            <Form.Item
              label={t("admin.settings.lblReqUpper")}
              name={["password_policy", "require_upper"]}
              valuePropName="checked"
              style={{ minWidth: 220 }}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              label={t("admin.settings.lblReqLower")}
              name={["password_policy", "require_lower"]}
              valuePropName="checked"
              style={{ minWidth: 220 }}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              label={t("admin.settings.lblReqNumber")}
              name={["password_policy", "require_number"]}
              valuePropName="checked"
              style={{ minWidth: 220 }}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              label={t("admin.settings.lblReqSpecial")}
              name={["password_policy", "require_special"]}
              valuePropName="checked"
              style={{ minWidth: 240 }}
            >
              <Switch />
            </Form.Item>
          </Space>

          <Divider />

          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("admin.settings.secSecurity")}
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label={t("admin.settings.lblMaxLoginAttempts")}
              name={["security", "max_login_attempts"]}
              rules={[
                {
                  required: true,
                  message: t("admin.settings.reqMaxLoginAttempts"),
                },
              ]}
              style={{ minWidth: 260 }}
            >
              <InputNumber
                min={1}
                max={50}
                style={{ width: "100%" }}
                placeholder="e.g. 5"
              />
            </Form.Item>
          </Space>

          <Divider />

          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("admin.settings.secAttendance")}
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label={t("admin.settings.lblGeofenceEnabled")}
              name={["attendance", "geofence_enabled"]}
              valuePropName="checked"
              extra={t("admin.settings.helpGeofenceEnabled")}
              style={{ minWidth: 320 }}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              label={t("admin.settings.lblWorkDayStart")}
              name={["attendance", "work_day_start_time"]}
              getValueProps={(value) => ({ value: toClock(value) })}
              getValueFromEvent={(_time, timeString) => timeString || undefined}
              extra={t("admin.settings.helpWorkDayStart")}
              style={{ minWidth: 260 }}
            >
              <TimePicker
                style={{ width: "100%" }}
                format="HH:mm"
                minuteStep={5}
                allowClear={false}
                aria-label={t("admin.settings.lblWorkDayStart")}
              />
            </Form.Item>

            <Form.Item
              label={t("admin.settings.lblLateGraceMinutes")}
              name={["attendance", "late_grace_minutes"]}
              extra={t("admin.settings.helpLateGraceMinutes")}
              style={{ minWidth: 260 }}
            >
              <InputNumber
                min={0}
                max={240}
                style={{ width: "100%" }}
                placeholder="e.g. 15"
                aria-label={t("admin.settings.lblLateGraceMinutes")}
              />
            </Form.Item>

            <Form.Item
              label={t("admin.settings.lblAbsenceDetection")}
              name={["attendance", "absence_detection_enabled"]}
              valuePropName="checked"
              extra={t("admin.settings.helpAbsenceDetection")}
              style={{ minWidth: 320 }}
            >
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item
            label={t("admin.settings.lblWorkingDays")}
            name={["attendance", "work_week_days"]}
            extra={t("admin.settings.helpWorkingDays")}
            style={{ marginTop: 8 }}
          >
            <Checkbox.Group
              options={WORK_WEEK_DAY_OPTIONS.map((day) => ({
                label: t(day.labelKey),
                value: day.value,
              }))}
            />
          </Form.Item>

          <Divider />

          <Space>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              icon={<SaveOutlined />}
              loading={saving}
            >
              {t("common.save")}
            </Button>

            <Button
              size="large"
              onClick={() => form.resetFields()}
              disabled={saving}
            >
              {t("admin.settings.btnReset")}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
