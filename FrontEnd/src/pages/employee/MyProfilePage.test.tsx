import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
