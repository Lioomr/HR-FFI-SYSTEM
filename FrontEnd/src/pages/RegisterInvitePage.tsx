import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { isApiError } from "../services/api/apiTypes";
import { acceptInvite, validateInviteToken } from "../services/api/invitesApi";
import { useI18n } from "../i18n/useI18n";

type InviteMeta = {
  email: string;
  role: string;
  expires_at: string;
};

export default function RegisterInvitePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = (params.get("token") || "").trim();
  const [form] = Form.useForm();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteMeta | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setError(t("auth.invite.missingToken"));
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await validateInviteToken(token);
        if (isApiError(res)) {
          const first = Array.isArray(res.errors) && res.errors.length > 0 ? String((res.errors[0] as any).message || "") : "";
          setError(first || res.message || t("auth.invite.invalidLink"));
          setLoading(false);
          return;
        }
        setInvite(res.data as InviteMeta);
        setLoading(false);
      } catch (e: any) {
        setError(e?.message || t("auth.invite.invalidOrExpired"));
        setLoading(false);
      }
    };
    run();
  }, [token, t]);

  const expiresOn = useMemo(() => {
    if (!invite?.expires_at) return "-";
    return invite.expires_at.slice(0, 10);
  }, [invite]);

  const onSubmit = async () => {
    setError(null);
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const res = await acceptInvite({
        token,
        full_name: values.full_name,
        password: values.password,
      });
      if (isApiError(res)) {
        const first = Array.isArray(res.errors) && res.errors.length > 0 ? String((res.errors[0] as any).message || "") : "";
        setError(first || res.message || t("auth.invite.failedRegistration"));
        setSubmitting(false);
        return;
      }
      navigate("/login", { replace: true });
    } catch (e: any) {
      setSubmitting(false);
      if (e?.errorFields) return;
      const data = e?.apiData || e?.response?.data;
      if (data?.errors && Array.isArray(data.errors) && data.errors.length) {
        setError(data.errors.map((x: any) => x.message || String(x)).join(" "));
      } else {
        setError(e?.message || t("auth.invite.failedRegistration"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <Card style={{ width: "100%", maxWidth: 520, borderRadius: 16 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {t("auth.invite.title")}
        </Typography.Title>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        {loading ? (
          <Typography.Text type="secondary">{t("auth.invite.validating")}</Typography.Text>
        ) : invite ? (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t("auth.invite.invitedAs").replace("{role}", invite.role)}
              description={`${t("auth.invite.email")}: ${invite.email} | ${t("auth.invite.expires")}: ${expiresOn}`}
            />

            <Form form={form} layout="vertical" requiredMark={false} onFinish={onSubmit}>
              <Form.Item
                label={t("profile.fullName")}
                name="full_name"
                rules={[{ required: true, message: t("common.required") }]}
              >
                <Input size="large" placeholder={t("auth.invite.fullNameDesc")} />
              </Form.Item>
              <Form.Item
                label={t("auth.password")}
                name="password"
                rules={[{ required: true, message: t("common.required") }]}
              >
                <Input.Password size="large" placeholder={t("auth.invite.passwordDesc")} />
              </Form.Item>
              <Form.Item
                label={t("auth.invite.confirmPassword")}
                name="confirm_password"
                dependencies={["password"]}
                rules={[
                  { required: true, message: t("auth.invite.confirmPasswordReq") },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) return Promise.resolve();
                      return Promise.reject(new Error(t("auth.invite.passwordMismatch")));
                    },
                  }),
                ]}
              >
                <Input.Password size="large" placeholder={t("auth.invite.confirmPasswordDesc")} />
              </Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={submitting}>
                  {t("auth.invite.complete")}
                </Button>
                <Button onClick={() => navigate("/login")}>{t("auth.invite.backToLogin")}</Button>
              </Space>
            </Form>
          </>
        ) : null}
      </Card>
    </div>
  );
}
