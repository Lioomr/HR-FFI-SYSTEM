import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../services/api/authApi", () => ({
  loginApi: vi.fn(),
  logoutApi: vi.fn(),
  changePasswordApi: vi.fn(),
}));

import LoginPage from "./LoginPage";
import * as authApi from "../services/api/authApi";
import { useI18nStore } from "../i18n/i18nStore";
import { useAuthStore } from "../auth/authStore";

const loginApi = authApi.loginApi as unknown as ReturnType<typeof vi.fn>;

const PASSWORD = "Str0ng!Passw0rd";

const loginSuccess = {
  status: "success" as const,
  data: {
    token: "jwt-token",
    user: { id: "1", email: "sara@ffi.test", role: "Employee" as const },
  },
};

beforeEach(() => {
  loginApi.mockReset();
  localStorage.clear();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

function renderLogin() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/employee/home" element={<div>Employee home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Types an identifier + password and submits the sign-in form. */
function signIn(identifier: string) {
  fireEvent.change(document.querySelector<HTMLInputElement>("#identifier")!, {
    target: { value: identifier },
  });
  fireEvent.change(document.querySelector<HTMLInputElement>("#password")!, {
    target: { value: PASSWORD },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

describe("LoginPage identifier field", () => {
  it("asks for an email or a phone number", () => {
    renderLogin();

    expect(screen.getByText("Email or phone")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Email or phone number"),
    ).toBeInTheDocument();
  });

  it("requires an identifier before submitting", async () => {
    renderLogin();

    fireEvent.change(document.querySelector<HTMLInputElement>("#password")!, {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      await screen.findByText("Email or phone number is required"),
    ).toBeInTheDocument();
    expect(loginApi).not.toHaveBeenCalled();
  });

  it("still signs in with an email address", async () => {
    loginApi.mockResolvedValue(loginSuccess);
    renderLogin();

    signIn("sara@ffi.test");

    await waitFor(() =>
      expect(loginApi).toHaveBeenCalledWith({
        identifier: "sara@ffi.test",
        password: PASSWORD,
      }),
    );
  });

  // The backend normalizes phone numbers itself, so every accepted local and
  // international form must reach it byte-for-byte as the user typed it.
  it.each([
    "+966554867964",
    "966554867964",
    "0554867964",
    "554867964",
    "+201013530963",
    "201013530963",
    "01013530963",
    "1013530963",
  ])("submits the phone number '%s' unchanged", async (phone) => {
    loginApi.mockResolvedValue(loginSuccess);
    renderLogin();

    signIn(phone);

    await waitFor(() =>
      expect(loginApi).toHaveBeenCalledWith({
        identifier: phone,
        password: PASSWORD,
      }),
    );
  });

  it("explains how to disambiguate a phone number shared by several accounts", async () => {
    loginApi.mockResolvedValue({
      status: "error" as const,
      message:
        "Phone number matches more than one account. Use full international format including country code.",
    });
    renderLogin();

    signIn("554867964");

    expect(
      await screen.findByText(
        "This phone number matches more than one account. Enter the full international number, including the country code.",
      ),
    ).toBeInTheDocument();
  });
});
