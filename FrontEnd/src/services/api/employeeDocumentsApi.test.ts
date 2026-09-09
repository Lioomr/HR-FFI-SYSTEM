import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from "./apiClient";
import {
  deleteEmployeeDocument,
  type DeleteEmployeeDocumentResult,
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
