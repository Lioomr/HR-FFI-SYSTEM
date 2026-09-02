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

export function openBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function openOrDownloadBlob(
  blob: Blob,
  filename: string,
  download: boolean,
): void {
  if (download) {
    downloadBlob(blob, filename);
  } else {
    openBlob(blob);
  }
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
 * Opens `blob` in a new tab for a quick look. Uses the server MIME type when it
 * is one the browser renders inline, otherwise falls back to a content sniff.
 * Returns false when nothing previewable was found, leaving the caller to
 * download instead.
 *
 * Fetching the bytes is async, so by the time the type is known the click
 * gesture has expired and `window.open` would be blocked as a popup. Callers
 * therefore open a blank tab synchronously inside the handler and pass it here;
 * this navigates that tab once the blob is ready, and closes it on a miss.
 */
export async function previewBlob(
  blob: Blob,
  target?: Window | null,
): Promise<boolean> {
  const serverType =
    blob.type && blob.type !== "application/octet-stream" ? blob.type : null;
  const inlineServerType =
    serverType &&
    (serverType === "application/pdf" || serverType.startsWith("image/"))
      ? serverType
      : null;
  const type = inlineServerType ?? (await sniffInlineType(blob));
  if (!type) {
    target?.close();
    return false;
  }
  const typed = type === blob.type ? blob : new Blob([blob], { type });
  const url = URL.createObjectURL(typed);
  if (target && !target.closed) {
    target.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  return true;
}
