import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from "./apiClient";
import {
  acknowledgmentPdfFilename,
  approveStartingWorkAcknowledgment,
  downloadStartingWorkAcknowledgmentPdf,
  getStartingWorkAcknowledgment,
  historyEntryActorName,
  historyEntryTimestamp,
  listStartingWorkAcknowledgments,
  rejectStartingWorkAcknowledgment,
  resolveAcknowledgmentDocumentPath,
  workflowActorName,
} from "./startingWorkAcknowledgmentsApi";

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const envelope = { data: { status: "success", data: {} } };

beforeEach(() => {
  get.mockReset().mockResolvedValue(envelope as never);
  post.mockReset().mockResolvedValue(envelope as never);
});

describe("startingWorkAcknowledgmentsApi", () => {
  it("lists with the status and pagination the backend expects", async () => {
    await listStartingWorkAcknowledgments({
      status: "pending_hr",
      page: 2,
      page_size: 25,
    });

    expect(get).toHaveBeenCalledWith("/starting-work-acknowledgments/", {
      params: { status: "pending_hr", page: 2, page_size: 25 },
    });
  });

  it("reads, approves and rejects one acknowledgement by id", async () => {
    await getStartingWorkAcknowledgment(7);
    expect(get).toHaveBeenLastCalledWith("/starting-work-acknowledgments/7/");

    await approveStartingWorkAcknowledgment(7);
    expect(post).toHaveBeenLastCalledWith(
      "/starting-work-acknowledgments/7/approve/",
      {},
    );

    await rejectStartingWorkAcknowledgment(7, {
      reason: "BioTime attendance could not be verified.",
    });
    expect(post).toHaveBeenLastCalledWith(
      "/starting-work-acknowledgments/7/reject/",
      { reason: "BioTime attendance could not be verified." },
    );
  });
});

describe("acknowledgement PDF download", () => {
  it("requests the same-origin path behind the absolute download URL", async () => {
    get.mockResolvedValue({ data: new Blob(["pdf"]) } as never);

    await downloadStartingWorkAcknowledgmentPdf({
      document_download_url:
        "https://api.example.com/starting-work-acknowledgments/7/pdf/",
    });

    expect(get).toHaveBeenCalledWith("/starting-work-acknowledgments/7/pdf/", {
      responseType: "blob",
    });
  });

  it("accepts a relative download URL unchanged", () => {
    expect(
      resolveAcknowledgmentDocumentPath({
        document_download_url: "/starting-work-acknowledgments/7/pdf/",
      }),
    ).toBe("/starting-work-acknowledgments/7/pdf/");
  });

  it("refuses to guess a URL when the backend reports none", async () => {
    await expect(
      downloadStartingWorkAcknowledgmentPdf({ document_download_url: null }),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it("names the file after the reference number", () => {
    expect(
      acknowledgmentPdfFilename({
        id: 7,
        reference_number: "FFI-064303-20260830",
      }),
    ).toBe("starting_work_acknowledgment_FFI-064303-20260830.pdf");
  });
});

describe("acknowledgement API surface", () => {
  it("never reaches for the employee document endpoints", async () => {
    // HR-only acknowledgements are intentionally absent from the employee
    // document APIs, so no call here may go near them.
    get.mockResolvedValue({ data: new Blob(["pdf"]) } as never);
    await listStartingWorkAcknowledgments({ status: "approved" });
    await getStartingWorkAcknowledgment(7);
    await approveStartingWorkAcknowledgment(7);
    await rejectStartingWorkAcknowledgment(7, { reason: "no" });
    await downloadStartingWorkAcknowledgmentPdf({
      document_download_url:
        "https://api.example.com/starting-work-acknowledgments/7/pdf/",
    });

    const urls = [...get.mock.calls, ...post.mock.calls].map(
      (call) => call[0] as string,
    );
    expect(urls).not.toHaveLength(0);
    urls.forEach((url) => {
      expect(url).toMatch(/^\/starting-work-acknowledgments\//);
      expect(url).not.toContain("/employees/");
      expect(url).not.toContain("/documents/");
    });
  });
});

describe("workflow field tolerance", () => {
  it("reads the timestamp and actor under either contract name", () => {
    expect(
      historyEntryTimestamp({ action: "approve", at: "2026-08-25T08:00:00Z" }),
    ).toBe("2026-08-25T08:00:00Z");
    expect(
      historyEntryTimestamp({
        action: "approve",
        timestamp: "2026-08-25T08:00:00Z",
      }),
    ).toBe("2026-08-25T08:00:00Z");

    expect(
      historyEntryActorName({
        action: "approve",
        actor: { id: 2, email: "huda@ffi.test", full_name: "Huda Ali" },
      }),
    ).toBe("Huda Ali");
    expect(
      historyEntryActorName({ action: "approve", actor_name: "Huda Ali" }),
    ).toBe("Huda Ali");
    expect(historyEntryActorName({ action: "approve" })).toBe("");

    expect(workflowActorName("Huda Ali")).toBe("Huda Ali");
    expect(workflowActorName({ full_name: "Huda Ali" })).toBe("Huda Ali");
    expect(workflowActorName(null)).toBe("");
  });
});
