import type { Dayjs } from "dayjs";
import type { PermissionType } from "../../../services/api/permissionRequestsApi";

type Translate = (
  key: string,
  params?: Record<string, string | number>,
  fallback?: string,
) => string;

/** Mirrors the server's evidence rules; the server stays authoritative. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};
// Camera apps sometimes report a standard JPEG using one of these legacy MIME
// aliases. Canonicalize them before the client and server evidence checks.
const CANONICAL_MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/jfif": "image/jpeg",
};
export const EVIDENCE_ACCEPT = [
  ...Object.keys(MIME_BY_EXTENSION).map((extension) => `.${extension}`),
  ...EVIDENCE_MIME_TYPES,
].join(",");

/** Exit Permission keeps its fixed legacy maximum. */
export const EXIT_MAX_MINUTES = 120;

/** The backend's initial global policy, used until `/settings/` answers. */
export const DEFAULT_PERMISSION_POLICY = {
  advanceDays: 7,
  duringShiftMaxMinutes: 120,
  lateLimit: 3,
};

export const PERMISSION_TYPE_COLORS: Record<PermissionType, string> = {
  exit: "blue",
  late: "orange",
  during_shift: "purple",
};

export function permissionTypeLabel(t: Translate, type: PermissionType) {
  return t(
    `permissionRequests.type.${type === "during_shift" ? "duringShift" : type}`,
  );
}

/**
 * Browsers often report HEIC/HEIF (and sometimes other images) with an empty
 * or generic type. The server validates the declared type, so infer it from
 * the extension when the browser gave none.
 */
export function normalizeEvidenceFile(file: File): File {
  const type = file.type.toLowerCase();
  const canonicalType = CANONICAL_MIME_ALIASES[type] ?? type;
  if (EVIDENCE_MIME_TYPES.includes(canonicalType)) {
    if (canonicalType === type) return file;
    return new File([file], file.name, {
      type: canonicalType,
      lastModified: file.lastModified,
    });
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferred = MIME_BY_EXTENSION[extension];
  if (inferred && (type === "" || type === "application/octet-stream")) {
    return new File([file], file.name, {
      type: inferred,
      lastModified: file.lastModified,
    });
  }
  return file;
}

export function evidenceProblem(file: File): "invalidType" | "tooLarge" | null {
  if (!EVIDENCE_MIME_TYPES.includes(file.type.toLowerCase())) {
    return "invalidType";
  }
  if (file.size > EVIDENCE_MAX_BYTES) return "tooLarge";
  return null;
}

/** Whole minutes between two same-day clock times, as the server counts them. */
export function minutesBetween(from?: Dayjs | null, to?: Dayjs | null) {
  if (!from || !to) return 0;
  return to.hour() * 60 + to.minute() - (from.hour() * 60 + from.minute());
}

/** Late and During Shift dates run from today through `advanceDays` ahead. */
export function isOutsideRequestWindow(
  date: Dayjs,
  today: Dayjs,
  advanceDays: number,
) {
  return (
    date.isBefore(today, "day") ||
    date.isAfter(today.add(advanceDays, "day"), "day")
  );
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Splits server field errors between the fields a form currently renders and
 * the rest, which the page shows as a form-level message.
 */
export function splitServerErrors(
  errors: Record<string, string>,
  renderedFields: readonly string[],
  aliases: Record<string, string> = {},
) {
  const fields: Array<{ name: string; errors: string[] }> = [];
  const other: string[] = [];
  Object.entries(errors).forEach(([field, message]) => {
    const name = aliases[field] ?? field;
    if (renderedFields.includes(name)) fields.push({ name, errors: [message] });
    else other.push(message);
  });
  return { fields, other };
}
