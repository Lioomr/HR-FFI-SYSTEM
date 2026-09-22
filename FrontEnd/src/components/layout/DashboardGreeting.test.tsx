import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../services/api/usersApi", () => ({
  getMe: vi.fn(),
}));

import DashboardGreeting from "./DashboardGreeting";
import * as usersApi from "../../services/api/usersApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getMe = usersApi.getMe as unknown as ReturnType<typeof vi.fn>;

const me = (names: {
  full_name_en?: string | null;
  full_name_ar?: string | null;
}) => ({
  status: "success" as const,
  data: {
    id: "1",
    email: "m.sami@ffi.test",
    full_name: "Account Name",
    is_active: true,
    role: "HRManager" as const,
    ...names,
  },
});

beforeEach(() => {
  getMe.mockReset();
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "1",
      email: "m.sami@ffi.test",
      role: "HRManager",
      accessible_organizations: [
        { id: 3, name: "Aseco Pro", node_type: "company" } as never,
      ],
      active_organization_id: 3,
    },
  });
});

describe("DashboardGreeting", () => {
  it("welcomes the user by English name in the English view", async () => {
    useI18nStore.getState().setLanguage("en");
    getMe.mockResolvedValue(
      me({ full_name_en: "Mohammed Sami", full_name_ar: "محمد سامي" }),
    );

    render(<DashboardGreeting />);

    expect(
      await screen.findByRole("heading", { name: /Welcome, Mohammed Sami/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Today's HR summary — Aseco Pro"),
    ).toBeInTheDocument();
  });

  it("uses the Arabic name and wording in the Arabic view", async () => {
    useI18nStore.getState().setLanguage("ar");
    getMe.mockResolvedValue(
      me({ full_name_en: "Mohammed Sami", full_name_ar: "محمد سامي" }),
    );

    render(<DashboardGreeting />);

    expect(
      await screen.findByRole("heading", { name: /مرحباً محمد سامي/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ملخص الموارد البشرية اليوم — Aseco Pro"),
    ).toBeInTheDocument();
  });

  it("falls back to the English name when there is no Arabic name", async () => {
    useI18nStore.getState().setLanguage("ar");
    getMe.mockResolvedValue(
      me({ full_name_en: "Mohammed Sami", full_name_ar: null }),
    );

    render(<DashboardGreeting />);

    expect(
      await screen.findByRole("heading", { name: /مرحباً Mohammed Sami/ }),
    ).toBeInTheDocument();
  });
});
