import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  InputNumber,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import { SaveOutlined } from "@ant-design/icons";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import ErrorState from "../../components/ui/ErrorState";
import Unauthorized403Page from "../Unauthorized403Page";
import { getSettings, updateSettings } from "../../services/api/settingsApi";
import { isApiError } from "../../services/api/apiTypes";
import type { SettingsDto } from "../../services/api/apiTypes";

type FormValues = SettingsDto;

type UiMode = "loading" | "error" | "ok";

export default function AdminSettingsPage() {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [mode, setMode] = useState<UiMode>("loading");

  const loadSettings = useCallback(async () => {
    setMode("loading");
    setError(null);
    setUnauthorized(false);

    try {
      const res = await getSettings();
      if (isApiError(res)) {
        setError(res.message || "Failed to load settings.");
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
      setError("Failed to load settings.");
      setMode("error");
    }
  }, [form]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function onSave(values: FormValues) {
    setError(null);
    setSaving(true);

    try {
      const res = await updateSettings(values);
      if (isApiError(res)) {
        const firstError = res.errors
          ? Object.values(res.errors).flat().join(" ")
          : res.message;
        setError(firstError || "Failed to save settings.");
        return;
      }

      form.setFieldsValue(res.data);
      message.success("Settings saved.");
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }
      setError(e?.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (unauthorized) return <Unauthorized403Page />;
  if (mode === "loading") return <LoadingState title="Loading settings..." />;
  if (mode === "error") {
    return (
      <ErrorState
        title="Failed to load settings"
        description={error || "Please try again."}
        onRetry={loadSettings}
      />
    );
  }

  return (
    <div>
      <PageHeader title="System Settings" subtitle="Manage system-wide policies" />

      <Card style={{ borderRadius: 16 }} bodyStyle={{ padding: 24 }}>
        {error && (
          <Alert style={{ marginBottom: 16 }} type="error" showIcon message={error} />
        )}

        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={onSave}
        >
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Invites
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label="Default invite expiry (hours)"
              name={["invites", "default_expiry_hours"]}
              rules={[{ required: true, message: "Invite expiry is required" }]}
              style={{ minWidth: 260 }}
            >
              <InputNumber min={1} max={720} style={{ width: "100%" }} placeholder="e.g. 168" />
            </Form.Item>
          </Space>

          <Divider />

          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Sessions
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label="Session timeout (minutes)"
              name={["session", "timeout_minutes"]}
              rules={[{ required: true, message: "Session timeout is required" }]}
              style={{ minWidth: 260 }}
            >
              <InputNumber min={5} max={1440} style={{ width: "100%" }} placeholder="e.g. 60" />
            </Form.Item>
          </Space>

          <Divider />

          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Password Policy
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label="Minimum password length"
              name={["password_policy", "min_length"]}
              rules={[{ required: true, message: "Minimum length is required" }]}
              style={{ minWidth: 260 }}
            >
              <InputNumber min={6} max={128} style={{ width: "100%" }} placeholder="e.g. 12" />
            </Form.Item>

            <Form.Item
              label="Require uppercase"
              name={["password_policy", "require_upper"]}
              valuePropName="checked"
              style={{ minWidth: 220 }}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              label="Require lowercase"
              name={["password_policy", "require_lower"]}
              valuePropName="checked"
              style={{ minWidth: 220 }}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              label="Require numbers"
              name={["password_policy", "require_number"]}
              valuePropName="checked"
              style={{ minWidth: 220 }}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              label="Require special characters"
              name={["password_policy", "require_special"]}
              valuePropName="checked"
              style={{ minWidth: 240 }}
            >
              <Switch />
            </Form.Item>
          </Space>

          <Divider />

          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Security
          </Typography.Title>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label="Max login attempts"
              name={["security", "max_login_attempts"]}
              rules={[{ required: true, message: "Max login attempts is required" }]}
              style={{ minWidth: 260 }}
            >
              <InputNumber min={1} max={50} style={{ width: "100%" }} placeholder="e.g. 5" />
            </Form.Item>
          </Space>

          <Divider />

          <Space>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              icon={<SaveOutlined />}
              loading={saving}
            >
              Save
            </Button>

            <Button size="large" onClick={() => form.resetFields()} disabled={saving}>
              Reset
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
