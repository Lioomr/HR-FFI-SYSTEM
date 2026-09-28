import { afterEach, describe, expect, it, vi } from "vitest";

import { previewableType, sniffInlineType } from "./download";

/** A Blob whose reported type lies, the way a download endpoint's does. */
function bytesBlob(bytes: number[], type = "application/octet-stream"): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

const asciiBytes = (text: string) => [...text].map((c) => c.charCodeAt(0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sniffInlineType", () => {
  it("recognises a PDF by its magic bytes even under an octet-stream type", async () => {
    expect(await sniffInlineType(bytesBlob(asciiBytes("%PDF-1.7")))).toBe(
      "application/pdf",
    );
  });

  it("recognises PNG and JPEG signatures", async () => {
    expect(await sniffInlineType(bytesBlob([0x89, 0x50, 0x4e, 0x47]))).toBe(
      "image/png",
    );
    expect(await sniffInlineType(bytesBlob([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
  });

  it("returns null for a Word document (a ZIP container)", async () => {
    expect(
      await sniffInlineType(bytesBlob([0x50, 0x4b, 0x03, 0x04])),
    ).toBeNull();
  });
});

describe("previewableType", () => {
  it("sniffs a PDF served as octet-stream", async () => {
    expect(await previewableType(bytesBlob(asciiBytes("%PDF-1.4")))).toBe(
      "application/pdf",
    );
  });

  it("reports a miss for a non-renderable file", async () => {
    expect(await previewableType(bytesBlob([0x50, 0x4b, 0x03, 0x04]))).toBe(
      null,
    );
  });

  it("trusts a real inline Content-Type without sniffing", async () => {
    expect(
      await previewableType(new Blob(["whatever"], { type: "image/png" })),
    ).toBe("image/png");
  });
});
