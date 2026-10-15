import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useI18nStore } from "../../../i18n/i18nStore";
import { PermissionRequestFormPage } from "./PermissionRequestPages";
import * as permissionApi from "../../../services/api/permissionRequestsApi";
import { getSettings } from "../../../services/api/settingsApi";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: "9" }),
}));
vi.mock("../../../services/api/permissionRequestsApi", async () => {
  const actual = await vi.importActual<typeof permissionApi>(
    "../../../services/api/permissionRequestsApi",
  );
  return {
    ...actual,
    getPermissionRequest: vi.fn(),
    editPermissionRequest: vi.fn(),
    getMyPermissionRequests: vi.fn(),
  };
});
vi.mock("../../../services/api/settingsApi", () => ({
  getSettings: vi.fn(),
}));

const get = vi.mocked(permissionApi.getPermissionRequest);
const edit = vi.mocked(permissionApi.editPermissionRequest);

const existing = {
  id: 9,
  permission_type: "exit",
  request_date: "2026-10-13",
  from_time: "16:00:00",
  to_time: "16:30:00",
  exit_type: "personal",
  reason: "Appointment",
  status: "pending_manager",
  workflow: { status: "in_review", can_edit: true, history: [] },
} as unknown as permissionApi.PermissionRequest;

const ok = (data: unknown) => ({ status: "success" as const, data });

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
  vi.mocked(getSettings).mockResolvedValue({
    status: "success",
    data: { attendance: {} },
  } as never);
  get.mockResolvedValue(ok(existing) as never);
  edit.mockResolvedValue(ok(existing) as never);
});

describe("permission request edit mode", () => {
  it("prefills the request and submits a PATCH, then returns to the detail page", async () => {
    render(<PermissionRequestFormPage mode="edit" />);
    const reason = await screen.findByDisplayValue("Appointment");
    expect(screen.getAllByText(/until it reaches HR/).length).toBeGreaterThan(
      0,
    );
    fireEvent.change(reason, { target: { value: "Dentist visit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit).toHaveBeenCalledWith("9", {
      permission_type: "exit",
      request_date: "2026-10-13",
      reason: "Dentist visit",
      from_time: "16:00",
      to_time: "16:30",
      exit_type: "personal",
      duration_minutes: 30,
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/employee/permission-requests/9"),
    );
  });

  it("disables saving when the server says the request is not editable", async () => {
    get.mockResolvedValue(
      ok({
        ...existing,
        workflow: { ...existing.workflow, can_edit: false },
      }) as never,
    );
    render(<PermissionRequestFormPage mode="edit" />);
    await screen.findByDisplayValue("Appointment");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("shows the server message on a not-editable 422 and refreshes the data", async () => {
    edit.mockRejectedValue({
      response: {
        status: 422,
        data: { status: "error", message: "Request is already with HR." },
      },
    });
    render(<PermissionRequestFormPage mode="edit" />);
    await screen.findByDisplayValue("Appointment");
    get.mockResolvedValue(
      ok({
        ...existing,
        workflow: { ...existing.workflow, can_edit: false },
      }) as never,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      (await screen.findAllByText("Request is already with HR.")).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled(),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("maps field validation errors onto the form", async () => {
    edit.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Reason is too vague.",
          errors: [{ field: "reason", message: "Reason is too vague." }],
        },
      },
    });
    render(<PermissionRequestFormPage mode="edit" />);
    await screen.findByDisplayValue("Appointment");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      (await screen.findAllByText("Reason is too vague.")).length,
    ).toBeGreaterThan(0);
    expect(navigate).not.toHaveBeenCalled();
  });
});
