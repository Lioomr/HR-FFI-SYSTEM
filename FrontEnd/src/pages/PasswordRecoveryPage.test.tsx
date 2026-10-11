import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useI18nStore } from "../i18n/i18nStore";
import { translations } from "../i18n/translations";
import {
  requestPasswordResetOtpApi,
  verifyPasswordResetOtpApi,
  confirmPasswordResetOtpApi,
} from "../services/api/authApi";
import PasswordRecoveryPage from "./PasswordRecoveryPage";
import LoginPage from "./LoginPage";

vi.mock("../services/api/authApi", () => ({
  requestPasswordResetOtpApi: vi.fn(),
  verifyPasswordResetOtpApi: vi.fn(),
  confirmPasswordResetOtpApi: vi.fn(),
  loginApi: vi.fn(),
}));
const request = vi.mocked(requestPasswordResetOtpApi);
const verify = vi.mocked(verifyPasswordResetOtpApi);
const confirm = vi.mocked(confirmPasswordResetOtpApi);
const success = { status: "success" as const, data: {}, message: "OK" };

function showPage(language: "en" | "ar" = "en") {
  useI18nStore.setState({
    language,
    direction: language === "ar" ? "rtl" : "ltr",
  });
  render(
    <MemoryRouter>
      <PasswordRecoveryPage />
    </MemoryRouter>,
  );
  return (key: string) => translations[language][key];
}
function otpLabel(index = 1) {
  const language = useI18nStore.getState().language;
  return translations[language]["passwordRecovery.otpDigit"].replace(
    "{digit}",
    String(index),
  );
}
function typeOtp(code: string) {
  [...code].forEach((digit, index) => {
    fireEvent.input(screen.getByLabelText(otpLabel(index + 1)), {
      target: { value: digit },
    });
  });
}
async function requestCode(t: (key: string) => string) {
  fireEvent.change(screen.getByLabelText(t("auth.emailOrPhone")), {
    target: { value: " employee@ffi.test " },
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("passwordRecovery.request") }),
  );
  await screen.findByLabelText(otpLabel());
}
async function verifyCode(t: (key: string) => string) {
  typeOtp("123456");
  await screen.findByLabelText(t("resetPassword.newPassword"));
}
function enterConfirmation(
  t: (key: string) => string,
  password = "NewPassword123!",
) {
  fireEvent.change(screen.getByLabelText(t("resetPassword.newPassword")), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(t("resetPassword.confirmPassword")), {
    target: { value: password },
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("resetPassword.submit") }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  request.mockResolvedValue({ ...success, data: { message: "OK" } });
  verify.mockResolvedValue(success);
  confirm.mockResolvedValue(success);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useI18nStore.setState({ language: "en", direction: "ltr" });
});

describe("WhatsApp password recovery", () => {
  it.each(["en", "ar"] as const)(
    "labels digits, permits autofill and preserves keyboard focus in %s",
    async (language) => {
      const t = showPage(language);
      await requestCode(t);
      const first = screen.getByLabelText(otpLabel());
      expect(first).toHaveFocus();
      for (let digit = 1; digit <= 6; digit += 1) {
        expect(screen.getByLabelText(otpLabel(digit))).toHaveAttribute(
          "autocomplete",
          "one-time-code",
        );
      }
      fireEvent.input(first, { target: { value: "a" } });
      expect(first).toHaveValue("");
      expect(verify).not.toHaveBeenCalled();
      fireEvent.input(first, { target: { value: "1" } });
      const second = screen.getByLabelText(otpLabel(2));
      expect(second).toHaveFocus();
      fireEvent.keyDown(second, { key: "Backspace" });
      expect(first).toHaveFocus();
      fireEvent.keyDown(first, { key: "ArrowRight" });
      expect(second).toHaveFocus();
      fireEvent.keyDown(second, { key: "ArrowLeft" });
      expect(first).toHaveFocus();
      // Browsers deliver pasted/autofilled text through the input event.
      fireEvent.input(first, { target: { value: "123456" } });
      await screen.findByLabelText(t("resetPassword.newPassword"));
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledWith({
        identifier: "employee@ffi.test",
        otp: "123456",
      });
    },
  );

  it.each(["en", "ar"] as const)(
    "localizes same-password rejection and permits another password in %s",
    async (language) => {
      confirm.mockRejectedValueOnce({
        response: {
          status: 422,
          data: {
            status: "error",
            errors: [
              {
                field: "new_password",
                message:
                  "New password must be different from your current password.",
              },
            ],
          },
        },
      });
      const t = showPage(language);
      await requestCode(t);
      await verifyCode(t);
      enterConfirmation(t);
      await waitFor(() =>
        expect(
          screen.getAllByText(t("changePassword.samePassword")).length,
        ).toBeGreaterThan(0),
      );
      enterConfirmation(t, "AnotherPassword123!");
      await screen.findByText(t("resetPassword.success"));
    },
  );

  it("clears the verified OTP and destination when changing identifier", async () => {
    verify.mockResolvedValue({
      ...success,
      data: { masked_phone: "+966•••••567" },
    });
    const t = showPage();
    await requestCode(t);
    await verifyCode(t);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("passwordRecovery.changeIdentifier"),
      }),
    );
    await requestCode(t);
    expect(screen.getByLabelText(otpLabel())).toHaveValue("");
    expect(screen.queryByText(/\+966•••••567/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(t("resetPassword.newPassword")),
    ).not.toBeInTheDocument();
  });
  it.each(["en", "ar"] as const)(
    "requests and resets in %s",
    async (language) => {
      const t = showPage(language);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("main")).toHaveStyle({
        direction: language === "ar" ? "rtl" : "ltr",
      });
      await requestCode(t);
      expect(request).toHaveBeenCalledWith({ identifier: "employee@ffi.test" });
      expect(screen.getByText(t("passwordRecovery.guidance"))).toBeVisible();
      expect(screen.getByText(t("passwordRecovery.hrFallback"))).toBeVisible();
      expect(screen.getByRole("button", { name: /60/ })).toBeDisabled();
      expect(
        screen.queryByLabelText(t("resetPassword.newPassword")),
      ).not.toBeInTheDocument();
      await verifyCode(t);
      expect(verify).toHaveBeenCalledWith({
        identifier: "employee@ffi.test",
        otp: "123456",
      });
      expect(screen.queryByLabelText(otpLabel())).not.toBeInTheDocument();
      enterConfirmation(t);
      await screen.findByText(t("resetPassword.success"));
      expect(confirm).toHaveBeenCalledWith({
        identifier: "employee@ffi.test",
        otp: "123456",
        new_password: "NewPassword123!",
      });
      expect(screen.queryByLabelText(otpLabel())).not.toBeInTheDocument();
    },
  );

  it("keeps invalid OTP feedback generic and allows retry", async () => {
    verify.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { status: "error", message: "Internal account detail" },
      },
    });
    const t = showPage();
    await requestCode(t);
    typeOtp("123456");
    await screen.findByText(t("passwordRecovery.invalidCode"));
    expect(
      screen.queryByText("Internal account detail"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(t("resetPassword.newPassword")),
    ).not.toBeInTheDocument();
    await verifyCode(t);
    enterConfirmation(t);
    await screen.findByText(t("resetPassword.success"));
  });

  it("shows actionable backend password policy errors", async () => {
    confirm.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          errors: { new_password: ["This password is too common."] },
        },
      },
    });
    const t = showPage();
    await requestCode(t);
    await verifyCode(t);
    enterConfirmation(t);
    await screen.findByText("This password is too common.");
    expect(
      screen.queryByText(t("resetPassword.success")),
    ).not.toBeInTheDocument();
  });

  it.each(["en", "ar"] as const)(
    "shows destination only after successful verification in %s",
    async (language) => {
      verify.mockResolvedValue({
        ...success,
        data: { masked_phone: "+966•••••567" },
      });
      const t = showPage(language);
      await requestCode(t);
      expect(screen.queryByText(/\+966•••••567/)).not.toBeInTheDocument();
      await verifyCode(t);
      expect(screen.getByText(/\+966•••••567/)).toBeVisible();
    },
  );

  it("verifies automatically after the sixth digit and clears wrong codes", async () => {
    verify.mockRejectedValueOnce({ response: { status: 422 } });
    const t = showPage();
    await requestCode(t);
    typeOtp("123456");
    await screen.findByText(t("passwordRecovery.invalidCode"));
    expect(verify).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByLabelText(otpLabel())).toHaveValue(""),
    );
    typeOtp("123456");
    await screen.findByLabelText(t("resetPassword.newPassword"));
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("does not reveal request failure details", async () => {
    request.mockRejectedValue(new Error("provider secret"));
    const t = showPage();
    fireEvent.change(screen.getByLabelText(t("auth.emailOrPhone")), {
      target: { value: "missing@ffi.test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("passwordRecovery.request") }),
    );
    await screen.findByText(t("passwordRecovery.requestError"));
    expect(screen.queryByText("provider secret")).not.toBeInTheDocument();
  });

  it("validates OTP shape and matching passwords before submission", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = showPage();
    await requestCode(t);
    typeOtp("123");
    fireEvent.click(
      screen.getByRole("button", { name: t("passwordRecovery.verify") }),
    );
    await screen.findByText(t("passwordRecovery.otpRequired"));
    expect(verify).not.toHaveBeenCalled();
    await verifyCode(t);
    fireEvent.change(screen.getByLabelText(t("resetPassword.newPassword")), {
      target: { value: "NewPassword123!" },
    });
    fireEvent.change(
      screen.getByLabelText(t("resetPassword.confirmPassword")),
      { target: { value: "Different123!" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("resetPassword.submit") }),
    );
    await screen.findByText(t("resetPassword.mismatch"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("enforces the resend wait and clears stale confirmation fields", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = showPage();
    await requestCode(t);
    await verifyCode(t);
    for (let second = 0; second < 60; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    vi.useRealTimers();
    const resend = screen.getByRole("button", {
      name: t("passwordRecovery.resend"),
    });
    expect(resend).toBeEnabled();
    fireEvent.click(resend);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByLabelText(otpLabel())).toHaveValue(""),
    );
    expect(
      screen.queryByLabelText(t("resetPassword.newPassword")),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /60/ })).toBeDisabled();
  });

  it("links the public recovery page from login", async () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<PasswordRecoveryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("link", {
        name: translations.en["passwordRecovery.forgot"],
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: translations.en["passwordRecovery.title"],
        }),
      ).toBeVisible(),
    );
  });
});
