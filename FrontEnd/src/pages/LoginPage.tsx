import { useState, useEffect } from "react";
import { Alert, Button, Checkbox, Form, Input, Select } from "antd";
import { LockOutlined, MailOutlined, ApartmentOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { loginApi } from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";
import { useI18n } from "../i18n/useI18n";
import type { AppLanguage } from "../i18n/types";

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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { t, language, setLanguage, direction } = useI18n();

  useEffect(() => {
    if (isAuthenticated && user?.role) {
      if (user.role === "SystemAdmin") navigate("/admin/dashboard", { replace: true });
      else if (user.role === "HRManager") navigate("/hr/dashboard", { replace: true });
      else if (user.role === "Manager") navigate("/employee/dashboard", { replace: true });
      else if (user.role === "CEO") navigate("/ceo/leave/requests", { replace: true });
      else navigate("/employee/home", { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  async function onFinish(values: LoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await loginApi({ email: values.email, password: values.password });
      if (isApiError(res)) {
        setError(res.message || t("auth.loginFailed"));
        return;
      }
      login(res.data.user, res.data.token);
      const role = res.data.user.role;
      if (role === "SystemAdmin") navigate("/admin/dashboard", { replace: true });
      else if (role === "HRManager") navigate("/hr/dashboard", { replace: true });
      else if (role === "Manager") navigate("/employee/dashboard", { replace: true });
      else if (role === "CEO") navigate("/ceo/leave/requests", { replace: true });
      else navigate("/employee/home", { replace: true });
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "response" in e) {
        setError(t("auth.loginFailed"));
      } else {
        setError(t("auth.backendNotConnected"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        direction,
        background: "#f8faff",
      }}
    >
      {/* ── Left Panel: Brand (hidden on mobile) ── */}
      <div
        style={{
          display: "none",
          flex: "0 0 45%",
          background: "linear-gradient(145deg, #1a1a1a 0%, #2a2a2a 40%, #1f1f1f 70%, #333333 100%)",
          padding: "60px 48px",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        }}
        className="login-left-panel"
      >
        {/* Background decorative circles */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          {[
            { w: 400, h: 400, top: -100, right: -100, op: 0.06 },
            { w: 300, h: 300, bottom: -80, left: -80, op: 0.05 },
            { w: 200, h: 200, top: "40%", left: "60%", op: 0.04 },
          ].map((c, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: c.w,
                height: c.h,
                top: c.top,
                bottom: c.bottom,
                left: c.left,
                right: c.right,
                borderRadius: "50%",
                background: "rgba(251,146,60," + c.op + ")",
                border: "1px solid rgba(251,146,60,0.1)",
              }}
            />
          ))}
        </div>

        {/* Logo */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 60 }}>
            <div
              style={{
                width: 46,
                height: 46,
                background: "linear-gradient(135deg, #f97316, #fb923c)",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 22,
                boxShadow: "0 8px 24px rgba(249,115,22,0.5)",
              }}
            >
              <ApartmentOutlined />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "white", letterSpacing: "-0.02em", fontFamily: "'Outfit', 'Inter', sans-serif" }}>
                FFISYS
              </div>
              <div style={{ fontSize: 12, color: "rgba(165,180,252,0.7)", marginTop: 1 }}>
                HR & Payroll Platform
              </div>
            </div>
          </div>

          {/* Headline */}
          <div style={{ color: "white", fontSize: 36, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.03em", marginBottom: 20 }}>
            Manage your workforce smarter
          </div>
          <div style={{ color: "rgba(251,146,60,0.75)", fontSize: 16, lineHeight: 1.7, maxWidth: 340 }}>
            A unified platform for HR operations, payroll, leave management, and employee self-service.
          </div>
        </div>

        {/* Feature pills */}
        <div style={{ position: "relative", zIndex: 1 }}>
          {[
            "⚡ Real-time Payroll Processing",
            "📅 Smart Leave Management",
            "🔐 Role-based Access Control",
            "🌐 Arabic & English Support",
          ].map((feat, i) => (
            <div
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "10px 16px",
                marginRight: 8,
                marginBottom: 8,
                color: "rgba(255,255,255,0.7)",
                fontSize: 13,
                backdropFilter: "blur(4px)",
              }}
            >
              {feat}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right Panel: Login Form ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "40px 24px",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            animation: "fadeInUp 0.5s ease both",
          }}
        >
          {/* Mobile logo */}
          <div style={{ marginBottom: 40, textAlign: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                background: "linear-gradient(135deg, #f97316, #fb923c)",
                borderRadius: 16,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 26,
                boxShadow: "0 8px 24px rgba(249,115,22,0.35)",
                marginBottom: 16,
              }}
            >
              <ApartmentOutlined />
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 6, fontFamily: "'Outfit', 'Inter', sans-serif" }}>
              Welcome back
            </div>
            <div style={{ color: "#64748b", fontSize: 15 }}>
              {t("auth.signInToContinue")}
            </div>
          </div>

          {/* Language toggle */}
          <div style={{ display: "flex", justifyContent: direction === "rtl" ? "flex-start" : "flex-end", marginBottom: 20 }}>
            <Select
              size="small"
              value={language}
              onChange={(value) => setLanguage(value as AppLanguage)}
              options={[
                { value: "en", label: t("language.english") },
                { value: "ar", label: t("language.arabic") },
              ]}
              variant="outlined"
              style={{ minWidth: 120, borderRadius: 8 }}
            />
          </div>

          {/* Form card */}
          <div
            className="glass"
            style={{
              borderRadius: 20,
              padding: 32,
              boxShadow: "0 12px 40px rgba(0,0,0,0.08)",
            }}
          >
            {error && (
              <Alert
                type="error"
                showIcon
                message={error}
                style={{ marginBottom: 20, borderRadius: 10 }}
              />
            )}

            <Form<LoginFormValues>
              form={form}
              layout="vertical"
              onFinish={onFinish}
              initialValues={{ remember: true }}
              requiredMark={false}
            >
              <Form.Item
                label={<span style={{ fontWeight: 600, color: "#374151" }}>{t("auth.email")}</span>}
                name="email"
                rules={[
                  { required: true, message: t("auth.emailRequired") },
                  { type: "email", message: t("auth.emailInvalid") },
                ]}
                style={{ marginBottom: 16 }}
              >
                <Input
                  size="large"
                  prefix={<MailOutlined style={{ color: "#94a3b8" }} />}
                  placeholder="name@company.com"
                  autoComplete="email"
                  style={{ borderRadius: 10 }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ fontWeight: 600, color: "#374151" }}>{t("auth.password")}</span>}
                name="password"
                rules={[{ required: true, message: t("auth.passwordRequired") }]}
                style={{ marginBottom: 12 }}
              >
                <Input.Password
                  size="large"
                  prefix={<LockOutlined style={{ color: "#94a3b8" }} />}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ borderRadius: 10 }}
                />
              </Form.Item>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <Form.Item name="remember" valuePropName="checked" style={{ margin: 0 }}>
                  <Checkbox style={{ color: "#64748b", fontSize: 13 }}>{t("auth.rememberMe")}</Checkbox>
                </Form.Item>
              </div>

              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={submitting}
                block
                style={{
                  height: 48,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #f97316, #ea580c)",
                  border: "none",
                  boxShadow: "0 6px 20px rgba(249,115,22,0.4)",
                  letterSpacing: "0.01em",
                }}
              >
                {t("auth.signIn")}
              </Button>
            </Form>
          </div>

          <div style={{ textAlign: "center", marginTop: 24, color: "#94a3b8", fontSize: 12 }}>
            &copy; {new Date().getFullYear()} FFISYS · All rights reserved
          </div>
        </div>
      </div>

      {/* Responsive style for left panel */}
      <style>{`
        @media (min-width: 768px) {
          .login-left-panel {
            display: flex !important;
          }
        }
      `}</style>
    </div>
  );
}
