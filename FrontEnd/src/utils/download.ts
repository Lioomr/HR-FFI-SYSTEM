const REVOKE_DELAY_MS = 5000;

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
