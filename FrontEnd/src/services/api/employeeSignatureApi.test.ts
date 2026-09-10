import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "./apiClient";
import {
  SIGNATURE_ACCEPT,
  SIGNATURE_MAX_SIZE_BYTES,
  deleteMySignature,
  getMySignature,
  getMySignaturePreview,
  uploadMySignature,
  validateSignatureFile,
  type EmployeeSignatureState,
} from "./employeeSignatureApi";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const del = api.delete as unknown as ReturnType<typeof vi.fn>;

const state: EmployeeSignatureState = {
  has_signature: true,
  uploaded_at: "2026-09-05T12:31:44+00:00",
  content_type: "image/png",
  size_bytes: 1180,
  preview_url: "/employees/42/signature/preview",
};

function fileOf(
  name: string,
  type: string,
  size = 1024,
  bytes = new Uint8Array(0),
): File {
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
});

describe("employeeSignatureApi routes", () => {
  it("reads the caller's state through the me alias", async () => {
    get.mockResolvedValue({ data: { status: "success", data: state } });

    await expect(getMySignature()).resolves.toEqual({
      status: "success",
      data: state,
    });
    expect(get).toHaveBeenCalledWith("/api/employees/me/signature/");
  });

  it("posts multipart form data under the signature field", async () => {
    post.mockResolvedValue({ data: { status: "success", data: state } });
    const file = fileOf("signature.png", "image/png");

    await uploadMySignature(file);

    const [url, form, config] = post.mock.calls[0];
    expect(url).toBe("/api/employees/me/signature/");
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("signature")).toBe(file);
    expect(config).toEqual({
      headers: { "Content-Type": "multipart/form-data" },
    });
  });

  it("never sets the auth or active-company headers itself", async () => {
    post.mockResolvedValue({ data: { status: "success", data: state } });

    await uploadMySignature(fileOf("signature.png", "image/png"));

    const headers = post.mock.calls[0][2].headers as Record<string, unknown>;
    expect(Object.keys(headers)).toEqual(["Content-Type"]);
  });

  it("deletes through the me alias", async () => {
    del.mockResolvedValue({
      data: { status: "success", data: { ...state, has_signature: false } },
    });

    await deleteMySignature();

    expect(del).toHaveBeenCalledWith("/api/employees/me/signature/");
  });

  it("fetches the preview as an authenticated blob", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    get.mockResolvedValue({ data: blob });

    await expect(getMySignaturePreview()).resolves.toBe(blob);
    expect(get).toHaveBeenCalledWith("/api/employees/me/signature/preview/", {
      responseType: "blob",
    });
  });
});

describe("validateSignatureFile", () => {
  it("accepts the raster formats the backend stores", () => {
    expect(validateSignatureFile(fileOf("sig.png", "image/png"))).toBeNull();
    expect(validateSignatureFile(fileOf("sig.jpg", "image/jpeg"))).toBeNull();
    expect(validateSignatureFile(fileOf("SIG.JPEG", "image/jpeg"))).toBeNull();
  });

  it("refuses SVG, PDF, and other arbitrary types", () => {
    expect(validateSignatureFile(fileOf("sig.svg", "image/svg+xml"))).toBe(
      "type",
    );
    expect(validateSignatureFile(fileOf("sig.pdf", "application/pdf"))).toBe(
      "type",
    );
    expect(validateSignatureFile(fileOf("sig", ""))).toBe("type");
  });

  it("refuses a PNG extension carrying a mismatched content type", () => {
    expect(validateSignatureFile(fileOf("sig.png", "application/pdf"))).toBe(
      "type",
    );
  });

  it("refuses an empty file and one over 2 MB", () => {
    expect(validateSignatureFile(fileOf("sig.png", "image/png", 0))).toBe(
      "empty",
    );
    expect(
      validateSignatureFile(
        fileOf("sig.png", "image/png", SIGNATURE_MAX_SIZE_BYTES + 1),
      ),
    ).toBe("size");
    expect(
      validateSignatureFile(
        fileOf("sig.png", "image/png", SIGNATURE_MAX_SIZE_BYTES),
      ),
    ).toBeNull();
  });

  it("offers a file picker filter that excludes SVG and PDF", () => {
    expect(SIGNATURE_ACCEPT).toBe(
      ".png,.jpg,.jpeg,image/png,image/jpeg,image/jpg",
    );
    expect(SIGNATURE_ACCEPT).not.toContain("svg");
    expect(SIGNATURE_ACCEPT).not.toContain("pdf");
  });
});
