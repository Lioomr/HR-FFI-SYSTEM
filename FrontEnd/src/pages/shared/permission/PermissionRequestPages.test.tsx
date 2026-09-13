import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  return { ...actual, getPermissionRequest: vi.fn() };
});

const base: PermissionRequest = {
  id: 1,
  reference_no: "PERM-20260912-0001",
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
    expect(await screen.findByText("Skipped")).toBeInTheDocument();
    expect(
      screen.getByText("Not required for this employee"),
    ).toBeInTheDocument();
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
    expect(screen.getByText("HR Reviewer")).toBeInTheDocument();
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
