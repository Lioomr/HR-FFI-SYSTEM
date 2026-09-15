import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import dayjs from "dayjs";
import { useI18nStore } from "../../../i18n/i18nStore";
import { PermissionRequestFormPage } from "./PermissionRequestPages";
import * as permissionApi from "../../../services/api/permissionRequestsApi";
import { getSettings } from "../../../services/api/settingsApi";
import type { SettingsDto } from "../../../services/api/apiTypes";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({}),
}));
vi.mock("../../../services/api/permissionRequestsApi", async () => {
  const actual = await vi.importActual<typeof permissionApi>(
    "../../../services/api/permissionRequestsApi",
  );
  return {
    ...actual,
    createPermissionRequest: vi.fn(),
    getMyPermissionRequests: vi.fn(),
  };
});
vi.mock("../../../services/api/settingsApi", () => ({
  getSettings: vi.fn(),
}));

const create = vi.mocked(permissionApi.createPermissionRequest);
const today = () => dayjs().format("YYYY-MM-DD");

function chooseType(label: string) {
  fireEvent.click(screen.getByText(label));
}

function fillReason(text = "Clinic appointment") {
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: text },
  });
}

function setTime(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.mouseDown(input);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
  fireEvent.blur(input);
}

/** The evidence picker appears once the type switch has re-rendered the form. */
async function addFiles(testId: string, files: File[]) {
  fireEvent.change(await screen.findByTestId(testId), { target: { files } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
}

const validation = (errors: Array<{ field: string; message: string }>) => ({
  response: {
    status: 422,
    data: { status: "error", message: errors[0].message, errors },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
  vi.mocked(getSettings).mockResolvedValue({
    status: "success",
    data: {
      attendance: {
        permission_request_advance_limit_days: 7,
        during_shift_permission_max_minutes: 90,
        approved_late_permission_limit_per_month: 3,
      },
    } as SettingsDto,
  });
  vi.mocked(permissionApi.getMyPermissionRequests).mockResolvedValue({
    status: "success",
    data: {
      items: [
        {
          id: 3,
          permission_type: "late",
          status: "approved",
          monthly_late_permission_usage: 2,
          monthly_late_permission_limit: 3,
        } as permissionApi.PermissionRequest,
      ],
      count: 1,
    },
  });
  create.mockResolvedValue({
    status: "success",
    data: { id: 9 } as permissionApi.PermissionRequest,
  });
});

describe("Late Permission form", () => {
  it("shows monthly usage and requires evidence before submitting", async () => {
    render(<PermissionRequestFormPage />);
    chooseType("Late arrival");

    expect(
      await screen.findByText("Approved Late Permissions this month: 2 of 3"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("From time")).not.toBeInTheDocument();
    fillReason();
    submit();

    expect(
      await screen.findByText("Attach at least one evidence file."),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unsupported files and submits evidence with camera metadata", async () => {
    render(<PermissionRequestFormPage />);
    chooseType("Late arrival");

    await addFiles("evidence-file-input", [
      new File(["text"], "notes.txt", { type: "text/plain" }),
    ]);
    expect(
      await screen.findByText("notes.txt is not a supported file type."),
    ).toBeInTheDocument();

    const pdf = new File(["%PDF"], "evidence.pdf", { type: "application/pdf" });
    const photo = new File(["img"], "photo.jpg", {
      // Several phone camera implementations label an ordinary JPEG as image/jpg.
      type: "image/jpg",
      lastModified: Date.parse("2026-09-13T06:00:00Z"),
    });
    await addFiles("evidence-file-input", [pdf]);
    await addFiles("evidence-camera-input", [photo]);
    expect(await screen.findByText("photo.jpg")).toBeInTheDocument();
    fillReason();
    submit();

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toEqual({
      permission_type: "late",
      request_date: today(),
      reason: "Clinic appointment",
      attachments: [
        pdf,
        expect.objectContaining({
          name: "photo.jpg",
          type: "image/jpeg",
        }),
      ],
      attachment_metadata: [
        undefined,
        { source: "camera", captured_at: "2026-09-13T06:00:00.000Z" },
      ],
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/employee/permission-requests"),
    );
  });

  it("puts 422 field errors on the field and the rest in a form alert", async () => {
    create.mockRejectedValue(
      validation([
        {
          field: "request_date",
          message: "You have reached the monthly Late Permission limit of 3.",
        },
        {
          field: "permission_type",
          message: "Attendance-exempt employees cannot submit Late Permission.",
        },
      ]),
    );
    render(<PermissionRequestFormPage />);
    chooseType("Late arrival");
    await addFiles("evidence-file-input", [
      new File(["%PDF"], "evidence.pdf", { type: "application/pdf" }),
    ]);
    fillReason();
    submit();

    const dateError = await screen.findByText(
      "You have reached the monthly Late Permission limit of 3.",
    );
    expect(dateError.closest(".ant-form-item")).toHaveTextContent("Date");
    const alert = screen.getByText(
      "Attendance-exempt employees cannot submit Late Permission.",
    );
    expect(alert.closest(".ant-alert")).toHaveTextContent(
      "The request could not be submitted:",
    );
  });
});

describe("During Shift Permission form", () => {
  it("enforces the policy maximum and maps an overlap onto from_time", async () => {
    create.mockRejectedValue(
      validation([
        {
          field: "from_time",
          message: "This time overlaps another active permission request.",
        },
      ]),
    );
    render(<PermissionRequestFormPage />);
    chooseType("During shift");
    expect(await screen.findByText("Maximum 90 minutes.")).toBeInTheDocument();

    setTime("From time", "10:00");
    setTime("To time", "12:00");
    expect(
      await screen.findByText("The duration cannot exceed 90 minutes."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit request" }),
    ).toBeDisabled();

    setTime("To time", "11:00");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Submit request" }),
      ).toBeEnabled(),
    );
    fillReason();
    submit();

    const overlap = await screen.findByText(
      "This time overlaps another active permission request.",
    );
    expect(overlap.closest(".ant-form-item")).toHaveTextContent("From time");
    expect(create.mock.calls[0][0]).toEqual({
      permission_type: "during_shift",
      request_date: today(),
      from_time: "10:00",
      to_time: "11:00",
      reason: "Clinic appointment",
      attachments: [],
      attachment_metadata: [],
    });
  });
});

describe("Exit Permission form", () => {
  it("keeps the legacy same-day payload without a permission type", async () => {
    render(<PermissionRequestFormPage />);

    setTime("From time", "14:00");
    setTime("To time", "15:30");
    fillReason("Bank visit");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Submit request" }),
      ).toBeEnabled(),
    );
    submit();

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toEqual({
      request_date: today(),
      from_time: "14:00",
      to_time: "15:30",
      exit_type: "personal",
      reason: "Bank visit",
      duration_minutes: 90,
    });
  });
});
