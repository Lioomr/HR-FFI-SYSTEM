import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../services/api/settingsApi", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

import AdminSettingsPage from "./AdminSettingsPage";
import { getSettings, updateSettings } from "../../services/api/settingsApi";
import type { SettingsDto } from "../../services/api/apiTypes";
import { useI18nStore } from "../../i18n/i18nStore";

const get = getSettings as unknown as ReturnType<typeof vi.fn>;
const put = updateSettings as unknown as ReturnType<typeof vi.fn>;

/** antd + jsdom are slow under a full-suite run; the 1s waitFor default is tight. */
const FIND = { timeout: 8000 };

function makeSettings(geofenceEnabled = false): SettingsDto {
  return {
    password_policy: {
      min_length: 8,
      require_upper: true,
      require_lower: true,
      require_number: true,
      require_special: false,
    },
    session: { timeout_minutes: 30 },
    invites: { default_expiry_hours: 72 },
    security: { max_login_attempts: 5 },
    attendance: { geofence_enabled: geofenceEnabled },
    updated_at: "2026-08-29T09:15:00Z",
  };
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  useI18nStore.getState().setLanguage("en");
  get.mockResolvedValue({ status: "success", data: makeSettings(false) });
});

describe("geofence attendance toggle", () => {
  it("reflects the attendance section returned by GET /settings/", async () => {
    get.mockResolvedValue({ status: "success", data: makeSettings(true) });

    render(<AdminSettingsPage />);

    const toggle = await screen.findByLabelText(
      "Require GPS location for check-in",
      {},
      FIND,
    );
    expect(toggle).toBeChecked();
  });

  it("starts unchecked when the backend reports the toggle off", async () => {
    render(<AdminSettingsPage />);

    const toggle = await screen.findByLabelText(
      "Require GPS location for check-in",
      {},
      FIND,
    );
    expect(toggle).not.toBeChecked();
  });

  it("sends the attendance section alongside the existing required sections", async () => {
    put.mockResolvedValue({ status: "success", data: makeSettings(true) });

    render(<AdminSettingsPage />);

    const toggle = await screen.findByLabelText(
      "Require GPS location for check-in",
      {},
      FIND,
    );
    fireEvent.click(toggle);
    // The button carries a <SaveOutlined /> icon, so its accessible name is
    // "save Save" rather than a bare "Save".
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    const payload = put.mock.calls[0][0];
    expect(payload.attendance).toEqual({ geofence_enabled: true });
    // The backend still requires every legacy section on PUT.
    expect(payload.password_policy).toBeDefined();
    expect(payload.session).toBeDefined();
    expect(payload.invites).toBeDefined();
    expect(payload.security).toBeDefined();
  });

  it("renders a backend save error without rewriting it", async () => {
    put.mockResolvedValue({
      status: "error",
      message: "Unknown field.",
      errors: [{ field: "attendance", message: "Unknown field." }],
    });

    render(<AdminSettingsPage />);
    await screen.findByLabelText("Require GPS location for check-in", {}, FIND);

    // The button carries a <SaveOutlined /> icon, so its accessible name is
    // "save Save" rather than a bare "Save".
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(
      await screen.findByText("Unknown field.", {}, FIND),
    ).toBeInTheDocument();
  });
});
