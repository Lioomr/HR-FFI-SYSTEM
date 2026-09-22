import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../services/api/apiClient", () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

import AttendancePolicyPage from "./AttendancePolicyPage";
import { api } from "../../services/api/apiClient";
import { useI18nStore } from "../../i18n/i18nStore";
import { resolveTranslation } from "../../i18n/translate";

const FIND = { timeout: 8000 };

const settings = {
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
  attendance: {
    geofence_enabled: false,
    work_day_start_time: "09:00",
    default_shift_end_time: "18:00",
    late_grace_minutes: 15,
    grace_window_minutes: 15,
    post_grace_tolerance_minutes: 5,
    approved_late_permission_limit_per_month: 3,
    during_shift_permission_max_minutes: 120,
    permission_request_advance_limit_days: 7,
    absence_detection_enabled: true,
  },
  updated_at: "2026-09-13T08:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AttendancePolicyPage />
    </MemoryRouter>,
  );
}

const save = () => screen.getByRole("button", { name: /save/i });

/** A 422 in the final contract shape: nested fields use dotted paths. */
const validation = (errors: Array<{ field: string; message: string }>) => ({
  response: {
    status: 422,
    data: { status: "error", message: errors[0].message, errors },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
  vi.mocked(api.get).mockResolvedValue({
    data: { status: "success", data: settings },
  });
  vi.mocked(api.put).mockResolvedValue({
    data: { status: "success", data: settings },
  });
});

describe("HR attendance policy", () => {
  it("saves an attendance-only body with the canonical grace field", async () => {
    renderPage();

    const grace = await screen.findByLabelText(
      "Grace window (minutes)",
      {},
      FIND,
    );
    expect(grace).toHaveValue("15");
    fireEvent.change(grace, { target: { value: "20" } });
    fireEvent.blur(grace);
    fireEvent.click(save());

    await waitFor(() => expect(api.put).toHaveBeenCalled(), FIND);
    expect(vi.mocked(api.put).mock.calls[0]).toEqual([
      "/settings/",
      {
        attendance: {
          work_day_start_time: "09:00",
          default_shift_end_time: "18:00",
          grace_window_minutes: 20,
                post_grace_tolerance_minutes: 5,
          approved_late_permission_limit_per_month: 3,
          during_shift_permission_max_minutes: 120,
          permission_request_advance_limit_days: 7,
        },
      },
    ]);
  });

  it("shows the backend's dotted-field message on the grace-window input", async () => {
    const message = "Ensure this value is less than or equal to 240.";
    vi.mocked(api.put).mockRejectedValue(
      validation([{ field: "attendance.grace_window_minutes", message }]),
    );
    renderPage();
    const grace = await screen.findByLabelText(
      "Grace window (minutes)",
      {},
      FIND,
    );

    fireEvent.click(save());

    expect(await screen.findByText(message, {}, FIND)).toBeInTheDocument();
    const graceItem = grace.closest(".ant-form-item");
    expect(graceItem).toHaveClass("ant-form-item-has-error");
    expect(graceItem).toHaveTextContent(message);
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(
      screen.queryByText(
        "Some values are outside the allowed range. Check the fields and try again.",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps a form-level message only for errors that match no field", async () => {
    const fieldMessage = "Ensure this value is greater than or equal to 1.";
    const formMessage = "At least one attendance setting is required.";
    vi.mocked(api.put).mockRejectedValue(
      validation([
        {
          field: "attendance.during_shift_permission_max_minutes",
          message: fieldMessage,
        },
        { field: "non_field_errors", message: formMessage },
      ]),
    );
    renderPage();
    const duringShift = await screen.findByLabelText(
      "During Shift permission limit (minutes)",
      {},
      FIND,
    );

    fireEvent.click(save());

    const banner = await screen.findByText(formMessage, {}, FIND);
    expect(banner.closest(".ant-alert")).not.toBeNull();
    // The banner renders from state at once; antd shows field help a tick later.
    await screen.findByText(fieldMessage, {}, FIND);
    const fieldItem = duringShift.closest(".ant-form-item");
    expect(fieldItem).toHaveClass("ant-form-item-has-error");
    expect(fieldItem).toHaveTextContent(fieldMessage);
    expect(banner.closest(".ant-alert")).not.toHaveTextContent(fieldMessage);
  });

  it("shows the unauthorized page when settings are forbidden", async () => {
    vi.mocked(api.get).mockRejectedValue({
      response: { status: 403, data: { status: "error", message: "Denied" } },
    });
    renderPage();

    expect(
      await screen.findByText(
        resolveTranslation("en", "error.unauthorized.title"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Grace window (minutes)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the policy in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    renderPage();

    expect(
      await screen.findByLabelText("نافذة المهلة (بالدقائق)", {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getByText("سياسة الحضور")).toBeInTheDocument();
  });
});
