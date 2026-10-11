import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  window.localStorage.clear();
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

  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * DAY).toISOString();
  const partiallyApproved = (overrides: Record<string, unknown> = {}) =>
    request({
      status: "PARTIALLY_APPROVED",
      decided_at: daysAgo(2),
      decision_note: "Mobile could not be verified",
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
      ...overrides,
    });

  it("shows a recent decision as a one-line banner with details on demand", async () => {
    withRequests([
      request({ id: 3, status: "CANCELLED", submitted_at: "2026-01-01" }),
      partiallyApproved(),
    ]);
    renderPage();
    expect(
      await screen.findByText("HR approved some of your changes."),
    ).toBeInTheDocument();
    // Collapsed: no per-field list and no cancel on the page itself.
    expect(screen.queryByText("0511111111")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Request a change/ }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Change request details"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Approved")).toBeInTheDocument();
    expect(within(dialog).getByText("Rejected")).toBeInTheDocument();
    expect(within(dialog).getByText("0511111111")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Number is not registered to you/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Mobile could not be verified"),
    ).toBeInTheDocument();
  });

  it("hides a decision older than the display window", async () => {
    withRequests([partiallyApproved({ decided_at: daysAgo(8) })]);
    renderPage();
    await screen.findByRole("button", { name: /Change request history/ });
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(CHANGE_URL, expect.anything()),
    );
    expect(screen.queryByText("HR approved some of your changes.")).toBeNull();
    expect(screen.queryByText("My change request")).toBeNull();
  });

  it("remembers a dismissed decision across visits", async () => {
    withRequests([partiallyApproved()]);
    const { unmount } = renderPage();
    await screen.findByText("HR approved some of your changes.");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(
        screen.queryByText("HR approved some of your changes."),
      ).toBeNull(),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem("ffi_profile_change_dismissed") || "[]",
      ),
    ).toEqual([5]);

    unmount();
    renderPage();
    await screen.findByRole("button", { name: /Change request history/ });
    await waitFor(() =>
      expect(
        get.mock.calls.filter((call) => call[0] === CHANGE_URL),
      ).toHaveLength(2),
    );
    expect(screen.queryByText("HR approved some of your changes.")).toBeNull();
  });

  it("still works when browser storage is unavailable", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      withRequests([partiallyApproved()]);
      renderPage();
      await screen.findByText("HR approved some of your changes.");
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      await waitFor(() =>
        expect(
          screen.queryByText("HR approved some of your changes."),
        ).toBeNull(),
      );
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("lists every request newest first in the history drawer", async () => {
    withRequests([
      request({
        id: 3,
        reference_no: "PCR-0003",
        status: "CANCELLED",
        submitted_at: "2026-01-01T08:00:00Z",
      }),
      partiallyApproved({
        id: 4,
        reference_no: "PCR-0004",
        submitted_at: "2026-03-01T08:00:00Z",
        decided_at: "2026-03-02T08:00:00Z",
      }),
      request({
        id: 2,
        reference_no: "PCR-0002",
        status: "REJECTED",
        submitted_at: "2025-12-01T08:00:00Z",
        decided_at: "2025-12-02T08:00:00Z",
      }),
    ]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /Change request history/ }),
    );
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("My change requests")).toBeVisible();
    const references = within(drawer)
      .getAllByText(/^PCR-000\d$/)
      .map((node) => node.textContent);
    expect(references).toEqual(["PCR-0004", "PCR-0003", "PCR-0002"]);
    expect(within(drawer).getByText("Partially approved")).toBeInTheDocument();
    expect(within(drawer).getByText("Cancelled")).toBeInTheDocument();
    expect(within(drawer).getAllByText("B7654321").length).toBe(3);
  });

  it("shows an empty history when the employee never sent a request", async () => {
    withRequests([]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /Change request history/ }),
    );
    expect(
      await screen.findByText("No change requests yet"),
    ).toBeInTheDocument();
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
