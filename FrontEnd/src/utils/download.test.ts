import { afterEach, describe, expect, it, vi } from "vitest";

import { previewBlob, sniffInlineType } from "./download";

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

describe("previewBlob", () => {
  it("navigates the pre-opened tab when the bytes are a PDF", async () => {
    const target = { closed: false, close: vi.fn(), location: { href: "" } };
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");

    const opened = await previewBlob(
      bytesBlob(asciiBytes("%PDF-1.4")),
      target as unknown as Window,
    );

    expect(opened).toBe(true);
    expect(target.location.href).toBe("blob:pdf");
    expect(target.close).not.toHaveBeenCalled();
    revoke.mockRestore();
  });

  it("closes the pre-opened tab and reports a miss for a non-renderable file", async () => {
    const target = { closed: false, close: vi.fn(), location: { href: "" } };

    const opened = await previewBlob(
      bytesBlob([0x50, 0x4b, 0x03, 0x04]),
      target as unknown as Window,
    );

    expect(opened).toBe(false);
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(target.location.href).toBe("");
  });

  it("trusts a real inline Content-Type without sniffing", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:img");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const target = { closed: false, close: vi.fn(), location: { href: "" } };

    const opened = await previewBlob(
      new Blob(["whatever"], { type: "image/png" }),
      target as unknown as Window,
    );

    expect(opened).toBe(true);
    expect(target.location.href).toBe("blob:img");
  });
});
