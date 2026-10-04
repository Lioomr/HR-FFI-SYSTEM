import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./apiClient";
import {
  cancelProfileChangeRequest,
  decideProfileChangeRequest,
  getHrProfileChangeRequests,
  getProfileChangeAttachment,
  getProfileChangeAttachmentFile,
  isExtractionTerminal,
  submitProfileChangeRequest,
  uploadProfileChangeAttachment,
  validateProfileChangeFile,
} from "./employeeProfileChangeRequestsApi";

vi.mock("./apiClient", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const ok = { data: { status: "success", data: {} } };
const ME = "/api/employees/me/profile-change-requests/";
const HR = "/api/employees/profile-change-requests/";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue(ok);
  vi.mocked(api.post).mockResolvedValue(ok);
});

describe("employee profile change requests API", () => {
  it("uploads a document as multipart and polls it by id", async () => {
    const file = new File(["%PDF"], "passport.pdf", {
      type: "application/pdf",
    });
    await uploadProfileChangeAttachment("PASSPORT", file);
    const [url, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe(`${ME}attachments/`);
    expect(config).toEqual({
      headers: { "Content-Type": "multipart/form-data" },
    });
    expect((body as FormData).get("document_type")).toBe("PASSPORT");
    expect((body as FormData).get("file")).toBeInstanceOf(File);

    await getProfileChangeAttachment(41);
    expect(api.get).toHaveBeenCalledWith(`${ME}attachments/41/`);
  });

  it("submits items and attachment ids as JSON and cancels by id", async () => {
    await submitProfileChangeRequest({
      items: { mobile: "0511111111" },
      attachment_ids: [41],
    });
    expect(api.post).toHaveBeenCalledWith(ME, {
      items: { mobile: "0511111111" },
      attachment_ids: [41],
    });
    await cancelProfileChangeRequest(5);
    expect(api.post).toHaveBeenLastCalledWith(`${ME}5/cancel/`);
  });

  it("uses the HR routes for the queue, decisions and files", async () => {
    await getHrProfileChangeRequests({ status: "PARTIALLY_APPROVED" });
    expect(api.get).toHaveBeenCalledWith(HR, {
      params: { status: "PARTIALLY_APPROVED" },
    });
    await decideProfileChangeRequest(9, [
      { field: "mobile", decision: "reject", note: "Wrong number" },
    ]);
    expect(api.post).toHaveBeenCalledWith(`${HR}9/decide/`, {
      decisions: [
        { field: "mobile", decision: "reject", note: "Wrong number" },
      ],
    });
    await getProfileChangeAttachmentFile(9, 41, "hr");
    expect(api.get).toHaveBeenLastCalledWith(`${HR}9/attachments/41/file/`, {
      responseType: "blob",
    });
    await getProfileChangeAttachmentFile(9, 41, "me");
    expect(api.get).toHaveBeenLastCalledWith(`${ME}9/attachments/41/file/`, {
      responseType: "blob",
    });
  });

  it("treats only finished extraction states as terminal", () => {
    expect(isExtractionTerminal("success")).toBe(true);
    expect(isExtractionTerminal("partial")).toBe(true);
    expect(isExtractionTerminal("failed")).toBe(true);
    expect(isExtractionTerminal("not_applicable")).toBe(true);
    expect(isExtractionTerminal("pending")).toBe(false);
    expect(isExtractionTerminal("")).toBe(false);
  });

  it("rejects unsupported, empty and oversized files before upload", () => {
    const make = (name: string, size: number) =>
      new File([new Uint8Array(size)], name);
    expect(validateProfileChangeFile(make("scan.gif", 10))).toBe("type");
    expect(validateProfileChangeFile(make("scan.pdf", 0))).toBe("empty");
    expect(validateProfileChangeFile(make("scan.PNG", 6 * 1024 * 1024))).toBe(
      "size",
    );
    expect(validateProfileChangeFile(make("scan.jpeg", 10))).toBeNull();
  });
});
