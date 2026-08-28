// Compatibility shim: triggerBlobDownload is the historical name used across
// pages and mocked in tests. The canonical implementation lives in
// utils/download.ts (delayed revoke — safer than the old immediate revoke,
// which could abort downloads in Safari).
export { downloadBlob as triggerBlobDownload } from "../../utils/download";
