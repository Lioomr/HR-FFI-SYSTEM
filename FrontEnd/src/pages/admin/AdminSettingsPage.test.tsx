import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../services/api/settingsApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/api/settingsApi")
  >("../../services/api/settingsApi");
  return {
    ...actual,
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
});

import AdminSettingsPage from "./AdminSettingsPage";
import { getSettings, updateSettings } from "../../services/api/settingsApi";
import type { SettingsDto } from "../../services/api/apiTypes";
import { useI18nStore } from "../../i18n/i18nStore";

const get = getSettings as unknown as ReturnType<typeof vi.fn>;
const put = updateSettings as unknown as ReturnType<typeof vi.fn>;

/** antd + jsdom are slow under a full-suite run; the 1s waitFor default is tight. */
const FIND = { timeout: 8000 };

/** GET returns both grace fields; the legacy alias mirrors the canonical one. */
const DEFAULT_ATTENDANCE = {
  geofence_enabled: false,
  work_day_start_time: "09:00",
  default_shift_end_time: "18:00",
  late_grace_minutes: 15,
  grace_window_minutes: 15,
  grace_use_limit_per_month: 3,
  post_grace_tolerance_minutes: 5,
  approved_late_permission_limit_per_month: 3,
  during_shift_permission_max_minutes: 120,
  permission_request_advance_limit_days: 7,
  absence_detection_enabled: true,
  work_week_days: [6, 0, 1, 2, 3],
};

/** What the page PUTs: the canonical grace field, never the legacy alias. */
const CANONICAL_ATTENDANCE = {
  geofence_enabled: false,
  work_day_start_time: "09:00",
  default_shift_end_time: "18:00",
  grace_window_minutes: 15,
  grace_use_limit_per_month: 3,
  post_grace_tolerance_minutes: 5,
  approved_late_permission_limit_per_month: 3,
  during_shift_permission_max_minutes: 120,
  permission_request_advance_limit_days: 7,
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

function changeNumber(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
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
      ...CANONICAL_ATTENDANCE,
      geofence_enabled: true,
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
        grace_window_minutes: 20,
        absence_detection_enabled: false,
        work_week_days: [0, 1, 2, 3, 4],
      }),
    });

    await renderLoaded();

    expect(screen.getByLabelText("Grace window (minutes)")).toHaveValue("20");
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
    expect(put.mock.calls[0][0].attendance).toEqual(CANONICAL_ATTENDANCE);
  });

  it("submits an edited grace period as grace_window_minutes only", async () => {
    await renderLoaded();

    changeNumber("Grace window (minutes)", "30");
    fireEvent.click(save());

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    const attendance = put.mock.calls[0][0].attendance;
    expect(attendance.grace_window_minutes).toBe(30);
    expect(attendance).not.toHaveProperty("late_grace_minutes");
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

describe("attendance policy controls", () => {
  it("hydrates and submits the late-arrival and permission policy", async () => {
    await renderLoaded();

    expect(screen.getByLabelText("Default shift end")).toHaveValue("18:00");
    expect(screen.getByLabelText("Grace uses per month")).toHaveValue("3");
    changeNumber("Tolerance after grace runs out (minutes)", "10");
    changeNumber("Approved Late Permissions per month", "4");
    changeNumber("During Shift permission limit (minutes)", "90");
    changeNumber("Advance request limit (days)", "14");
    fireEvent.click(save());

    await waitFor(() => expect(put).toHaveBeenCalled(), FIND);
    expect(put.mock.calls[0][0].attendance).toEqual({
      ...CANONICAL_ATTENDANCE,
      post_grace_tolerance_minutes: 10,
      approved_late_permission_limit_per_month: 4,
      during_shift_permission_max_minutes: 90,
      permission_request_advance_limit_days: 14,
    });
  });
});
