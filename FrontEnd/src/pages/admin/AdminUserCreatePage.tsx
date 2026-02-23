import { useState } from "react";
import { Alert, Button, Card, Form, Input, Select, Space, Switch, message } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader";
import Unauthorized403Page from "../Unauthorized403Page";
import type { Role } from "../../services/api/apiTypes";
import { createUser } from "../../services/api/usersApi";
import { useI18n } from "../../i18n/useI18n";

type FormValues = {
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

const roleOptions: { label: string; value: Role }[] = [
  { label: "SystemAdmin", value: "SystemAdmin" },
  { label: "HRManager", value: "HRManager" },
  { label: "Manager", value: "Manager" },
  { label: "Employee", value: "Employee" },
  { label: "CEO", value: "CEO" },
];

export default function AdminUserCreatePage() {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();

  async function onSave(values: FormValues) {
    setError(null);
    setSaving(true);

    try {
      await createUser(values);

      // Success case
      message.success(t("admin.userCreate.successMsg"));
      navigate("/admin/users", { replace: true });
    } catch (err: any) {
      // Handle 403 Forbidden
      if (err?.response?.status === 403) {
        setUnauthorized(true);
        return;
      }

      // Handle 422 Validation Error
      if (err?.response?.status === 422) {
        const apiData = err?.apiData || err?.response?.data;

        // Use the error message from backend (already extracted by interceptor)
        let errorMessage = err.message || t("admin.userCreate.failMsg");

        // If the message is still generic, try to extract from apiData
        if (errorMessage === t("admin.userCreate.failMsg") && apiData) {
          if (apiData.message) {
            errorMessage = apiData.message;
          } else if (apiData.errors && typeof apiData.errors === "object") {
            // Fallback: extract from field errors
            const firstFieldErrors = Object.values(apiData.errors).find(
              (fieldErrors: any) => Array.isArray(fieldErrors) && fieldErrors.length > 0
            );
            if (firstFieldErrors && Array.isArray(firstFieldErrors)) {
              errorMessage = firstFieldErrors[0];
            }
          }
        }

        setError(errorMessage);
        return;
      }

      // Generic error
      setError(err.message || t("admin.userCreate.failMsgTryAgain"));
    } finally {
      setSaving(false);
    }
  }

  if (unauthorized) return <Unauthorized403Page />;

  return (
    <div>
      <PageHeader title={t("layout.createUser")} subtitle={t("admin.userCreate.subtitle")} />

      <Card style={{ borderRadius: 16 }} bodyStyle={{ padding: 24 }}>
        {error && (
          <Alert style={{ marginBottom: 16 }} type="error" showIcon message={error} />
        )}

        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={onSave}
          initialValues={{ role: "Employee", is_active: true }}
        >
          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              label={t("admin.userCreate.lblFullName")}
              name="full_name"
              rules={[{ required: true, message: t("admin.userCreate.reqFullName") }]}
              style={{ minWidth: 260, flex: 1 }}
            >
              <Input placeholder={t("admin.userCreate.placeholderFullName")} />
            </Form.Item>

            <Form.Item
              label={t("auth.email")}
              name="email"
              rules={[
                { required: true, message: t("auth.emailRequired") },
                { type: "email", message: t("auth.emailInvalid") },
              ]}
              style={{ minWidth: 260, flex: 1 }}
            >
              <Input placeholder={t("admin.userCreate.placeholderEmail")} autoComplete="email" />
            </Form.Item>

            <Form.Item
              label={t("admin.userCreate.lblRole")}
              name="role"
              rules={[{ required: true, message: t("admin.userCreate.reqRole") }]}
              style={{ minWidth: 220 }}
            >
              <Select options={roleOptions} />
            </Form.Item>

            <Form.Item
              label={t("admin.userCreate.lblActive")}
              name="is_active"
              valuePropName="checked"
              style={{ minWidth: 160 }}
            >
              <Switch />
            </Form.Item>
          </Space>

          <Space style={{ marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
            >
              {t("layout.createUser")}
            </Button>

            <Button onClick={() => navigate("/admin/users")} disabled={saving}>
              {t("common.cancel")}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
