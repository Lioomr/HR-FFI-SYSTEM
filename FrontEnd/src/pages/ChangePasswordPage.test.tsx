import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useI18nStore } from "../i18n/i18nStore";
import { translations } from "../i18n/translations";
import { changePasswordApi } from "../services/api/authApi";
import ChangePasswordPage from "./ChangePasswordPage";

vi.mock("../services/api/authApi", () => ({ changePasswordApi: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useI18nStore.setState({ language: "en", direction: "ltr" });
});

describe("change password server validation", () => {
  it.each(["en", "ar"] as const)(
    "localizes same-password errors in %s",
    async (language) => {
      useI18nStore.setState({
        language,
        direction: language === "ar" ? "rtl" : "ltr",
      });
      vi.mocked(changePasswordApi).mockRejectedValue({
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
      render(
        <MemoryRouter>
          <ChangePasswordPage />
        </MemoryRouter>,
      );
      for (const key of [
        "changePassword.currentPassword",
        "changePassword.newPassword",
        "changePassword.confirmPassword",
      ]) {
        fireEvent.change(screen.getByLabelText(translations[language][key]), {
          target: { value: "SamePassword123!" },
        });
      }
      fireEvent.click(
        screen.getByRole("button", {
          name: translations[language]["common.save"],
        }),
      );
      expect(
        await screen.findByText(
          translations[language]["changePassword.samePassword"],
        ),
      ).toBeVisible();
      expect(changePasswordApi).toHaveBeenCalledWith({
        current_password: "SamePassword123!",
        new_password: "SamePassword123!",
      });
    },
  );
});
