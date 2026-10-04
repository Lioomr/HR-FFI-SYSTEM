import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mocked at the HTTP boundary so the employee route's request URLs are visible.
vi.mock("../../services/api/apiClient", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import MyProfilePage from "./MyProfilePage";
import { api } from "../../services/api/apiClient";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const get = api.get as unknown as ReturnType<typeof vi.fn>;

const EMPLOYEE_URL = "/employees/me";
const SIGNATURE_URL = "/api/employees/me/signature/";
const PREVIEW_URL = "/api/employees/me/signature/preview/";

const employee = {
  id: 77,
  employee_id: "FFI-077",
  user_id: 12,
  full_name: "Omar Farouk",
  email: "omar@ffi.test",
  is_archived: false,
  position: "Site Engineer",
  department: "Operations",
  employment_status: "ACTIVE",
};

const storedSignature = {
  has_signature: true,
  uploaded_at: "2026-09-05T12:31:44+00:00",
  content_type: "image/png",
  size_bytes: 1180,
  preview_url: "/employees/77/signature/preview",
};

const envelope = (data: unknown) => ({ data: { status: "success", data } });

beforeEach(() => {
  get.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "12", email: "omar@ffi.test", role: "Employee" },
  });
  get.mockImplementation((url: string) => {
    if (url === EMPLOYEE_URL) return Promise.resolve(envelope(employee));
    if (url === SIGNATURE_URL)
      return Promise.resolve(envelope(storedSignature));
    if (url === PREVIEW_URL)
      return Promise.resolve({
        data: new Blob(["png"], { type: "image/png" }),
      });
    return Promise.resolve(envelope([]));
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:signature");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("MyProfilePage signature card", () => {
  it("still renders exactly one signature card on the employee route", async () => {
    render(
      <MemoryRouter initialEntries={["/employee/profile"]}>
        <Routes>
          <Route path="/employee/profile" element={<MyProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Signature")).toBeInTheDocument();
    expect(screen.getAllByText("Signature")).toHaveLength(1);
    expect(
      await screen.findByAltText("Your saved signature"),
    ).toBeInTheDocument();
    expect(get.mock.calls.filter((c) => c[0] === SIGNATURE_URL)).toHaveLength(
      1,
    );
  });

  it("keeps using the me alias and sends no profile id", async () => {
    render(
      <MemoryRouter initialEntries={["/employee/profile"]}>
        <Routes>
          <Route path="/employee/profile" element={<MyProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByAltText("Your saved signature");

    expect(get).toHaveBeenCalledWith(SIGNATURE_URL);
    expect(get).toHaveBeenCalledWith(PREVIEW_URL, { responseType: "blob" });
    for (const call of get.mock.calls) {
      expect(String(call[0])).not.toMatch(/\/employees\/\d+\//);
    }
  });
});

describe("MyProfilePage profile change requests", () => {
  const CHANGE_URL = "/api/employees/me/profile-change-requests/";
  const post = api.post as unknown as ReturnType<typeof vi.fn>;
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/employee/profile"]}>
        <Routes>
          <Route path="/employee/profile" element={<MyProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );
  const withRequests = (items: unknown[]) => {
    const base = get.getMockImplementation() as (
      url: string,
      config?: unknown,
    ) => unknown;
    get.mockImplementation((url: string, config?: unknown) => {
      if (url === EMPLOYEE_URL)
        return Promise.resolve(
          envelope({
            ...employee,
            passport_no: "A1234567",
            passport_expiry: "2027-01-01",
            national_id: "1098765432",
            id_expiry: "2028-02-02",
          }),
        );
      if (url === CHANGE_URL)
        return Promise.resolve(envelope({ items, total_pages: 1 }));
      return base(url, config);
    });
  };
  const request = (overrides: Record<string, unknown>) => ({
    id: 5,
    employee: { id: 77, full_name: "Omar Farouk", employee_number: "FFI-077" },
    status: "PENDING_HR",
    items: [
      {
        field: "passport_no",
        old: "A1234567",
        new: "B7654321",
        source: "ocr",
        decision: "pending",
        note: "",
      },
      {
        field: "mobile",
        old: "0500000000",
        new: "0511111111",
        source: "manual",
        decision: "pending",
        note: "",
      },
    ],
    attachments: [],
    decision_note: null,
    submitted_at: "2026-09-20T08:00:00Z",
    decided_at: null,
    decided_by_name: null,
    can_act: false,
    ...overrides,
  });

  beforeEach(() => {
    post.mockReset();
  });

  it("shows a pending request per field with its trail and lets the employee cancel it", async () => {
    withRequests([
      request({
        workflow: {
          status: "in_review",
          current_stage: "hr",
          history: [
            {
              id: 1,
              action: "submit",
              actor: { id: 12, full_name: "Omar Farouk" },
              at: "2026-09-20T08:00:00Z",
            },
          ],
        },
      }),
    ]);
    post.mockResolvedValue(envelope(request({ status: "CANCELLED" })));
    renderPage();

    expect(await screen.findByText(/Waiting for hr/i)).toBeInTheDocument();
    expect(screen.getByText("B7654321")).toBeInTheDocument();
    expect(screen.getByText("0511111111")).toBeInTheDocument();
    expect(screen.getByText("Read from document")).toBeInTheDocument();
    expect(screen.getByText("Approval trail")).toBeInTheDocument();
    // A pending request blocks a second one.
    expect(
      screen.getByRole("button", { name: /Request a change/ }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Update$/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`${CHANGE_URL}5/cancel/`),
    );
  });

  it("shows each field's outcome and the HR reason after a partial decision", async () => {
    withRequests([
      request({ id: 3, status: "CANCELLED", submitted_at: "2026-01-01" }),
      request({
        status: "PARTIALLY_APPROVED",
        items: [
          {
            field: "passport_no",
            old: "A1234567",
            new: "B7654321",
            source: "ocr",
            decision: "approved",
            note: "",
          },
          {
            field: "mobile",
            old: "0500000000",
            new: "0511111111",
            source: "manual",
            decision: "rejected",
            note: "Number is not registered to you",
          },
        ],
      }),
    ]);
    renderPage();
    expect(
      await screen.findByText("HR approved some of your changes."),
    ).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(
      screen.getByText(/Number is not registered to you/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Request a change/ }),
    ).toBeEnabled();
  });

  it("opens the change form from the passport card with current values", async () => {
    withRequests([]);
    renderPage();
    const [passportUpdate] = await screen.findAllByRole("button", {
      name: /Update$/,
    });
    fireEvent.click(passportUpdate);
    expect(await screen.findByLabelText(/^Passport number/)).toHaveValue(
      "A1234567",
    );
    expect(screen.getByLabelText(/^National ID number/)).toHaveValue(
      "1098765432",
    );
    expect(screen.getByLabelText(/^Full name/)).toHaveValue("Omar Farouk");
  });
});
