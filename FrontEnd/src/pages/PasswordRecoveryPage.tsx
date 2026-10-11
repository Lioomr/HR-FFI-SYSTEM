import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Card, Form, Input, Select, Space } from "antd";
import { useNavigate } from "react-router-dom";
import BackButton from "../components/ui/BackButton";
import { useI18n } from "../i18n/useI18n";
import {
  requestPasswordResetOtpApi,
  verifyPasswordResetOtpApi,
  confirmPasswordResetOtpApi,
} from "../services/api/authApi";
import { isApiError } from "../services/api/apiTypes";
import { getFieldApiError } from "../utils/formErrors";
import { localizePasswordError } from "../utils/passwordErrors";
import "./PasswordRecoveryPage.css";

type RequestValues = { identifier: string };
type OtpValues = { otp: string };
type ConfirmValues = {
  new_password: string;
  confirmPassword: string;
};

export default function PasswordRecoveryPage() {
  const { t, language, direction, setLanguage } = useI18n();
  const navigate = useNavigate();
  const [otpForm] = Form.useForm<OtpValues>();
  const [confirmForm] = Form.useForm<ConfirmValues>();
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [verifiedOtp, setVerifiedOtp] = useState<string | null>(null);
  const otpBoxes = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [remaining, setRemaining] = useState(0);

  // AntD 6 OTP has no per-input attributes API; annotate its real inputs after
  // every render, including Form.resetFields remounts and language changes.
  useLayoutEffect(() => {
    otpBoxes.current?.querySelectorAll("input").forEach((input, index) => {
      input.setAttribute(
        "aria-label",
        t("passwordRecovery.otpDigit", { digit: index + 1 }),
      );
      input.setAttribute("autocomplete", "one-time-code");
    });
  });

  useEffect(() => {
    if (!identifier || verifiedOtp || submitting) return;
    otpBoxes.current?.querySelector("input")?.focus();
  }, [identifier, verifiedOtp, submitting]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [remaining]);

  async function requestCode(values: RequestValues) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestPasswordResetOtpApi({
        identifier: values.identifier.trim(),
      });
      if (isApiError(result)) {
        setError(t("passwordRecovery.requestError"));
        return;
      }
      setIdentifier(values.identifier.trim());
      setMaskedPhone(null);
      setVerifiedOtp(null);
      otpForm.resetFields();
      confirmForm.resetFields();
      setRemaining(60);
    } catch {
      setError(t("passwordRecovery.requestError"));
    } finally {
      setSubmitting(false);
    }
  }

  function showConfirmationError(failure: unknown) {
    const passwordError = localizePasswordError(
      getFieldApiError(failure, "new_password"),
      t,
    );
    if (passwordError) {
      setError(passwordError);
      confirmForm.setFields([
        { name: "new_password", errors: [passwordError] },
      ]);
    } else {
      backToCodeStep();
    }
  }

  async function verifyCode(values: OtpValues) {
    if (!identifier) return;
    setError(null);
    setSubmitting(true);
    const otp = values.otp.trim();
    try {
      const result = await verifyPasswordResetOtpApi({ identifier, otp });
      if (isApiError(result)) {
        otpForm.resetFields();
        setError(t("passwordRecovery.invalidCode"));
        return;
      }
      setVerifiedOtp(otp);
      setMaskedPhone(result.data?.masked_phone ?? null);
    } catch (failure: unknown) {
      const status = (failure as { response?: { status?: number } })?.response
        ?.status;
      if (status === 400 || status === 422) {
        otpForm.resetFields();
        setError(t("passwordRecovery.invalidCode"));
      } else setError(t("passwordRecovery.confirmError"));
    } finally {
      setSubmitting(false);
    }
  }

  function backToCodeStep() {
    setVerifiedOtp(null);
    setMaskedPhone(null);
    otpForm.resetFields();
    confirmForm.resetFields();
    setError(t("passwordRecovery.invalidCode"));
  }

  async function confirmCode(values: ConfirmValues) {
    if (!identifier || !verifiedOtp) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await confirmPasswordResetOtpApi({
        identifier,
        otp: verifiedOtp,
        new_password: values.new_password,
      });
      if (isApiError(result)) {
        showConfirmationError(result);
        return;
      }
      confirmForm.resetFields();
      otpForm.resetFields();
      setVerifiedOtp(null);
      setMaskedPhone(null);
      setDone(true);
    } catch (failure: unknown) {
      const status = (failure as { response?: { status?: number } })?.response
        ?.status;
      if (status === 400 || status === 422) showConfirmationError(failure);
      else setError(t("passwordRecovery.confirmError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 16,
        direction,
      }}
    >
      <Card style={{ width: "100%", maxWidth: 480, borderRadius: 16 }}>
        <h1 style={{ marginTop: 0 }}>{t("passwordRecovery.title")}</h1>
        <Form layout="vertical">
          <Form.Item label={t("language.label")}>
            <Select
              aria-label={t("language.label")}
              size="large"
              value={language}
              onChange={setLanguage}
              options={[
                { value: "en", label: t("language.english") },
                { value: "ar", label: t("language.arabic") },
              ]}
            />
          </Form.Item>
        </Form>
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            style={{ marginBottom: 16 }}
          />
        )}
        {done ? (
          <Alert type="success" showIcon title={t("resetPassword.success")} />
        ) : identifier ? (
          <>
            <Alert
              type={verifiedOtp ? "success" : "info"}
              showIcon
              title={
                verifiedOtp
                  ? t("passwordRecovery.verified")
                  : t("passwordRecovery.guidance")
              }
              description={
                verifiedOtp && maskedPhone
                  ? t("passwordRecovery.sentTo", { phone: maskedPhone })
                  : undefined
              }
              style={{ marginBottom: 16 }}
            />
            {!verifiedOtp && (
              <div ref={otpBoxes}>
                <Form<OtpValues>
                  key="otp"
                  form={otpForm}
                  layout="vertical"
                  requiredMark={false}
                  onFinish={verifyCode}
                  onValuesChange={(changed) => {
                    if (/^\d{6}$/.test(changed.otp ?? "") && !submitting)
                      window.setTimeout(() => otpForm.submit(), 0);
                  }}
                  disabled={submitting}
                >
                  <Form.Item
                    className="recovery-otp-field"
                    name="otp"
                    label={t("passwordRecovery.otp")}
                    rules={[
                      {
                        required: true,
                        message: t("passwordRecovery.otpRequired"),
                      },
                      {
                        pattern: /^\d{6}$/,
                        message: t("passwordRecovery.otpRequired"),
                      },
                    ]}
                  >
                    <Input.OTP
                      className="recovery-otp"
                      length={6}
                      size="large"
                      autoFocus
                      inputMode="numeric"
                      formatter={(value) => value.replace(/\D/g, "")}
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    size="large"
                    block
                    htmlType="submit"
                    loading={submitting}
                  >
                    {t("passwordRecovery.verify")}
                  </Button>
                </Form>
              </div>
            )}
            {verifiedOtp && (
              <Form<ConfirmValues>
                key="confirmation"
                form={confirmForm}
                layout="vertical"
                requiredMark={false}
                onFinish={confirmCode}
                disabled={submitting}
              >
                <Form.Item
                  name="new_password"
                  label={t("resetPassword.newPassword")}
                  rules={[
                    { required: true, message: t("resetPassword.newRequired") },
                  ]}
                >
                  <Input.Password size="large" autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                  name="confirmPassword"
                  label={t("resetPassword.confirmPassword")}
                  dependencies={["new_password"]}
                  rules={[
                    {
                      required: true,
                      message: t("resetPassword.confirmRequired"),
                    },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        return !value || value === getFieldValue("new_password")
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error(t("resetPassword.mismatch")),
                            );
                      },
                    }),
                  ]}
                >
                  <Input.Password size="large" autoComplete="new-password" />
                </Form.Item>
                <Button
                  type="primary"
                  size="large"
                  block
                  htmlType="submit"
                  loading={submitting}
                >
                  {t("resetPassword.submit")}
                </Button>
              </Form>
            )}
            <Space
              orientation="vertical"
              style={{ width: "100%", marginTop: 12 }}
            >
              <Button
                size="large"
                block
                disabled={submitting || remaining > 0}
                onClick={() => requestCode({ identifier })}
              >
                {remaining > 0
                  ? t("passwordRecovery.cooldown", { seconds: remaining })
                  : t("passwordRecovery.resend")}
              </Button>
              <Button
                size="large"
                block
                disabled={submitting}
                onClick={() => {
                  setIdentifier(null);
                  setMaskedPhone(null);
                  setVerifiedOtp(null);
                  setError(null);
                  otpForm.resetFields();
                  confirmForm.resetFields();
                }}
              >
                {t("passwordRecovery.changeIdentifier")}
              </Button>
            </Space>
          </>
        ) : (
          <>
            <p>{t("passwordRecovery.subtitle")}</p>
            <Form<RequestValues>
              key="request"
              layout="vertical"
              requiredMark={false}
              onFinish={requestCode}
              disabled={submitting}
            >
              <Form.Item
                name="identifier"
                label={t("auth.emailOrPhone")}
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: t("auth.emailOrPhoneRequired"),
                  },
                ]}
              >
                <Input
                  size="large"
                  autoComplete="username"
                  placeholder={t("auth.emailOrPhonePlaceholder")}
                />
              </Form.Item>
              <Button
                type="primary"
                size="large"
                block
                htmlType="submit"
                loading={submitting}
              >
                {t("passwordRecovery.request")}
              </Button>
            </Form>
          </>
        )}
        {!done && <p>{t("passwordRecovery.hrFallback")}</p>}
        <BackButton
          size="large"
          block
          disabled={submitting}
          onClick={() => navigate("/login", { replace: done })}
          style={{ marginTop: 16 }}
        >
          {t("resetPassword.backToLogin")}
        </BackButton>
      </Card>
    </main>
  );
}
