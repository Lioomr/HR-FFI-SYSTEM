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

const DEFAULT_ATTENDANCE = {
  geofence_enabled: false,
  work_day_start_time: "09:00",
  late_grace_minutes: 15,
  absence_detection_enabled: true,
  work_week_days: [6, 0, 1, 2, 3],
};

function makeSettings(
  attendance: Partial<typeof DEFAULT_ATTENDANCE> = {},
): SettingsDto {
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
    attendance: { ...DEFAULT_ATTENDANCE, ...attendance },
    updated_at: "2026-08-29T09:15:00Z",
  };
}

const save = () => screen.getByRole("button", { name: /save/i });

async function renderLoaded() {
  render(<AdminSettingsPage />);
  // The GPS toggle is the first attendance control; its presence means the
  // settings GET has resolved and the form is populated.
  await screen.findByLabelText("Require GPS location for check-in", {}, FIND);
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  useI18nStore.getState().setLanguage("en");
  get.mockResolvedValue({ status: "success", data: makeSettings() });
  put.mockResolvedValue({ status: "success", data: makeSettings() });
});

describe("geofence attendance toggle", () => {
  it("reflects the attendance section returned by GET /settings/", async () => {
    get.mockResolvedValue({
      status: "success",
      data: makeSettings({ geofence_enabled: true }),
    });

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
    render(<AdminSettingsPage />);

    const toggle = await screen.findByLabelText(
      "Require GPS location for check-in",
      {},
      FIND,
    );
    fireEvent.click(toggle);
    // The button carries a <SaveOutlined /> icon, so its accessible name is
    // "save Save" rather than a bare "Save".
    fireEvent.click(save());

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    const payload = put.mock.calls[0][0];
    expect(payload.attendance).toEqual({
      geofence_enabled: true,
      work_day_start_time: "09:00",
      late_grace_minutes: 15,
      absence_detection_enabled: true,
      work_week_days: [6, 0, 1, 2, 3],
    });
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

    fireEvent.click(save());

    expect(
      await screen.findByText("Unknown field.", {}, FIND),
    ).toBeInTheDocument();
  });
});

describe("work schedule controls", () => {
  it("hydrates every field from GET /settings/", async () => {
    get.mockResolvedValue({
      status: "success",
      data: makeSettings({
        late_grace_minutes: 20,
        absence_detection_enabled: false,
        work_week_days: [0, 1, 2, 3, 4],
      }),
    });

    await renderLoaded();

    expect(screen.getByLabelText("Late grace period (minutes)")).toHaveValue(
      "20",
    );
    expect(
      screen.getByLabelText("Automatic absence detection"),
    ).not.toBeChecked();
    // Working days Mon–Fri selected, weekend days not.
    expect(screen.getByRole("checkbox", { name: "Monday" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Friday" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sunday" })).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Saturday" }),
    ).not.toBeChecked();
  });

  it("round-trips the untouched work-schedule values on save", async () => {
    await renderLoaded();

    fireEvent.click(save());

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    expect(put.mock.calls[0][0].attendance).toEqual({
      geofence_enabled: false,
      work_day_start_time: "09:00",
      late_grace_minutes: 15,
      absence_detection_enabled: true,
      work_week_days: [6, 0, 1, 2, 3],
    });
  });

  it("submits an edited grace period", async () => {
    await renderLoaded();

    const grace = screen.getByLabelText("Late grace period (minutes)");
    fireEvent.change(grace, { target: { value: "30" } });
    fireEvent.blur(grace);
    fireEvent.click(save());

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    expect(put.mock.calls[0][0].attendance.late_grace_minutes).toBe(30);
  });

  it("submits the working-day numbers the user leaves checked", async () => {
    await renderLoaded();

    const thursday = screen.getByRole("checkbox", { name: "Thursday" });
    expect(thursday).toBeChecked();
    fireEvent.click(thursday); // drop Thursday (weekday() === 3)
    fireEvent.click(save());

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    expect(put.mock.calls[0][0].attendance.work_week_days).toEqual([
      6, 0, 1, 2,
    ]);
  });

  it("toggles absence detection off in the payload", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByLabelText("Automatic absence detection"));
    fireEvent.click(save());

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    expect(put.mock.calls[0][0].attendance.absence_detection_enabled).toBe(
      false,
    );
  });
});
