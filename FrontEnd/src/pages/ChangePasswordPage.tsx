import { useState } from "react";
import { Alert, Button, Card, Form, Input, Space, Typography, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { changePasswordApi } from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";

type FormValues = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
};

function validatePasswordStrength(pw: string) {
  // Phase 1 baseline: simple strength rule (we can tighten based on backend policy later)
  // Require 8+, with at least 1 letter + 1 number
  const okLen = pw.length >= 8;
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasNumber = /\d/.test(pw);
  return okLen && hasLetter && hasNumber;
}

export default function ChangePasswordPage() {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onFinish(values: FormValues) {
    setError(null);
    setSubmitting(true);

    try {
      const res = await changePasswordApi({
        current_password: values.currentPassword,
        new_password: values.newPassword,
      });

      if (isApiError(res)) {
        setError(res.message || "Failed to change password. Please try again.");
        return;
      }

      message.success("Password changed successfully.");
      form.resetFields();

      // Optional: redirect somewhere after change
      // navigate("/admin/dashboard");
    } catch (e: any) {
      setError(e?.message || "Failed to change password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <Card
        style={{ borderRadius: 16 }}
        bodyStyle={{ padding: 24 }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={3} style={{ marginBottom: 4 }}>
              Change Password
            </Typography.Title>
            <Typography.Text type="secondary">
              Update your password to keep your account secure.
            </Typography.Text>
          </div>

          {error && <Alert type="error" showIcon message={error} />}

          <Form<FormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={onFinish}
          >
            <Form.Item
              label="Current Password"
              name="currentPassword"
              rules={[{ required: true, message: "Current password is required" }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item
              label="New Password"
              name="newPassword"
              rules={[
                { required: true, message: "New password is required" },
                () => ({
                  validator(_, value) {
                    if (!value) return Promise.resolve();
                    if (validatePasswordStrength(value)) return Promise.resolve();
                    return Promise.reject(
                      new Error("Password must be at least 8 characters and include letters and numbers.")
                    );
                  },
                }),
              ]}
              hasFeedback
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Enter new password"
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              label="Confirm New Password"
              name="confirmNewPassword"
              dependencies={["newPassword"]}
              hasFeedback
              rules={[
                { required: true, message: "Please confirm your new password" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    const np = getFieldValue("newPassword");
                    if (!value || value === np) return Promise.resolve();
                    return Promise.reject(new Error("Passwords do not match"));
                  },
                }),
              ]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
            </Form.Item>

            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={submitting}
              >
                Save
              </Button>

              <Button
                size="large"
                onClick={() => navigate(-1)}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
