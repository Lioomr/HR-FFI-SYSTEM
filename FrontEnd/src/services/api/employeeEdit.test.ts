import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./apiClient", () => ({ api: { patch: vi.fn() } }));
import { api } from "./apiClient";
import { editLeaveRequest } from "./leaveApi";
import { editPermissionRequest } from "./permissionRequestsApi";

beforeEach(() => vi.clearAllMocks());

describe("employee edit clients", () => {
  it("PATCHes leave edits as JSON and returns the envelope untouched", async () => {
    const envelope = { status: "success", data: { id: 7 } };
    vi.mocked(api.patch).mockResolvedValue({ data: envelope });
    const result = await editLeaveRequest(7, {
      reason: "New reason",
      start_date: "2026-11-01",
      date_of_rejoin: null,
    });
    expect(result).toEqual(envelope);
    expect(api.patch).toHaveBeenCalledWith(
      "/api/leaves/leave-requests/7/edit/",
      {
        reason: "New reason",
        start_date: "2026-11-01",
        date_of_rejoin: null,
      },
    );
  });

  it("sends multipart form data only when a document is attached", async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { status: "success" } });
    const file = new File(["x"], "note.pdf", { type: "application/pdf" });
    await editLeaveRequest("7", {
      reason: "With file",
      will_travel: false,
      document: file,
    });
    const [url, body, config] = vi.mocked(api.patch).mock.calls[0];
    expect(url).toBe("/api/leaves/leave-requests/7/edit/");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("reason")).toBe("With file");
    expect((body as FormData).get("will_travel")).toBe("false");
    expect((body as FormData).get("document")).toBeInstanceOf(File);
    expect(config).toEqual({
      headers: { "Content-Type": "multipart/form-data" },
    });
  });

  it("PATCHes permission edits as JSON to the permission base path", async () => {
    const envelope = { status: "success", data: { id: 9 } };
    vi.mocked(api.patch).mockResolvedValue({ data: envelope });
    expect(await editPermissionRequest(9, { reason: "Updated" })).toEqual(
      envelope,
    );
    expect(api.patch).toHaveBeenCalledWith("/api/permission-requests/9/edit/", {
      reason: "Updated",
    });
  });

  it("preserves error envelopes and HTTP rejections", async () => {
    const envelope = { status: "error", message: "Not editable." };
    vi.mocked(api.patch).mockResolvedValue({ data: envelope });
    expect(await editLeaveRequest(7, { reason: "x" })).toEqual(envelope);
    const error = { response: { status: 422, data: envelope } };
    vi.mocked(api.patch).mockRejectedValue(error);
    await expect(editPermissionRequest(9, { reason: "x" })).rejects.toEqual(
      error,
    );
  });
});
