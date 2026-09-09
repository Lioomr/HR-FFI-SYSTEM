import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { useAuthStore } from "../auth/authStore";
import LoginPage from "./LoginPage";

describe("LoginPage", () => {
  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
  });

  it("keeps the credential form available for switching from an active session", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "employee-1", email: "employee@ffi.test", role: "Employee" },
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/employee/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("button", { name: "Sign In" }),
    ).toBeVisible();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });
});
