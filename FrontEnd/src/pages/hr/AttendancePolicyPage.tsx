import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Form, Space, message } from "antd";
import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import AttendancePolicyFields from "../admin/AttendancePolicyFields";
import {
  getSettings,
  updateAttendancePolicy,
} from "../../services/api/settingsApi";
import { isApiError } from "../../services/api/apiTypes";
import type {
  ApiError,
  AttendancePolicySettings,
} from "../../services/api/apiTypes";
import { getHttpStatus } from "../../services/api/httpErrors";
import { toAntdFieldErrors } from "../../utils/formErrors";
import { useI18n } from "../../i18n/useI18n";

type FormValues = { attendance: AttendancePolicySettings };

type Mode = "loading" | "ok" | "error" | "forbidden";

type FieldError = { name: (string | number)[]; errors: string[] };

const nameKey = (name: readonly (string | number)[]) => name.join(".");

/**
 * HR Manager entry point to the global attendance policy. It saves an
 * attendance-only body, the only settings update an HR Manager may make.
 */
export default function AttendancePolicyPage() {
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [mode, setMode] = useState<Mode>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setMode("loading");
    setLoadError(null);
    setSaveError(null);
    try {
      const response = await getSettings();
      if (isApiError(response)) {
        setLoadError(response.message);
        setMode("error");
        return;
      }
      form.setFieldsValue({ attendance: response.data.attendance ?? {} });
      setMode("ok");
    } catch (error) {
      if (getHttpStatus(error) === 403) {
        setMode("forbidden");
        return;
      }
      setLoadError(t("hr.attendancePolicy.loadError"));
      setMode("error");
    }
  }, [form, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Puts each server message on the field it names (dotted paths such as
   * `attendance.grace_window_minutes`). Only errors that match no rendered
   * field, or that belong to no field, fall back to the form-level message.
   */
  function applyValidationErrors(error: unknown) {
    const data = (error as { response?: { data?: Partial<ApiError> } }).response
      ?.data;
    const entries: FieldError[] = toAntdFieldErrors({
      status: "error",
      message: data?.message ?? "",
      errors: data?.errors,
    });
    const registered = new Set(
      form.getFieldsError().map(({ name }) => nameKey(name)),
    );
    const matched = new Map<string, FieldError>();
    const unmatched: string[] = [];
    entries.forEach((entry) => {
      const key = nameKey(entry.name);
      if (!registered.has(key)) {
        unmatched.push(...entry.errors);
        return;
      }
      const existing = matched.get(key);
      if (existing) existing.errors.push(...entry.errors);
      else matched.set(key, { name: entry.name, errors: [...entry.errors] });
    });
    form.setFields([...matched.values()] as Parameters<
      typeof form.setFields
    >[0]);
    if (unmatched.length || matched.size === 0) {
      setSaveError(
        unmatched.find((text) => text?.trim()) ??
          t("hr.attendancePolicy.invalid"),
      );
    }
  }

  async function save(values: FormValues) {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await updateAttendancePolicy(values.attendance);
      if (isApiError(response)) {
        setSaveError(response.message || t("hr.attendancePolicy.saveError"));
        return;
      }
      form.setFieldsValue({ attendance: response.data.attendance ?? {} });
      message.success(t("hr.attendancePolicy.saved"));
    } catch (error) {
      const status = getHttpStatus(error);
      if (status === 403) {
        setMode("forbidden");
      } else if (status === 422) {
        applyValidationErrors(error);
      } else {
        setSaveError(t("hr.attendancePolicy.saveError"));
      }
    } finally {
      setSaving(false);
    }
  }

  if (mode === "forbidden") return <Unauthorized403Page />;
  if (mode === "loading")
    return <LoadingState title={t("hr.attendancePolicy.loading")} />;
  if (mode === "error") {
    return (
      <ErrorState
        title={t("hr.attendancePolicy.loadError")}
        description={loadError ?? undefined}
        onRetry={load}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t("hr.attendancePolicy.title")}
        subtitle={t("hr.attendancePolicy.subtitle")}
      />
      <Card style={{ borderRadius: 16 }}>
        <Alert
          type="info"
          showIcon
          title={t("hr.attendancePolicy.globalNotice")}
          style={{ marginBottom: 16 }}
        />
        {saveError && (
          <Alert
            type="error"
            showIcon
            title={saveError}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={save}
        >
          <AttendancePolicyFields />
          <Space wrap style={{ marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
            >
              {t("common.save")}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              disabled={saving}
              onClick={() => void load()}
            >
              {t("hr.attendancePolicy.discard")}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
