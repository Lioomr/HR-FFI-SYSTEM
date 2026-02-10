import { useState } from "react";
import { Alert, Button, Card, Form, Input, Select, Space, Switch, message } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader";
import Unauthorized403Page from "../Unauthorized403Page";
import type { Role } from "../../services/api/apiTypes";
import { createUser } from "../../services/api/usersApi";

type FormValues = {
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

const roleOptions: { label: string; value: Role }[] = [
  { label: "SystemAdmin", value: "SystemAdmin" },
  { label: "HRManager", value: "HRManager" },
  { label: "Employee", value: "Employee" },
];

export default function AdminUserCreatePage() {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const navigate = useNavigate();

  async function onSave(values: FormValues) {
    setError(null);
    setSaving(true);

    try {
      await createUser(values);

      // Success case
      message.success("User created.");
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
        let errorMessage = err.message || "Failed to create user.";

        // If the message is still generic, try to extract from apiData
        if (errorMessage === "Failed to create user." && apiData) {
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
      setError(err.message || "Failed to create user. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (unauthorized) return <Unauthorized403Page />;

  return (
    <div>
      <PageHeader title="Create User" subtitle="Add a new user to the system" />

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
              label="Full name"
              name="full_name"
              rules={[{ required: true, message: "Full name is required" }]}
              style={{ minWidth: 260, flex: 1 }}
            >
              <Input placeholder="Full name" />
            </Form.Item>

            <Form.Item
              label="Email"
              name="email"
              rules={[
                { required: true, message: "Email is required" },
                { type: "email", message: "Enter a valid email" },
              ]}
              style={{ minWidth: 260, flex: 1 }}
            >
              <Input placeholder="name@company.com" autoComplete="email" />
            </Form.Item>

            <Form.Item
              label="Role"
              name="role"
              rules={[{ required: true, message: "Role is required" }]}
              style={{ minWidth: 220 }}
            >
              <Select options={roleOptions} />
            </Form.Item>

            <Form.Item
              label="Active"
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
              Create User
            </Button>

            <Button onClick={() => navigate("/admin/users")} disabled={saving}>
              Cancel
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
