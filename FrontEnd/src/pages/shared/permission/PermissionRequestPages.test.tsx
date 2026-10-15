import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useI18nStore } from "../../../i18n/i18nStore";
import { PermissionRequestDetailPage } from "./PermissionRequestPages";
import * as permissionApi from "../../../services/api/permissionRequestsApi";
import type { PermissionRequest } from "../../../services/api/permissionRequestsApi";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: "1" }),
}));
vi.mock("../../../services/api/permissionRequestsApi", async () => {
  const actual = await vi.importActual<typeof permissionApi>(
    "../../../services/api/permissionRequestsApi",
  );
  return {
    ...actual,
    getPermissionRequest: vi.fn(),
    decidePermissionRequest: vi.fn(),
    downloadPermissionRequestAttachment: vi.fn(),
    addPermissionRequestAttachments: vi.fn(),
    downloadPermissionRequestPdf: vi.fn(),
  };
});

vi.mock("../../../components/documents/DocumentIntegrityPanel", async () => ({
  default: (await import("../../../test/integrityPanelStub")).default,
}));

const base: PermissionRequest = {
  id: 1,
  reference_no: "PERM-20260912-0001",
  permission_type: "exit",
  attachments: [],
  attachment_count: 0,
  monthly_late_permission_usage: null,
  monthly_late_permission_limit: null,
  request_date: "2026-09-12",
  from_time: "16:00:00",
  to_time: "16:30:00",
  duration_minutes: 30,
  exit_type: "personal" as const,
  exit_type_label: "Personal",
  exit_type_label_ar: "شخصي",
  reason: "Appointment",
  status: "pending_manager" as const,
  status_label: "Pending Manager",
  status_label_ar: "بانتظار المدير المباشر",
  employee: {
    id: 2,
    email: "employee@test",
    full_name: "Employee One",
    employee_profile_id: 2,
  },
  company_id: 1,
  company_name: "FFI",
  manager_decision: null,
  manager_decision_by: null,
  manager_decision_at: null,
  manager_decision_note: "",
  hr_decision: null,
  hr_decision_by: null,
  hr_decision_at: null,
  hr_decision_note: "",
  cancelled_at: null,
  created_at: "2026-09-12T12:00:00Z",
  updated_at: "2026-09-12T12:00:00Z",
  direct_manager: { id: 3, employee_profile_id: 3, full_name: "Maha Manager" },
  workflow: {
    status: "in_review",
    current_stage: "manager",
    current_approver_role: "manager",
    current_actor: { id: 3, email: "manager@test", full_name: "Maha Manager" },
    can_approve: false,
    can_reject: false,
    can_cancel: true,
    history: [
      {
        id: 10,
        action: "submit",
        stage: "",
        actor: { id: 2, email: "employee@test", full_name: "Employee One" },
        at: "2026-09-12T12:00:00Z",
        note: "",
        from_status: "draft",
        to_status: "submitted",
      },
    ],
  },
};

function response(overrides: Partial<PermissionRequest> = {}) {
  return { status: "success" as const, data: { ...base, ...overrides } };
}

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
  vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(response());
});

describe("permission request approval trail", () => {
  it("shows pending manager and HR stages without a CEO stage", async () => {
    render(<PermissionRequestDetailPage role="employee" />);
    expect(await screen.findByText("Approval trail")).toBeInTheDocument();
    expect(
      screen.getAllByText("Direct Manager Approval").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("HR Approval").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Maha Manager").length).toBeGreaterThan(0);
    expect(screen.queryByText(/CEO/i)).not.toBeInTheDocument();
  });

  it("marks the manager stage skipped when no manager is assigned", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(
      response({
        direct_manager: null,
        status: "pending_hr",
        status_label: "Pending HR",
        status_label_ar: "بانتظار الموارد البشرية",
        workflow: {
          ...base.workflow,
          current_stage: "hr",
          current_approver_role: "hr",
          current_actor: null,
        },
      }),
    );
    render(<PermissionRequestDetailPage role="employee" />);
    // jsdom reports a phone-sized screen, where the trail starts compact.
    fireEvent.click(
      await screen.findByRole("button", { name: "Show details" }),
    );
    // Skipped stages fold into one muted "Skipped" row with no note.
    expect(await screen.findByText("Skipped")).toBeInTheDocument();
    expect(
      screen.queryByText("Not required for this employee"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Pending HR")).toBeInTheDocument();
  });

  it("shows completed approvers, comments, and localized LTR duration", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(
      response({
        status: "approved",
        manager_decision: "approved",
        manager_decision_by: {
          id: 3,
          email: "manager@test",
          full_name: "Maha Manager",
        },
        manager_decision_at: "2026-09-12T13:00:00Z",
        manager_decision_note: "Approved for appointment",
        hr_decision: "approved",
        hr_decision_by: { id: 4, email: "hr@test", full_name: "HR Reviewer" },
        hr_decision_at: "2026-09-12T14:00:00Z",
        hr_decision_note: "Reviewed",
        workflow: {
          ...base.workflow,
          current_stage: "",
          current_actor: null,
          can_cancel: false,
        },
      }),
    );
    render(<PermissionRequestDetailPage role="employee" />);
    expect(await screen.findByText("30 minutes")).toBeInTheDocument();
    // jsdom reports a phone-sized screen, where the trail starts compact.
    fireEvent.click(
      await screen.findByRole("button", { name: "Show details" }),
    );
    // The trail names who decided each stage.
    expect(screen.getByText("Approved by HR Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/Approved for appointment/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-12 17:00/)).toBeInTheDocument();
  });

  it("renders Arabic duration and trail labels", async () => {
    useI18nStore.getState().setLanguage("ar");
    render(<PermissionRequestDetailPage role="employee" />);
    expect(await screen.findByText("مسار الاعتماد")).toBeInTheDocument();
    expect(screen.getByText("30 دقيقة")).toBeInTheDocument();
    expect(screen.getAllByText("اعتماد المدير المباشر").length).toBeGreaterThan(
      0,
    );
  });
});

describe("sticky decision bar", () => {
  it("pins the manager's approve/reject and sends the comment", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(
      response({
        workflow: {
          ...base.workflow,
          can_approve: true,
          can_reject: true,
          can_cancel: false,
        },
      }),
    );
    vi.mocked(permissionApi.decidePermissionRequest).mockResolvedValue(
      response({
        status: "pending_hr",
        workflow: { ...base.workflow, current_stage: "hr", can_cancel: false },
      }),
    );
    render(<PermissionRequestDetailPage role="manager" />);

    const bar = await screen.findByRole("region", { name: "Decision actions" });
    expect(bar).toHaveTextContent("Awaiting your decision");
    expect(
      screen.queryByRole("button", { name: "Cancel request" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Optional decision comment"), {
      target: { value: "Fine" },
    });
    fireEvent.click(
      within(bar).getByRole("button", { name: "Approve: Employee One" }),
    );

    await waitFor(() =>
      expect(permissionApi.decidePermissionRequest).toHaveBeenCalledWith(
        "1",
        "manager",
        "approve",
        "Fine",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Decision actions" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("holds only the owner's cancel, without a decision hint", async () => {
    render(<PermissionRequestDetailPage role="employee" />);

    const bar = await screen.findByRole("region", { name: "Decision actions" });
    expect(bar).not.toHaveTextContent("Awaiting your decision");
    expect(
      within(bar).getByRole("button", { name: "Cancel request" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Approve/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Optional decision comment"),
    ).not.toBeInTheDocument();
  });
});

describe("permission detail edit entry", () => {
  it("hides Edit unless the server flag is true, keeping Cancel", async () => {
    render(<PermissionRequestDetailPage role="employee" />);
    const bar = await screen.findByRole("region", { name: "Decision actions" });
    expect(
      within(bar).getByRole("button", { name: "Cancel request" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit request" }),
    ).not.toBeInTheDocument();
  });

  it("shows Edit beside Cancel, navigates, and renders recorded edits", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(
      response({
        workflow: {
          ...base.workflow,
          can_edit: true,
          history: [
            ...base.workflow.history,
            {
              id: 11,
              action: "edit",
              stage: "",
              actor: {
                id: 2,
                email: "employee@test",
                full_name: "Employee One",
              },
              at: "2026-09-12T13:00:00Z",
              note: "reason",
              from_status: "pending_manager",
              to_status: "pending_manager",
            },
          ],
        },
      }),
    );
    render(<PermissionRequestDetailPage role="employee" />);
    const bar = await screen.findByRole("region", { name: "Decision actions" });
    expect(
      within(bar).getByRole("button", { name: "Cancel request" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Edited by Employee One/)).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Edit request" }));
    expect(navigate).toHaveBeenCalledWith(
      "/employee/permission-requests/1/edit",
    );
  });
});

describe("late permission detail", () => {
  const late = (overrides: Partial<PermissionRequest> = {}) =>
    response({
      permission_type: "late",
      from_time: null,
      to_time: null,
      duration_minutes: 0,
      exit_type: "",
      exit_type_label: "",
      exit_type_label_ar: "",
      monthly_late_permission_usage: 2,
      monthly_late_permission_limit: 3,
      attachment_count: 1,
      attachments: [
        {
          id: 5,
          original_filename: "photo.jpg",
          content_type: "image/jpeg",
          size_bytes: 2048,
          // Multipart uploads currently come back as JSON text.
          capture_metadata:
            '{"source":"camera","captured_at":"2026-09-13T06:00:00Z"}',
          created_at: "2026-09-13T06:01:00Z",
          download_url: "/api/permission-requests/1/attachments/5/download/",
        },
      ],
      ...overrides,
    });

  it("shows the type, monthly usage and evidence, and downloads through the API", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(late());
    vi.mocked(
      permissionApi.downloadPermissionRequestAttachment,
    ).mockResolvedValue(undefined);

    render(<PermissionRequestDetailPage role="employee" />);

    expect(await screen.findByText("Late arrival")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 approved this month")).toBeInTheDocument();
    expect(screen.getByText("Evidence (1)")).toBeInTheDocument();
    expect(screen.getByText("Captured 2026-09-13 09:00")).toBeInTheDocument();
    expect(screen.queryByText("Download PDF")).not.toBeInTheDocument();
    expect(screen.queryByText("Exit type")).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="attachments"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download photo.jpg" }));
    await waitFor(() =>
      expect(
        permissionApi.downloadPermissionRequestAttachment,
      ).toHaveBeenCalledWith(1, expect.objectContaining({ id: 5 })),
    );
  });

  it("lets the owner add evidence while the request is pending", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(late());
    vi.mocked(permissionApi.addPermissionRequestAttachments).mockResolvedValue(
      late({ attachment_count: 2 }),
    );

    render(<PermissionRequestDetailPage role="employee" />);

    expect(await screen.findByText("Add evidence")).toBeInTheDocument();
    const pdf = new File(["%PDF"], "more.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("evidence-file-input"), {
      target: { files: [pdf] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Upload selected files" }),
    );

    await waitFor(() =>
      expect(
        permissionApi.addPermissionRequestAttachments,
      ).toHaveBeenCalledWith(1, [pdf], [undefined]),
    );
    expect(await screen.findByText("Evidence (2)")).toBeInTheDocument();
  });

  it("offers no evidence upload once the request is decided", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(
      late({
        status: "approved",
        workflow: { ...base.workflow, can_cancel: false },
      }),
    );

    render(<PermissionRequestDetailPage role="manager" />);

    expect(await screen.findByText("Evidence (1)")).toBeInTheDocument();
    expect(screen.queryByText("Add evidence")).not.toBeInTheDocument();
  });
});

describe("permission document integrity", () => {
  const approved = () =>
    response({
      status: "approved",
      workflow: { ...base.workflow, can_cancel: false },
    });

  it("gives HR the final card with seal retry and profile links", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(approved());
    render(<PermissionRequestDetailPage role="hr" />);
    const panel = await screen.findByTestId("integrity-panel");
    expect(panel).toHaveAttribute("data-type", "permission");
    expect(panel).toHaveAttribute("data-id", "1");
    expect(panel).toHaveAttribute("data-final", "true");
    expect(panel).toHaveAttribute("data-retry", "true");
    expect(panel).toHaveAttribute("data-profile", "/hr/employees/9");
  });

  it.each(["employee", "manager"] as const)(
    "keeps the %s card read-only with plain-text names",
    async (role) => {
      vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(
        approved(),
      );
      render(<PermissionRequestDetailPage role={role} />);
      const panel = await screen.findByTestId("integrity-panel");
      expect(panel).toHaveAttribute("data-final", "true");
      expect(panel).toHaveAttribute("data-retry", "false");
      expect(panel).toHaveAttribute("data-profile", "");
    },
  );

  it("is not final while the request is pending", async () => {
    render(<PermissionRequestDetailPage role="hr" />);
    expect(await screen.findByTestId("integrity-panel")).toHaveAttribute(
      "data-final",
      "false",
    );
  });

  it("explains a blocked (409) PDF download", async () => {
    vi.mocked(permissionApi.getPermissionRequest).mockResolvedValue(approved());
    vi.mocked(permissionApi.downloadPermissionRequestPdf).mockRejectedValue({
      response: { status: 409, data: new Blob(["{}"]) },
    });
    render(<PermissionRequestDetailPage role="employee" />);
    fireEvent.click(await screen.findByText("Download PDF"));
    expect(
      await screen.findByText(
        "This approved document failed its integrity check, so it cannot be downloaded. Contact HR.",
      ),
    ).toBeInTheDocument();
  });
});
