import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

import { api } from "./apiClient";
import {
  MAX_CV_SIZE_BYTES,
  approveHiringRequest,
  createHiringRequest,
  downloadHiringRequestCv,
  listHiringRequests,
  rejectHiringRequest,
  submitHiringRequest,
  updateHiringRequest,
} from "./hiringRequestsApi";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;
const patch = api.patch as unknown as ReturnType<typeof vi.fn>;

const ok = { data: { status: "success", data: {} } };

function cv(name = "cv.pdf") {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

beforeEach(() => {
  get.mockReset().mockResolvedValue(ok);
  post.mockReset().mockResolvedValue(ok);
  patch.mockReset().mockResolvedValue(ok);
});

describe("hiringRequestsApi", () => {
  it("forwards list filters as query params", async () => {
    await listHiringRequests({ status: "submitted", search: "nora", page: 2, page_size: 25 });

    expect(get).toHaveBeenCalledWith("/hiring-requests/", {
      params: { status: "submitted", search: "nora", page: 2, page_size: 25 },
    });
  });

  it("creates as multipart with the CV under cv_file", async () => {
    const file = cv();
    await createHiringRequest({
      candidate_full_name: "Nora Khalid",
      proposed_salary: "12000",
      cv_file: file,
    });

    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe("/hiring-requests/");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("cv_file")).toBe(file);
    expect((body as FormData).get("candidate_full_name")).toBe("Nora Khalid");
    expect((body as FormData).get("proposed_salary")).toBe("12000");
    expect(config).toEqual({ headers: { "Content-Type": "multipart/form-data" } });
  });

  it("omits fields that were not supplied rather than sending empty strings", async () => {
    await createHiringRequest({ candidate_full_name: "Nora Khalid", cv_file: null });

    const body = post.mock.calls[0][1] as FormData;
    expect(body.get("cv_file")).toBeNull();
    expect(body.has("nationality")).toBe(false);
  });

  it("patches as multipart only when a replacement CV is attached", async () => {
    const file = cv();
    await updateHiringRequest(7, { candidate_full_name: "Nora K", cv_file: file });

    expect(patch.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(patch.mock.calls[0][2]).toEqual({
      headers: { "Content-Type": "multipart/form-data" },
    });
  });

  it("patches as JSON when no CV changes, so the stored file is left alone", async () => {
    await updateHiringRequest(7, { candidate_full_name: "Nora K" });

    const [url, body, config] = patch.mock.calls[0];
    expect(url).toBe("/hiring-requests/7/");
    expect(body).toEqual({ candidate_full_name: "Nora K" });
    expect(body).not.toHaveProperty("cv_file");
    expect(config).toBeUndefined();
  });

  it("posts decisions to the matching endpoint with a note", async () => {
    await submitHiringRequest(3);
    await approveHiringRequest(3, { note: "Go ahead" });
    await rejectHiringRequest(3, { note: "Budget frozen" });

    expect(post).toHaveBeenNthCalledWith(1, "/hiring-requests/3/submit/", {});
    expect(post).toHaveBeenNthCalledWith(2, "/hiring-requests/3/approve/", { note: "Go ahead" });
    expect(post).toHaveBeenNthCalledWith(3, "/hiring-requests/3/reject/", { note: "Budget frozen" });
  });

  it("sends an empty note rather than undefined when approval carries none", async () => {
    await approveHiringRequest(3);

    expect(post).toHaveBeenCalledWith("/hiring-requests/3/approve/", { note: "" });
  });

  it("fetches the CV as a blob from the same-origin path", async () => {
    get.mockResolvedValue({ data: new Blob(["cv"]) });

    await downloadHiringRequestCv(9);

    expect(get).toHaveBeenCalledWith("/hiring-requests/9/cv/", { responseType: "blob" });
  });

  it("mirrors the backend's 5 MB CV ceiling", () => {
    expect(MAX_CV_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});
