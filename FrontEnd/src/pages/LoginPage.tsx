import { useState } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, Select } from "antd";
import {
  BarChartOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { UserOutlined } from "@ant-design/icons";
import { useAuthStore } from "../auth/authStore";
import { loginApi } from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";
import { getFirstApiErrorMessage } from "../utils/formErrors";
import { useI18n } from "../i18n/useI18n";
import type { AppLanguage } from "../i18n/types";
import { getPostLoginDestination } from "../routes/homeRoute";

type LoginFormValues = {
  /** Email address or phone number — the backend resolves either. */
  identifier: string;
  password: string;
  remember: boolean;
};

const FEATURES = [
  { icon: <BarChartOutlined />, key: "reports" },
  { icon: <TeamOutlined />, key: "employees" },
  { icon: <SettingOutlined />, key: "procedures" },
  { icon: <SafetyCertificateOutlined />, key: "secure" },
] as const;

/** Same `flag-icons` flags as the employee pages (CSS is loaded in main.tsx). */
const FLAG_CODE = { en: "gb", ar: "sa" } as const;

function LanguageOption({ flag, text }: { flag: "en" | "ar"; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span
        className={`fi fi-${FLAG_CODE[flag]}`}
        aria-hidden="true"
        style={{
          width: 24,
          height: 18,
          borderRadius: 3,
          display: "inline-flex",
          backgroundSize: "cover",
          backgroundPosition: "center",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
        }}
      />
      {text}
    </span>
  );
}

export default function LoginPage() {
  const [form] = Form.useForm<LoginFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();

  const requestedPath =
    new URLSearchParams(location.search).get("next") ||
    (location.state as { from?: unknown } | null)?.from;
  const { t, language, setLanguage, direction } = useI18n();

  function buildLoginError(message?: string | null) {
    const description = message?.trim() || t("auth.loginFailed");
    const normalized = description.toLowerCase();

    if (
      normalized.includes("too many failed login attempts") ||
      normalized.includes("locked out")
    ) {
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

  async function onFinish(values: LoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      // Sent verbatim: the backend normalizes phone numbers itself, and reformatting
      // here would break local-format numbers such as "0554867964".
      const res = await loginApi({
        identifier: values.identifier.trim(),
        password: values.password,
      });
      if (isApiError(res)) {
        setError(buildLoginError(res.message || t("auth.loginFailed")));
        return;
      }
      login(res.data.user, res.data.access || res.data.token, res.data.refresh);
      const role = res.data.user.role;
      navigate(
        getPostLoginDestination(
          role,
          typeof requestedPath === "string" ? requestedPath : null,
        ),
        { replace: true },
      );
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "response" in e) {
        setError(
          buildLoginError(getFirstApiErrorMessage(e) || t("auth.loginFailed")),
        );
      } else {
        setError(buildLoginError(t("auth.backendNotConnected")));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="login-root"
      style={{
        minHeight: "100vh",
        display: "flex",
        direction,
        background: "#f8f9fb",
      }}
    >
      {/* ── Brand panel (desktop only) ── */}
      <div
        className="login-brand-panel"
        style={{
          display: "none",
          flex: "0 0 55%",
          // Light overlay keeps the white text readable on the bright photo.
          background:
            "linear-gradient(rgba(13,17,23,0.2), rgba(13,17,23,0.5)), url(/login-bg.jpg) 68% center / cover no-repeat",
        }}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 40,
            padding: 40,
          }}
        >
          <div
            style={{
              textAlign: "center",
              textShadow: "0 2px 12px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                color: "#fff",
                fontSize: 36,
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              {t("auth.login.tagline")}
            </div>
            <div
              style={{
                width: 88,
                height: 4,
                background: "#f97316",
                borderRadius: 2,
                margin: "20px auto 0",
              }}
            />
          </div>

          <div className="login-feature-grid">
            {FEATURES.map((f) => (
              <div key={f.key} className="login-feature-card">
                <div style={{ color: "#f97316", fontSize: 34 }}>{f.icon}</div>
                <div style={{ color: "#fff", fontWeight: 600, marginTop: 12 }}>
                  {t(`auth.login.feature.${f.key}.title`)}
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.55)",
                    fontSize: 12.5,
                    marginTop: 4,
                  }}
                >
                  {t(`auth.login.feature.${f.key}.subtitle`)}
                </div>
              </div>
            ))}
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
          <img
            src="/ffi-logo-full.png"
            alt="FFI - Fathi Fouad Itani Contracting Co."
            style={{
              display: "block",
              width: "100%",
              maxWidth: 300,
              height: "auto",
              margin: "0 auto 36px",
            }}
          />

          <Card style={{ borderRadius: 16 }}>
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
              <Form.Item label={t("language.label")}>
                <Select
                  size="large"
                  value={language}
                  onChange={(value) => setLanguage(value as AppLanguage)}
                  options={[
                    {
                      value: "en",
                      label: (
                        <LanguageOption
                          flag="en"
                          text={t("language.english")}
                        />
                      ),
                    },
                    {
                      value: "ar",
                      label: (
                        <LanguageOption flag="ar" text={t("language.arabic")} />
                      ),
                    },
                  ]}
                />
              </Form.Item>

              <Form.Item
                label={t("auth.emailOrPhone")}
                name="identifier"
                rules={[
                  { required: true, message: t("auth.emailOrPhoneRequired") },
                ]}
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
                rules={[
                  { required: true, message: t("auth.passwordRequired") },
                ]}
                style={{ marginBottom: 12 }}
              >
                <Input.Password
                  size="large"
                  prefix={<LockOutlined style={{ color: "#94a3b8" }} />}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Form.Item>

              <Form.Item
                name="remember"
                valuePropName="checked"
                style={{ marginBottom: 20 }}
              >
                <Checkbox>{t("auth.rememberMe")}</Checkbox>
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={submitting}
                block
              >
                {t("auth.signIn")}
              </Button>
            </Form>
          </Card>

          <div
            style={{
              textAlign: "center",
              marginTop: 20,
              color: "#94a3b8",
              fontSize: 12,
            }}
          >
            &copy; {new Date().getFullYear()} FFISYS
          </div>
        </div>
      </div>

      {/* Responsive: the brand panel is desktop-only */}
      <style>{`
        .login-feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 16px;
        }
        .login-feature-card {
          text-align: center;
          padding: 24px 12px;
          border-radius: 14px;
          background: rgba(13,17,23,0.45);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.18);
        }
        @media (min-width: 900px) {
          .login-root {
            height: 100vh;
            overflow: hidden;
          }
          .login-brand-panel {
            display: flex !important;
          }
        }
      `}</style>
    </div>
  );
}
