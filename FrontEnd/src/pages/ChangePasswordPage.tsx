import { useState } from "react";
import { Alert, Button, Card, Form, Input, Space, Typography, message } from "antd";
import { LockOutlined, ArrowLeftOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { changePasswordApi } from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";
import { useAuthStore } from "../auth/authStore";
import { useI18n } from "../i18n/useI18n";

type FormValues = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
};

function validatePasswordStrength(pw: string) {
  const okLen = pw.length >= 8;
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasNumber = /\d/.test(pw);
  return okLen && hasLetter && hasNumber;
}

const { Title, Text } = Typography;

export default function ChangePasswordPage() {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { t } = useI18n();

  async function onFinish(values: FormValues) {
    setError(null);
    setSubmitting(true);

    try {
      const res = await changePasswordApi({
        current_password: values.currentPassword,
        new_password: values.newPassword,
      });

      if (isApiError(res)) {
        setError(res.message || t("common.tryAgain"));
        return;
      }

      message.success(t("changePassword.success"));
      form.resetFields();

      // Clear auth and redirect to login
      useAuthStore.getState().logout();
      navigate("/login");

    } catch (e: any) {
      setError(e?.message || t("common.tryAgain"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '80vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 0'
    }}>
      <Card
        style={{
          maxWidth: 480,
          width: '100%',
          borderRadius: 24,
          border: 'none',
          boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
          overflow: 'hidden'
        }}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{
          background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
          padding: '40px 32px',
          textAlign: 'center'
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.3)'
          }}>
            <LockOutlined style={{ fontSize: 32, color: '#fff' }} />
          </div>
          <Title level={2} style={{ color: '#fff', margin: 0, fontWeight: 700 }}>
            {t("changePassword.title")}
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.85)', display: 'block', marginTop: 8 }}>
            {t("changePassword.subtitle")}
          </Text>
        </div>

        <div style={{ padding: '32px' }}>
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 24, borderRadius: 12 }}
            />
          )}

          <Form<FormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={onFinish}
            autoComplete="off"
          >
            <Form.Item
              label={<Text strong>{t("changePassword.currentPassword")}</Text>}
              name="currentPassword"
              rules={[{ required: true, message: t("changePassword.currentRequired") }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                placeholder={t("changePassword.enterCurrent")}
                autoComplete="current-password"
                style={{ borderRadius: 12 }}
              />
            </Form.Item>

            <Form.Item
              label={<Text strong>{t("changePassword.newPassword")}</Text>}
              name="newPassword"
              extra={<Text type="secondary" style={{ fontSize: 12 }}>{t("changePassword.strengthError")}</Text>}
              rules={[
                { required: true, message: t("changePassword.newRequired") },
                () => ({
                  validator(_, value) {
                    if (!value) return Promise.resolve();
                    if (validatePasswordStrength(value)) return Promise.resolve();
                    return Promise.reject(new Error(t("changePassword.strengthError")));
                  },
                }),
              ]}
              hasFeedback
            >
              <Input.Password
                size="large"
                prefix={<SafetyCertificateOutlined style={{ color: '#bfbfbf' }} />}
                placeholder={t("changePassword.enterNew")}
                autoComplete="new-password"
                style={{ borderRadius: 12 }}
              />
            </Form.Item>

            <Form.Item
              label={<Text strong>{t("changePassword.confirmPassword")}</Text>}
              name="confirmNewPassword"
              dependencies={["newPassword"]}
              hasFeedback
              rules={[
                { required: true, message: t("changePassword.confirmRequired") },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    const np = getFieldValue("newPassword");
                    if (!value || value === np) return Promise.resolve();
                    return Promise.reject(new Error(t("changePassword.mismatch")));
                  },
                }),
              ]}
            >
              <Input.Password
                size="large"
                prefix={<SafetyCertificateOutlined style={{ color: '#bfbfbf' }} />}
                placeholder={t("changePassword.enterConfirm")}
                autoComplete="new-password"
                style={{ borderRadius: 12 }}
              />
            </Form.Item>

            <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={submitting}
                style={{
                  height: 48,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                  border: 'none',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(249, 115, 22, 0.25)'
                }}
              >
                {t("common.save")}
              </Button>

              <Button
                size="large"
                block
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate(-1)}
                disabled={submitting}
                style={{
                  height: 48,
                  borderRadius: 12,
                  fontWeight: 500
                }}
              >
                {t("common.cancel")}
              </Button>
            </Space>
          </Form>
        </div>
      </Card>
    </div>
  );
}
