const REVOKE_DELAY_MS = 5000;

/**
 * Reads a Blob to an ArrayBuffer via FileReader. `Blob.arrayBuffer()` would be
 * shorter but is missing from some test DOM shims, and this stays equivalent in
 * real browsers.
 */
function readAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Download endpoints often label their bytes `application/octet-stream` so the
 * browser saves rather than renders them. That defeats an in-browser preview,
 * so sniff the leading magic bytes and return a MIME type the browser can show
 * inline — or null when the bytes are not a previewable kind (e.g. a Word doc,
 * which is a ZIP container).
 */
export async function sniffInlineType(blob: Blob): Promise<string | null> {
  let head: Uint8Array;
  try {
    const buffer = await readAsArrayBuffer(blob);
    head = new Uint8Array(buffer).subarray(0, 12);
  } catch {
    return null;
  }
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...head.subarray(start, end));

  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * The MIME type `blob` can be previewed as (a PDF or an image), preferring the
 * server's type and falling back to a content sniff; null when neither is
 * previewable.
 */
export async function previewableType(blob: Blob): Promise<string | null> {
  const serverType =
    blob.type && blob.type !== "application/octet-stream" ? blob.type : null;
  if (
    serverType &&
    (serverType === "application/pdf" || serverType.startsWith("image/"))
  ) {
    return serverType;
  }
  return sniffInlineType(blob);
}
