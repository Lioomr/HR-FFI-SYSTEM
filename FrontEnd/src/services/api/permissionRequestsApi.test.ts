import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../utils/download", () => ({ downloadBlob: vi.fn() }));

import { api } from "./apiClient";
import { downloadBlob } from "../../utils/download";
import {
  addPermissionRequestAttachments,
  cancelPermissionRequest,
  createPermissionRequest,
  decidePermissionRequest,
  downloadPermissionRequestAttachment,
  downloadPermissionRequestPdf,
  getHrPermissionRequests,
  getManagerPermissionRequests,
  getMyPermissionRequests,
  getPermissionRequest,
  parseCaptureMetadata,
} from "./permissionRequestsApi";

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

/** FormData parts in order, with files shown by name. */
function parts(body: unknown) {
  return Array.from((body as FormData).entries()).map(([key, value]) => [
    key,
    typeof value === "string" ? value : (value as File).name,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockResolvedValue({
    data: { status: "success", data: {} },
  });
});

describe("permission request API contract", () => {
  it("uses the documented employee, manager, and HR routes", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { status: "success", data: {} },
    });
    await getMyPermissionRequests();
    await getManagerPermissionRequests();
    await getHrPermissionRequests();
    await getPermissionRequest(7);
    await cancelPermissionRequest(7);
    await decidePermissionRequest(7, "manager", "approve", "Looks good");
    await decidePermissionRequest(7, "hr", "reject");
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual([
      "/api/permission-requests/",
      "/api/permission-requests/manager/",
      "/api/permission-requests/hr/",
      "/api/permission-requests/7/",
    ]);
    expect(vi.mocked(api.post).mock.calls.map(([path]) => path)).toEqual([
      "/api/permission-requests/7/cancel/",
      "/api/permission-requests/7/manager-approve/",
      "/api/permission-requests/7/hr-reject/",
    ]);
  });

  it("sends minute-formatted create data and downloads PDFs as blobs", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: new Blob(["pdf"], { type: "application/pdf" }),
    });
    await createPermissionRequest({
      request_date: "2026-09-12",
      from_time: "09:00",
      to_time: "10:30",
      exit_type: "personal",
      reason: "Appointment",
      duration_minutes: 90,
    });
    await downloadPermissionRequestPdf(4);
    expect(vi.mocked(api.post).mock.calls[0]).toEqual([
      "/api/permission-requests/",
      {
        request_date: "2026-09-12",
        from_time: "09:00",
        to_time: "10:30",
        exit_type: "personal",
        reason: "Appointment",
        duration_minutes: 90,
      },
    ]);
    expect(vi.mocked(api.get).mock.calls[0]).toEqual([
      "/api/permission-requests/4/pdf/",
      { responseType: "blob" },
    ]);
  });
});

describe("permission evidence contract", () => {
  const pdf = new File(["%PDF"], "evidence.pdf", { type: "application/pdf" });
  const photo = new File(["img"], "photo.jpg", { type: "image/jpeg" });
  const camera = {
    source: "camera",
    captured_at: "2026-09-14T06:00:00.000Z",
  };

  it("creates a Late request as multipart with aligned metadata parts", async () => {
    await createPermissionRequest({
      permission_type: "late",
      request_date: "2026-09-14",
      reason: "Road closure",
      attachments: [pdf, photo],
      attachment_metadata: [undefined, camera],
    });

    const [path, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe("/api/permission-requests/");
    expect(body).toBeInstanceOf(FormData);
    expect(config).toEqual(MULTIPART);
    expect(parts(body)).toEqual([
      ["permission_type", "late"],
      ["request_date", "2026-09-14"],
      ["reason", "Road closure"],
      ["attachments", "evidence.pdf"],
      ["attachments", "photo.jpg"],
      ["attachment_metadata", "{}"],
      ["attachment_metadata", JSON.stringify(camera)],
    ]);
  });

  it("omits metadata parts when no file carries any", async () => {
    await createPermissionRequest({
      permission_type: "late",
      request_date: "2026-09-14",
      reason: "Road closure",
      attachments: [pdf],
      attachment_metadata: [undefined],
    });
    expect(parts(vi.mocked(api.post).mock.calls[0][1])).toEqual([
      ["permission_type", "late"],
      ["request_date", "2026-09-14"],
      ["reason", "Road closure"],
      ["attachments", "evidence.pdf"],
    ]);
  });

  it("keeps an evidence-free During Shift request as JSON", async () => {
    await createPermissionRequest({
      permission_type: "during_shift",
      request_date: "2026-09-14",
      from_time: "10:00",
      to_time: "11:00",
      reason: "Bank",
      attachments: [],
      attachment_metadata: [],
    });
    expect(vi.mocked(api.post).mock.calls[0]).toEqual([
      "/api/permission-requests/",
      {
        permission_type: "during_shift",
        request_date: "2026-09-14",
        from_time: "10:00",
        to_time: "11:00",
        reason: "Bank",
      },
    ]);
  });

  it("adds attachments to an existing request as multipart", async () => {
    await addPermissionRequestAttachments(7, [photo], [camera]);
    const [path, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe("/api/permission-requests/7/attachments/");
    expect(config).toEqual(MULTIPART);
    expect(parts(body)).toEqual([
      ["attachments", "photo.jpg"],
      ["attachment_metadata", JSON.stringify(camera)],
    ]);
  });

  it("downloads evidence through apiClient as a blob and saves it", async () => {
    const blob = new Blob(["%PDF"], { type: "application/octet-stream" });
    vi.mocked(api.get).mockResolvedValue({ data: blob });

    await downloadPermissionRequestAttachment(7, {
      id: 3,
      original_filename: "evidence.pdf",
      download_url: "/api/permission-requests/7/attachments/3/download/",
    });

    expect(api.get).toHaveBeenCalledWith(
      "/api/permission-requests/7/attachments/3/download/",
      { responseType: "blob" },
    );
    expect(downloadBlob).toHaveBeenCalledWith(blob, "evidence.pdf");
  });

  it("never sends credentials to a download URL outside the API route", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: new Blob(["x"]) });

    await downloadPermissionRequestAttachment(7, {
      id: 3,
      original_filename: "evidence.pdf",
      download_url: "https://files.example.com/evidence.pdf",
    });

    expect(vi.mocked(api.get).mock.calls[0][0]).toBe(
      "/api/permission-requests/7/attachments/3/download/",
    );
  });

  it("sends no company selector on any evidence call", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: new Blob(["x"]) });
    await addPermissionRequestAttachments(7, [pdf]);
    await downloadPermissionRequestAttachment(7, {
      id: 3,
      original_filename: "evidence.pdf",
      download_url: "/api/permission-requests/7/attachments/3/download/",
    });
    const calls = [
      ...vi.mocked(api.post).mock.calls,
      ...vi.mocked(api.get).mock.calls,
    ];
    for (const call of calls) {
      expect(JSON.stringify(call.slice(2))).not.toMatch(/company/i);
      expect(String(call[0])).not.toMatch(/company/i);
    }
  });

  it("reads capture metadata sent back as an object or as JSON text", () => {
    expect(parseCaptureMetadata(camera)).toEqual(camera);
    expect(parseCaptureMetadata(JSON.stringify(camera))).toEqual(camera);
    expect(parseCaptureMetadata("not json")).toBeNull();
    expect(parseCaptureMetadata("[1]")).toBeNull();
    expect(parseCaptureMetadata(null)).toBeNull();
  });
});
