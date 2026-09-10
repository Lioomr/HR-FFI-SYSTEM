import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from "./apiClient";
import {
  deleteEmployeeDocument,
  reviewEmployeeDocument,
  type DeleteEmployeeDocumentResult,
  type EmployeeDocument,
} from "./employeesApi";
import { isApiError, type ApiResponse } from "./apiTypes";

const del = vi.mocked(api.delete);

describe("deleteEmployeeDocument", () => {
  beforeEach(() => {
    del.mockReset();
  });

  it("issues DELETE against the document detail route and returns the envelope", async () => {
    const payload: ApiResponse<DeleteEmployeeDocumentResult> = {
      status: "success",
      data: {
        id: 12,
        employee_profile_id: 7,
        document_type: "PASSPORT",
        original_filename: "passport.pdf",
        deleted: true,
      },
      message: "Document deleted permanently.",
    };
    del.mockResolvedValue({ data: payload } as never);

    const res = await deleteEmployeeDocument(7, 12);

    expect(del).toHaveBeenCalledWith("/api/employees/7/documents/12/");
    expect(isApiError(res)).toBe(false);
    if (!isApiError(res)) {
      expect(res.data.deleted).toBe(true);
      expect(res.data.original_filename).toBe("passport.pdf");
    }
  });

  it("propagates the rejection the shared client raises for a refused delete", async () => {
    const refusal = Object.assign(
      new Error("System-generated documents cannot be deleted."),
      { response: { status: 403 } },
    );
    del.mockRejectedValue(refusal);

    await expect(deleteEmployeeDocument(7, 12)).rejects.toBe(refusal);
  });
});

describe("reviewEmployeeDocument", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it("issues POST against the OCR review route and returns the updated document", async () => {
    const document = {
      id: 12,
      employee_profile_id: 7,
      document_type: "PASSPORT",
      display_name: "Passport",
      original_filename: "passport.pdf",
      extraction_status: "partial",
      ocr_reviewed_at: "2026-09-10T09:30:00Z",
      ocr_reviewed_by: 5,
      created_at: "2026-09-10T08:00:00Z",
      updated_at: "2026-09-10T09:30:00Z",
    } satisfies EmployeeDocument;
    const payload: ApiResponse<EmployeeDocument> = {
      status: "success",
      data: document,
    };
    vi.mocked(api.post).mockResolvedValue({ data: payload } as never);

    const res = await reviewEmployeeDocument(7, 12);

    expect(api.post).toHaveBeenCalledWith(
      "/api/employees/7/documents/12/review/",
    );
    expect(isApiError(res)).toBe(false);
    if (!isApiError(res)) expect(res.data.ocr_reviewed_by).toBe(5);
  });
});
