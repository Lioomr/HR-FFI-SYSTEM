import { useState } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, Space, Typography } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { loginApi } from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";

type LoginFormValues = {
  email: string;
  password: string;
  remember: boolean;
};

export default function LoginPage() {
  const [form] = Form.useForm<LoginFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  async function onFinish(values: LoginFormValues) {
  setError(null);
  setSubmitting(true);

  try {
    // Try real backend login first:
    const res = await loginApi({ email: values.email, password: values.password });

    if (isApiError(res)) {
      setError(res.message || "Login failed.");
      return;
    }

    login(res.data.user, res.data.token);

    const role = res.data.user.role;
    if (role === "SystemAdmin") navigate("/admin/dashboard", { replace: true });
    else if (role === "HRManager") navigate("/hr/dashboard", { replace: true });
    else navigate("/employee/home", { replace: true });
  } catch (e: any) {
    // If backend not running yet, show a clear message:
    setError("Backend not connected (API login failed). Start the backend or set VITE_API_BASE_URL.");
  } finally {
    setSubmitting(false);
  }
}

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <Card
        style={{ width: "100%", maxWidth: 420, borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.08)" }}
        bodyStyle={{ padding: 24 }}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={3} style={{ marginBottom: 4 }}>
              FFI HR System
            </Typography.Title>
            <Typography.Text type="secondary">Sign in to continue</Typography.Text>
          </div>

          {error && <Alert type="error" showIcon message={error} />}

          <Form<LoginFormValues>
            form={form}
            layout="vertical"
            onFinish={onFinish}
            initialValues={{ remember: true }}
            requiredMark={false}
          >
            <Form.Item
              label="Email"
              name="email"
              rules={[
                { required: true, message: "Email is required" },
                { type: "email", message: "Enter a valid email" },
              ]}
            >
              <Input size="large" prefix={<MailOutlined />} placeholder="name@company.com" autoComplete="email" />
            </Form.Item>

            <Form.Item
              label="Password"
              name="password"
              rules={[{ required: true, message: "Password is required" }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Form.Item>

            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Remember me</Checkbox>
              </Form.Item>

              <Typography.Link disabled>Forgot password?</Typography.Link>
            </div>

            <Button type="primary" htmlType="submit" size="large" loading={submitting} block>
              Sign In
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
