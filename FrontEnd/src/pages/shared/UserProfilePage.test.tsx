import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Mocked at the HTTP boundary rather than at the service layer, so the tests
// assert the exact URLs that leave the app: only the `me` aliases, never a
// profile identifier.
vi.mock("../../services/api/apiClient", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import UserProfilePage from "./UserProfilePage";
import { api } from "../../services/api/apiClient";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const del = api.delete as unknown as ReturnType<typeof vi.fn>;

const EMPLOYEE_URL = "/employees/me";
const SIGNATURE_URL = "/api/employees/me/signature/";
const PREVIEW_URL = "/api/employees/me/signature/preview/";

const employee = {
  id: 42,
  employee_id: "FFI-042",
  user_id: 9,
  full_name: "Noura Al-Qahtani",
  email: "hr@ffi.test",
  is_archived: false,
  position: "HR Manager",
  department: "Human Resources",
  employment_status: "ACTIVE",
  passport: "A1234567",
  national_id: "1098765432",
};

const basicUser = {
  id: 3,
  email: "admin@ffi.test",
  full_name: "Systems Admin",
  role: "SystemAdmin",
  is_active: true,
};

const storedSignature = {
  has_signature: true,
  uploaded_at: "2026-09-05T12:31:44+00:00",
  content_type: "image/png",
  size_bytes: 1180,
  preview_url: "/employees/42/signature/preview",
};

const noSignature = {
  has_signature: false,
  uploaded_at: null,
  content_type: null,
  size_bytes: null,
  preview_url: null,
};

const envelope = (data: unknown) => ({
  data: { status: "success", data },
});

const notFound = () => {
  const error = new Error("Profile not found.") as Error & {
    response: { status: number };
  };
  error.response = { status: 404 };
  return error;
};

/** Routes GET by URL so each test only overrides what it cares about. */
function stubGet({
  employeeResult = envelope(employee),
  signature = noSignature,
  previewFails = false,
}: {
  employeeResult?: unknown;
  signature?: typeof noSignature | typeof storedSignature;
  previewFails?: boolean;
} = {}) {
  get.mockImplementation((url: string) => {
    if (url === EMPLOYEE_URL) {
      return employeeResult instanceof Error
        ? Promise.reject(employeeResult)
        : Promise.resolve(employeeResult);
    }
    if (url === SIGNATURE_URL) return Promise.resolve(envelope(signature));
    if (url === PREVIEW_URL) {
      return previewFails
        ? Promise.reject(notFound())
        : Promise.resolve({ data: new Blob(["png"], { type: "image/png" }) });
    }
    if (url === "/auth/me") return Promise.resolve(envelope(basicUser));
    return Promise.resolve(envelope([]));
  });
}

/** Every URL this render actually requested, in call order. */
function requestedUrls(): string[] {
  return [
    ...get.mock.calls.map((call) => String(call[0])),
    ...post.mock.calls.map((call) => String(call[0])),
    ...del.mock.calls.map((call) => String(call[0])),
  ];
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<UserProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function selectFile(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function pngFile(name = "signature.png", size = 1180): File {
  const file = new File(["png-bytes"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const asHr = () =>
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "9", email: "hr@ffi.test", role: "HRManager" },
  });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  useI18nStore.getState().setLanguage("en");
  asHr();
  stubGet();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:signature");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("UserProfilePage signature card", () => {
  it("renders the signature card on the HR profile route", async () => {
    renderAt("/hr/profile");

    expect(await screen.findByText("Signature")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Upload signature/ }),
    ).toBeInTheDocument();
  });

  it("gives an HRManager the upload UI for their own signature", async () => {
    renderAt("/hr/profile");

    await screen.findByText("Signature");
    expect(useAuthStore.getState().user?.role).toBe("HRManager");
    expect(await screen.findByText("No signature saved")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Upload signature/ }),
    ).toBeInTheDocument();
  });

  it("reads state through the me alias and never a profile id", async () => {
    stubGet({ signature: storedSignature });

    renderAt("/hr/profile");
    await screen.findByAltText("Your saved signature");

    expect(get).toHaveBeenCalledWith(SIGNATURE_URL);
    expect(get).toHaveBeenCalledWith(PREVIEW_URL, { responseType: "blob" });
    for (const url of requestedUrls()) {
      expect(url).not.toMatch(/\/employees\/\d+\//);
    }
  });

  it("renders exactly one signature card, not a duplicate", async () => {
    renderAt("/hr/profile");

    // The card label renders before its stored-signature GET resolves, so the
    // control must be awaited; asserting synchronously here raced the load.
    await screen.findByText("Signature");
    expect(
      await screen.findAllByRole("button", { name: /Upload signature/ }),
    ).toHaveLength(1);
    expect(screen.getAllByText("Signature")).toHaveLength(1);
    expect(get.mock.calls.filter((c) => c[0] === SIGNATURE_URL)).toHaveLength(
      1,
    );
  });

  it("uploads to the me alias and shows the preview", async () => {
    renderAt("/hr/profile");
    await screen.findByText("No signature saved");

    // The reload after a successful upload must see the stored state.
    stubGet({ signature: storedSignature });
    post.mockResolvedValue(envelope(storedSignature));
    selectFile(pngFile());

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe(SIGNATURE_URL);
    expect((body as FormData).get("signature")).toBeInstanceOf(File);
    expect(config).toEqual({
      headers: { "Content-Type": "multipart/form-data" },
    });
    expect(
      await screen.findByAltText("Your saved signature"),
    ).toBeInTheDocument();
  });

  it("offers replace and delete once a signature is stored", async () => {
    stubGet({ signature: storedSignature });

    renderAt("/hr/profile");
    await screen.findByAltText("Your saved signature");

    expect(screen.getByRole("button", { name: /Replace/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    del.mockResolvedValue(envelope(noSignature));
    stubGet({ signature: noSignature });
    fireEvent.click(await screen.findByRole("button", { name: /^Yes$/ }));

    await waitFor(() => expect(del).toHaveBeenCalledWith(SIGNATURE_URL));
    expect(await screen.findByText("No signature saved")).toBeInTheDocument();
  });

  it("keeps the page usable for a user with no employee profile", async () => {
    stubGet({ employeeResult: notFound() });

    renderAt("/admin/profile");

    // The basic-user branch renders, and no signature request is made for a
    // caller who has no EmployeeProfile to hold one.
    expect(await screen.findByText("Systems Admin")).toBeInTheDocument();
    expect(screen.queryByText("Signature")).toBeNull();
    expect(get.mock.calls.map((c) => c[0])).not.toContain(SIGNATURE_URL);
  });

  it("renders Arabic signature labels on the shared profile", async () => {
    useI18nStore.getState().setLanguage("ar");

    renderAt("/hr/profile");

    expect(await screen.findByText("التوقيع")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /رفع التوقيع/ }),
    ).toBeInTheDocument();
  });
});

describe("UserProfilePage document archive", () => {
  /**
   * The shared profile is reachable by ordinary employees, so its archive must
   * offer no management controls even though it stays writable for uploads.
   * The backend refuses delete and OCR re-run for these roles anyway; showing
   * the buttons would only produce a 403.
   */
  const archivedDocument = {
    id: 5,
    employee_profile_id: 42,
    document_type: "PASSPORT",
    display_name: "Passport",
    original_filename: "passport-scan.pdf",
    extraction_status: "failed",
    extraction_error: "OCR failed",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };

  function stubGetWithDocument() {
    // vi.fn() infers a union that may be constructable rather than callable, so
    // the saved implementation is narrowed to a plain function before it is called.
    const inner = get.getMockImplementation() as
      | ((url: string, config?: unknown) => unknown)
      | undefined;
    get.mockImplementation((url: string, config?: unknown) => {
      if (String(url).endsWith("/documents/")) {
        return Promise.resolve({
          data: { status: "success", data: [archivedDocument] },
        });
      }
      return inner?.(url, config);
    });
  }

  async function openArchiveTab() {
    fireEvent.click(await screen.findByText("Document Archive"));
    return await screen.findByText("passport-scan.pdf");
  }

  it("offers no delete or OCR retry to an employee on their own profile", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "9", email: "employee@ffi.test", role: "Employee" },
    });
    stubGetWithDocument();

    renderAt("/profile");
    await openArchiveTab();

    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run OCR extraction" }),
    ).not.toBeInTheDocument();
    // Reading and uploading remain available.
    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();
  });

  it("withholds the management controls even from an HR manager on this shared page", async () => {
    // The capability belongs to the HR employee-record page, not to the
    // self-service profile, so this mount never grants it.
    stubGetWithDocument();

    renderAt("/hr/profile");
    await openArchiveTab();

    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run OCR extraction" }),
    ).not.toBeInTheDocument();
  });
});
