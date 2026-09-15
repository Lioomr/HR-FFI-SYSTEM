import { useState } from "react";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import {
  LockOutlined,
  ArrowLeftOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPasswordConfirmApi } from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";
import { useI18n } from "../i18n/useI18n";

type FormValues = {
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

/**
 * Public landing page for the one-time link a password-reset email sends
 * (`/reset-password?token=...&uid=...`). Unlike `/change-password`, this page
 * requires no signed-in session — the token in the URL is the credential.
 */
export default function ResetPasswordPage() {
  const [form] = Form.useForm<FormValues>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();

  const uid = (params.get("uid") || "").trim();
  const token = (params.get("token") || "").trim();
  const missingParams = !uid || !token;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onFinish(values: FormValues) {
    setError(null);
    setSubmitting(true);

    try {
      const res = await resetPasswordConfirmApi({
        uid,
        token,
        new_password: values.newPassword,
      });

      if (isApiError(res)) {
        setError(res.message || t("common.tryAgain"));
        return;
      }

      setDone(true);
    } catch (e: any) {
      setError(e?.message || t("common.tryAgain"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <Card
        style={{
          maxWidth: 480,
          width: "100%",
          borderRadius: 24,
          border: "none",
          boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}
        styles={{ body: { padding: 0 } }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
            padding: "40px 32px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.3)",
            }}
          >
            <LockOutlined style={{ fontSize: 32, color: "#fff" }} />
          </div>
          <Title level={2} style={{ color: "#fff", margin: 0, fontWeight: 700 }}>
            {t("resetPassword.title")}
          </Title>
          <Text
            style={{
              color: "rgba(255,255,255,0.85)",
              display: "block",
              marginTop: 8,
            }}
          >
            {t("resetPassword.subtitle")}
          </Text>
        </div>

        <div style={{ padding: "32px" }}>
          {missingParams ? (
            <>
              <Alert
                type="error"
                showIcon
                message={t("resetPassword.invalidLinkTitle")}
                description={t("resetPassword.missingToken")}
                style={{ marginBottom: 24, borderRadius: 12 }}
              />
              <Button
                type="primary"
                size="large"
                block
                onClick={() => navigate("/login")}
                style={{ height: 48, borderRadius: 12, fontWeight: 600 }}
              >
                {t("resetPassword.backToLogin")}
              </Button>
            </>
          ) : done ? (
            <>
              <Alert
                type="success"
                showIcon
                message={t("resetPassword.success")}
                style={{ marginBottom: 24, borderRadius: 12 }}
              />
              <Button
                type="primary"
                size="large"
                block
                onClick={() => navigate("/login", { replace: true })}
                style={{ height: 48, borderRadius: 12, fontWeight: 600 }}
              >
                {t("resetPassword.backToLogin")}
              </Button>
            </>
          ) : (
            <>
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
                  label={<Text strong>{t("resetPassword.newPassword")}</Text>}
                  name="newPassword"
                  extra={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t("resetPassword.strengthError")}
                    </Text>
                  }
                  rules={[
                    { required: true, message: t("resetPassword.newRequired") },
                    () => ({
                      validator(_, value) {
                        if (!value) return Promise.resolve();
                        if (validatePasswordStrength(value))
                          return Promise.resolve();
                        return Promise.reject(
                          new Error(t("resetPassword.strengthError")),
                        );
                      },
                    }),
                  ]}
                  hasFeedback
                >
                  <Input.Password
                    size="large"
                    prefix={
                      <SafetyCertificateOutlined style={{ color: "#bfbfbf" }} />
                    }
                    placeholder={t("resetPassword.enterNew")}
                    autoComplete="new-password"
                    style={{ borderRadius: 12 }}
                  />
                </Form.Item>

                <Form.Item
                  label={
                    <Text strong>{t("resetPassword.confirmPassword")}</Text>
                  }
                  name="confirmNewPassword"
                  dependencies={["newPassword"]}
                  hasFeedback
                  rules={[
                    {
                      required: true,
                      message: t("resetPassword.confirmRequired"),
                    },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        const np = getFieldValue("newPassword");
                        if (!value || value === np) return Promise.resolve();
                        return Promise.reject(
                          new Error(t("resetPassword.mismatch")),
                        );
                      },
                    }),
                  ]}
                >
                  <Input.Password
                    size="large"
                    prefix={
                      <SafetyCertificateOutlined style={{ color: "#bfbfbf" }} />
                    }
                    placeholder={t("resetPassword.enterConfirm")}
                    autoComplete="new-password"
                    style={{ borderRadius: 12 }}
                  />
                </Form.Item>

                <Space
                  direction="vertical"
                  size={12}
                  style={{ width: "100%", marginTop: 8 }}
                >
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={submitting}
                    style={{
                      height: 48,
                      borderRadius: 12,
                      background:
                        "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
                      border: "none",
                      fontWeight: 600,
                      boxShadow: "0 4px 12px rgba(249, 115, 22, 0.25)",
                    }}
                  >
                    {t("resetPassword.submit")}
                  </Button>

                  <Button
                    size="large"
                    block
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate("/login")}
                    disabled={submitting}
                    style={{ height: 48, borderRadius: 12, fontWeight: 500 }}
                  >
                    {t("resetPassword.backToLogin")}
                  </Button>
                </Space>
              </Form>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
