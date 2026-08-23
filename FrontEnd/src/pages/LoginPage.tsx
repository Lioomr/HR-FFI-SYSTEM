import { useState, useEffect, useCallback } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, Select } from "antd";
import { LockOutlined, ApartmentOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { UserOutlined } from "@ant-design/icons";
import { useAuthStore } from "../auth/authStore";
import { loginApi } from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";
import { getFirstApiErrorMessage } from "../utils/formErrors";
import { useI18n } from "../i18n/useI18n";
import type { AppLanguage } from "../i18n/types";

type LoginFormValues = {
  /** Email address or phone number — the backend resolves either. */
  identifier: string;
  password: string;
  remember: boolean;
};

export default function LoginPage() {
  const [form] = Form.useForm<LoginFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);

  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  const getPostLoginDestination = useCallback((role?: string) => {
    const requestedPath =
      new URLSearchParams(location.search).get("next") ||
      (location.state as { from?: unknown } | null)?.from;
    if (
      typeof requestedPath === "string" &&
      requestedPath.startsWith("/") &&
      !requestedPath.startsWith("//") &&
      !requestedPath.includes("\\")
    ) {
      return requestedPath;
    }
    if (role === "SystemAdmin") return "/admin/dashboard";
    if (role === "HRManager") return "/hr/dashboard";
    if (role === "Manager") return "/employee/dashboard";
    if (role === "CEO") return "/ceo/leave/requests";
    return "/employee/home";
  }, [location.search, location.state]);
  const { t, language, setLanguage, direction } = useI18n();

  function buildLoginError(message?: string | null) {
    const description = message?.trim() || t("auth.loginFailed");
    const normalized = description.toLowerCase();

    if (normalized.includes("too many failed login attempts") || normalized.includes("locked out")) {
      return {
        title: t("auth.loginLockedTitle"),
        description,
      };
    }

    // A short local phone number can belong to more than one account; tell the
    // user how to disambiguate rather than echoing the backend sentence.
    if (normalized.includes("more than one account")) {
      return {
        title: t("auth.loginFailedTitle"),
        description: t("auth.login.phoneAmbiguousFallback"),
      };
    }

    if (description === t("auth.backendNotConnected")) {
      return {
        title: t("auth.backendUnavailableTitle"),
        description,
      };
    }

    return {
      title: t("auth.loginFailedTitle"),
      description,
    };
  }

  useEffect(() => {
    if (isAuthenticated && user?.role) {
      navigate(getPostLoginDestination(user.role), { replace: true });
    }
  }, [isAuthenticated, user, navigate, getPostLoginDestination]);

  async function onFinish(values: LoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      // Sent verbatim: the backend normalizes phone numbers itself, and reformatting
      // here would break local-format numbers such as "0554867964".
      const res = await loginApi({ identifier: values.identifier.trim(), password: values.password });
      if (isApiError(res)) {
        setError(buildLoginError(res.message || t("auth.loginFailed")));
        return;
      }
      login(res.data.user, res.data.token);
      const role = res.data.user.role;
      navigate(getPostLoginDestination(role), { replace: true });
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "response" in e) {
        setError(buildLoginError(getFirstApiErrorMessage(e) || t("auth.loginFailed")));
      } else {
        setError(buildLoginError(t("auth.backendNotConnected")));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const languageSelect = (
    <Select
      size="small"
      value={language}
      onChange={(value) => setLanguage(value as AppLanguage)}
      options={[
        { value: "en", label: t("language.english") },
        { value: "ar", label: t("language.arabic") },
      ]}
      variant="borderless"
      style={{ minWidth: 88 }}
    />
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        direction,
        background: "#f8f9fb",
      }}
    >
      {/* ── Brand panel (desktop only) ── */}
      <div className="login-brand-panel" style={{ display: "none", flex: "0 0 40%", background: "#0d1117" }}>
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "56px 56px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "linear-gradient(135deg, #f97316, #fb923c)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 20,
                flexShrink: 0,
              }}
            >
              <ApartmentOutlined />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>FFISYS</div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", marginTop: 1 }}>
                {t("layout.hrPayroll")}
              </div>
            </div>
          </div>

          <div>
            <div style={{ width: 28, height: 3, background: "#f97316", borderRadius: 2, marginBottom: 16 }} />
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13.5, lineHeight: 1.7, maxWidth: 280 }}>
              {t("auth.internalSystemNotice")}
            </div>
          </div>

          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
            &copy; {new Date().getFullYear()} FFISYS
          </div>
        </div>
      </div>

      {/* ── Form panel ── */}
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
        <div style={{ width: "100%", maxWidth: 400 }}>
          {/* Mobile brand mark */}
          <div className="login-mobile-brand" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "linear-gradient(135deg, #f97316, #fb923c)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 18,
                flexShrink: 0,
              }}
            >
              <ApartmentOutlined />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>FFISYS</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{t("layout.hrPayroll")}</div>
            </div>
          </div>

          <Card
            style={{ borderRadius: 16 }}
            title={
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{t("auth.signIn")}</div>
                <div style={{ fontSize: 13, fontWeight: 400, color: "#64748b", marginTop: 2 }}>
                  {t("auth.signInToContinue")}
                </div>
              </div>
            }
            extra={languageSelect}
          >
            {error && (
              <Alert
                type="error"
                showIcon
                message={error.title}
                description={error.description}
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
                label={t("auth.emailOrPhone")}
                name="identifier"
                rules={[{ required: true, message: t("auth.emailOrPhoneRequired") }]}
              >
                <Input
                  size="large"
                  prefix={<UserOutlined style={{ color: "#94a3b8" }} />}
                  placeholder={t("auth.emailOrPhonePlaceholder")}
                  autoComplete="username"
                />
              </Form.Item>

              <Form.Item
                label={t("auth.password")}
                name="password"
                rules={[{ required: true, message: t("auth.passwordRequired") }]}
                style={{ marginBottom: 12 }}
              >
                <Input.Password
                  size="large"
                  prefix={<LockOutlined style={{ color: "#94a3b8" }} />}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Form.Item>

              <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 20 }}>
                <Checkbox>{t("auth.rememberMe")}</Checkbox>
              </Form.Item>

              <Button type="primary" htmlType="submit" size="large" loading={submitting} block>
                {t("auth.signIn")}
              </Button>
            </Form>
          </Card>

          <div style={{ textAlign: "center", marginTop: 20, color: "#94a3b8", fontSize: 12 }}>
            &copy; {new Date().getFullYear()} FFISYS
          </div>
        </div>
      </div>

      {/* Responsive: swap brand panel / mobile brand mark at the md breakpoint */}
      <style>{`
        @media (min-width: 900px) {
          .login-brand-panel {
            display: flex !important;
          }
          .login-mobile-brand {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
