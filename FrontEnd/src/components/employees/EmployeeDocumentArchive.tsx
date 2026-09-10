import { useCallback, useEffect, useRef, useState } from "react";
import {
  Table,
  Button,
  Tag,
  Space,
  Upload,
  Select,
  Input,
  Form,
  Modal,
  Alert,
  Tooltip,
  notification,
  Typography,
  Spin,
} from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  ReloadOutlined,
  PlusOutlined,
  BellOutlined,
  SyncOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  EyeOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TableProps } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import {
  getEmployeeDocuments,
  uploadEmployeeDocument,
  downloadEmployeeDocument,
  notifyEmployeeDocumentExpiry,
  extractEmployeeDocument,
  deleteEmployeeDocument,
  type EmployeeDocument,
  type DocumentType,
} from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import { useI18n } from "../../i18n/useI18n";
import { downloadBlob } from "../../utils/download";
import { formatDateTime } from "../../utils/dateTime";

const { Text } = Typography;

type Translate = (
  key: string,
  params?: Record<string, any> | string,
  fallback?: string,
) => string;

/**
 * Classification contract shared with the backend: every accepted `document_type`
 * has its own label. Nothing here may fall through to another type — a passport or
 * an iqama must never be presented with the visa label.
 */
const DOCUMENT_TYPE_LABEL_KEYS: Record<DocumentType, string> = {
  PASSPORT: "archive.documentType.PASSPORT",
  IQAMA: "archive.documentType.IQAMA",
  SAUDI_ID: "archive.documentType.SAUDI_ID",
  VISA: "archive.documentType.VISA",
  OTHER: "archive.documentType.OTHER",
};

/** Selector order; the values are the exact enum members the API accepts. */
const DOCUMENT_TYPE_ORDER: DocumentType[] = [
  "IQAMA",
  "PASSPORT",
  "VISA",
  "SAUDI_ID",
  "OTHER",
];

/** Order documents are grouped in; unknown types sort after these, in arrival order. */
const DOCUMENT_TYPE_DISPLAY_ORDER: DocumentType[] = [
  "PASSPORT",
  "IQAMA",
  "SAUDI_ID",
  "VISA",
  "OTHER",
];

/**
 * Identity metadata the extractor may return, in display order. Keys outside this
 * list still render, just after the known ones.
 */
const EXTRACTED_FIELD_ORDER = [
  "passport_number",
  "iqama_number",
  "id_number",
  "full_name",
  "nationality",
  "date_of_birth",
  "issue_date",
  "expiry_date",
  "iqama_expiry_date",
  "profession",
  "employer",
  "visa_number",
  "exit_before",
  "visa_duration",
] as const;

/** One label per metadata field, shared by the table columns and the expanded grid. */
const EXTRACTED_FIELD_LABEL_KEYS: Record<string, string> = {
  passport_number: "archive.extractedField.passport_number",
  iqama_number: "archive.extractedField.iqama_number",
  id_number: "archive.extractedField.id_number",
  full_name: "archive.extractedField.full_name",
  nationality: "archive.extractedField.nationality",
  date_of_birth: "archive.extractedField.date_of_birth",
  issue_date: "archive.extractedField.issue_date",
  expiry_date: "archive.extractedField.expiry_date",
  iqama_expiry_date: "archive.extractedField.iqama_expiry_date",
  profession: "archive.extractedField.profession",
  employer: "archive.extractedField.employer",
  visa_number: "archive.extractedField.visa_number",
  exit_before: "archive.extractedField.exit_before",
  visa_duration: "archive.extractedField.visa_duration",
  national_id: "archive.extractedField.id_number",
  sponsor: "archive.extractedField.employer",
  employer_name: "archive.extractedField.employer",
  sponsor_name: "archive.extractedField.employer",
  passport_expiry_date: "archive.extractedField.expiry_date",
  visa_expiry_date: "archive.extractedField.expiry_date",
  approved_at: "archive.extractedField.approved_at",
};

/**
 * The archive is an HR review surface, not an OCR diagnostic console. Only
 * fields with a defined, employee-record meaning may leave the API payload and
 * reach the screen. This also makes an unexpected extractor key safe by default.
 */
const BUSINESS_EXTRACTED_KEYS = new Set(
  Object.keys(EXTRACTED_FIELD_LABEL_KEYS),
);
const SYSTEM_GENERATED_BUSINESS_KEYS = new Set(["approved_at"]);

/** Bulk OCR payloads are noise in the UI, so they never reach the metadata grid. */
const HIDDEN_EXTRACTED_KEYS = new Set([
  "raw_text",
  "raw_data",
  "ocr_text",
  "full_text",
  // Markers the backend stamps on documents it generates itself. They record
  // that no OCR ran, which is not a field anyone reads off the document.
  "ocr",
  "generated_by_system",
]);

/**
 * True for a document the system produced rather than one HR uploaded — today
 * the Starting Work Acknowledgment. These carry no scanned content, so every
 * OCR affordance is meaningless for them.
 */
function isSystemGenerated(doc: EmployeeDocument): boolean {
  // The serializer field is authoritative; the extracted-field markers remain the
  // fallback for rows written before it existed.
  if (doc.is_system_generated === true) return true;
  const fields = doc.extracted_fields;
  if (!fields) return false;
  return fields.generated_by_system === true || fields.ocr === "skipped";
}

/**
 * Statuses the extraction pipeline never leaves. Anything else (today only
 * `pending`) means a job is still in flight and the archive keeps polling.
 */
const TERMINAL_EXTRACTION_STATUSES = new Set(["success", "partial", "failed"]);

/** True when the pilot reported something about the extraction worth showing. */
function hasExtractionSignals(doc: EmployeeDocument): boolean {
  return (
    doc.extraction_status !== "success" ||
    typeof doc.extraction_confidence === "number" ||
    !!doc.extraction_completed_at ||
    !!(doc.extraction_warnings && doc.extraction_warnings.length > 0)
  );
}

function isExtractionPending(doc: EmployeeDocument): boolean {
  return !TERMINAL_EXTRACTION_STATUSES.has(doc.extraction_status);
}

/** Confidence arrives as a 0-1 ratio; HR reads percentages. */
function formatConfidence(value: number | null | undefined): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const ratio = value > 1 ? value / 100 : value;
  return `${Math.round(ratio * 100)}%`;
}

function documentTypeLabel(
  t: Translate,
  documentType: DocumentType | string | null | undefined,
): string {
  const key = documentType
    ? DOCUMENT_TYPE_LABEL_KEYS[documentType as DocumentType]
    : undefined;
  return key ? t(key) : t("archive.docTypeUnknown", "Document");
}

/**
 * The row headline. `display_name` is the backend's authoritative label (and already
 * resolves to `custom_name` for OTHER); the `document_type` map is only a fallback for
 * documents stored before the contract landed, so an unlabelled row degrades to its own
 * type rather than to whichever type happens to be listed first.
 */
function resolveDocumentTitle(doc: EmployeeDocument, t: Translate): string {
  const displayName = doc.display_name?.trim();
  if (displayName) return displayName;
  if (doc.document_type === "OTHER") {
    const customName = doc.custom_name?.trim();
    if (customName) return customName;
  }
  return documentTypeLabel(t, doc.document_type);
}

function isEmptyFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object")
    return Object.keys(value as object).length === 0;
  return false;
}

function formatFieldValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

/** Known metadata first (contract order), then anything else, with empties dropped. */
function getVisibleExtractedFields(
  fields: Record<string, unknown> | null | undefined,
  systemGenerated = false,
): [string, unknown][] {
  if (!fields) return [];
  const rank = (key: string) => {
    const index = (EXTRACTED_FIELD_ORDER as readonly string[]).indexOf(key);
    return index === -1 ? EXTRACTED_FIELD_ORDER.length : index;
  };
  return Object.entries(fields)
    .filter(
      ([key, value]) =>
        !HIDDEN_EXTRACTED_KEYS.has(key) &&
        (BUSINESS_EXTRACTED_KEYS.has(key) ||
          (systemGenerated && SYSTEM_GENERATED_BUSINESS_KEYS.has(key))) &&
        !key.endsWith("_raw") &&
        !isEmptyFieldValue(value),
    )
    .sort((a, b) => rank(a[0]) - rank(b[0]));
}

function humanizeFieldKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A Saudi ID stores its number under the same `iqama_number` key the extractor uses
 * for an iqama, but it is called an ID number — so the label follows the document
 * that produced the field, in the table and in the expanded grid alike.
 */
function extractedFieldLabel(
  t: Translate,
  key: string,
  documentType?: DocumentType | string | null,
): string {
  const labelKey =
    documentType === "SAUDI_ID" && key === "iqama_number"
      ? EXTRACTED_FIELD_LABEL_KEYS.id_number
      : EXTRACTED_FIELD_LABEL_KEYS[key];
  return labelKey ? t(labelKey) : humanizeFieldKey(key);
}

/** A metadata column: how to label it, and how to read its value off a document. */
interface MetadataField {
  key: string;
  /** Omitted for generic columns derived from arbitrary extracted keys. */
  labelKey?: string;
  /** Returns "" when the document carries no value, which is what hides the column. */
  value: (doc: EmployeeDocument) => string;
  width?: number;
}

/** First non-empty of the given extracted keys, so aliases from older payloads still land. */
function readExtracted(doc: EmployeeDocument, ...keys: string[]): unknown {
  const fields = doc.extracted_fields;
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (!isEmptyFieldValue(value)) return value;
  }
  return undefined;
}

function textValue(value: unknown): string {
  return isEmptyFieldValue(value) ? "" : formatFieldValue(value);
}

/** Dates arrive as ISO timestamps or plain dates; columns show the calendar day. */
function dateValue(value: unknown): string {
  const text = textValue(value);
  return text ? text.split("T")[0] : "";
}

const extractedText =
  (...keys: string[]) =>
  (doc: EmployeeDocument) =>
    textValue(readExtracted(doc, ...keys));

const extractedDate =
  (...keys: string[]) =>
  (doc: EmployeeDocument) =>
    dateValue(readExtracted(doc, ...keys));

const FULL_NAME_FIELD: MetadataField = {
  key: "full_name",
  labelKey: EXTRACTED_FIELD_LABEL_KEYS.full_name,
  value: extractedText("full_name"),
  width: 160,
};
const NATIONALITY_FIELD: MetadataField = {
  key: "nationality",
  labelKey: EXTRACTED_FIELD_LABEL_KEYS.nationality,
  value: extractedText("nationality"),
  width: 120,
};
const DATE_OF_BIRTH_FIELD: MetadataField = {
  key: "date_of_birth",
  labelKey: EXTRACTED_FIELD_LABEL_KEYS.date_of_birth,
  value: extractedDate("date_of_birth"),
  width: 120,
};
const PROFESSION_FIELD: MetadataField = {
  key: "profession",
  labelKey: EXTRACTED_FIELD_LABEL_KEYS.profession,
  value: extractedText("profession"),
  width: 130,
};
const EMPLOYER_FIELD: MetadataField = {
  key: "employer",
  labelKey: EXTRACTED_FIELD_LABEL_KEYS.employer,
  value: extractedText("employer", "sponsor", "employer_name", "sponsor_name"),
  width: 150,
};

/**
 * The metadata columns each classification earns. Visa fields live here and nowhere
 * else, so a passport or an iqama can never be shown under Visa No., Exit Before or
 * Duration. OTHER is derived from its own extracted data instead.
 */
const METADATA_FIELDS: Record<DocumentType, MetadataField[]> = {
  PASSPORT: [
    {
      key: "passport_number",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.passport_number,
      value: extractedText("passport_number"),
      width: 150,
    },
    FULL_NAME_FIELD,
    NATIONALITY_FIELD,
    DATE_OF_BIRTH_FIELD,
    {
      key: "issue_date",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.issue_date,
      value: extractedDate("issue_date"),
      width: 120,
    },
    {
      key: "expiry_date",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.expiry_date,
      value: extractedDate("expiry_date", "passport_expiry_date"),
      width: 120,
    },
    PROFESSION_FIELD,
  ],
  IQAMA: [
    {
      key: "iqama_number",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.iqama_number,
      value: extractedText("iqama_number"),
      width: 150,
    },
    FULL_NAME_FIELD,
    NATIONALITY_FIELD,
    DATE_OF_BIRTH_FIELD,
    {
      key: "expiry_date",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.expiry_date,
      value: extractedDate("iqama_expiry_date", "expiry_date"),
      width: 120,
    },
    PROFESSION_FIELD,
    EMPLOYER_FIELD,
  ],
  SAUDI_ID: [
    {
      key: "id_number",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.id_number,
      value: extractedText("id_number", "national_id", "iqama_number"),
      width: 150,
    },
    FULL_NAME_FIELD,
    NATIONALITY_FIELD,
    DATE_OF_BIRTH_FIELD,
    {
      key: "expiry_date",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.expiry_date,
      value: extractedDate("expiry_date", "iqama_expiry_date"),
      width: 120,
    },
    PROFESSION_FIELD,
    EMPLOYER_FIELD,
  ],
  VISA: [
    {
      key: "visa_number",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.visa_number,
      // The visa extractor promotes these onto the model, so prefer the stored
      // column and fall back to the raw extraction for older records.
      value: (doc) =>
        textValue(doc.visa_number) ||
        textValue(readExtracted(doc, "visa_number")),
      width: 130,
    },
    {
      key: "exit_before",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.exit_before,
      value: (doc) =>
        dateValue(doc.exit_before) ||
        dateValue(readExtracted(doc, "exit_before")),
      width: 120,
    },
    {
      key: "visa_duration",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.visa_duration,
      value: (doc) =>
        textValue(doc.visa_duration) ||
        textValue(readExtracted(doc, "visa_duration")),
      width: 120,
    },
    {
      key: "expiry_date",
      labelKey: EXTRACTED_FIELD_LABEL_KEYS.expiry_date,
      value: extractedDate("expiry_date", "visa_expiry_date"),
      width: 120,
    },
  ],
  OTHER: [],
};

/**
 * Columns for OTHER (and for any type the backend adds later): whatever meaningful
 * keys the group's own extracted data contains, using the generic metadata logic.
 */
function genericMetadataFields(items: EmployeeDocument[]): MetadataField[] {
  const keys: string[] = [];
  for (const doc of items) {
    for (const [key] of getVisibleExtractedFields(
      doc.extracted_fields,
      isSystemGenerated(doc),
    )) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys.map((key) => ({
    key,
    labelKey: EXTRACTED_FIELD_LABEL_KEYS[key],
    value: (doc: EmployeeDocument) => {
      const value = textValue(doc.extracted_fields?.[key]);
      // System-generated documents retain approval timestamps as ISO UTC in
      // their audit metadata. Archive readers should see the same local time
      // used by the rest of the HR UI, never the raw database value.
      return key.endsWith("_at") && value ? formatDateTime(value, "") : value;
    },
    width: 140,
  }));
}

function metadataFieldsFor(
  documentType: string,
  items: EmployeeDocument[],
): MetadataField[] {
  const fields = METADATA_FIELDS[documentType as DocumentType];
  return fields && fields.length > 0 ? fields : genericMetadataFields(items);
}

/** Documents split per classification, known types first, in contract order. */
function groupDocumentsByType(
  docs: EmployeeDocument[],
): { type: string; items: EmployeeDocument[] }[] {
  const groups = new Map<string, EmployeeDocument[]>();
  for (const doc of docs) {
    const type = doc.document_type || "OTHER";
    const items = groups.get(type);
    if (items) items.push(doc);
    else groups.set(type, [doc]);
  }
  const rank = (type: string) => {
    const index = DOCUMENT_TYPE_DISPLAY_ORDER.indexOf(type as DocumentType);
    return index === -1 ? DOCUMENT_TYPE_DISPLAY_ORDER.length : index;
  };
  return [...groups.entries()]
    .map(([type, items]) => ({ type, items }))
    .sort((a, b) => rank(a.type) - rank(b.type));
}

const extractionStatusColor: Record<string, string> = {
  pending: "default",
  success: "success",
  partial: "warning",
  failed: "error",
};

type DocumentPreviewKind = "pdf" | "image";

const IMAGE_PREVIEW_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * The filename is available before any download, so it safely determines whether
 * a Preview click may request the private file. This deliberately excludes Office
 * documents and unknown extensions rather than embedding a browser plug-in.
 */
function documentPreviewKind(filename: string): DocumentPreviewKind | null {
  const extension = filename.trim().split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "pdf";
  return extension && IMAGE_PREVIEW_TYPES[extension] ? "image" : null;
}

function previewMimeType(filename: string, kind: DocumentPreviewKind): string {
  if (kind === "pdf") return "application/pdf";
  const extension = filename.trim().split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_PREVIEW_TYPES[extension] ?? "image/*";
}

function extractionStatusLabel(t: Translate, status: string): string {
  switch (status) {
    case "success":
      return t("archive.extractionStatusCompleted", "Completed");
    case "partial":
      return t("archive.extractionStatusNeedsReview", "Needs review");
    case "failed":
      return t("archive.extractionStatusFailed", "Failed");
    default:
      return t("archive.extractionStatusProcessing", "Processing");
  }
}

/**
 * Days until a document's expiry date (`exit_before`). Negative when expired.
 * Returns null when there is no valid expiry date.
 */
function getDaysLeft(exitBefore?: string | null): number | null {
  if (!exitBefore) return null;
  const expiry = new Date(exitBefore);
  if (Number.isNaN(expiry.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / 86400000);
}

/**
 * Notify is offered only for documents that have an expiry date and are either
 * already expired or expiring within 45 days (matching backend validation).
 */
function canNotifyExpiry(exitBefore?: string | null): boolean {
  const days = getDaysLeft(exitBefore);
  return days !== null && days <= 45;
}

/** Pull a human-readable message out of an API error envelope (array or map form). */
function extractApiErrorMessage(data: any): string | null {
  if (!data) return null;
  const errs = data.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    const first = errs[0];
    if (typeof first === "string") return first;
    if (first && typeof first.message === "string") return first.message;
  } else if (errs && typeof errs === "object") {
    const firstVal = Object.values(errs)[0];
    if (Array.isArray(firstVal) && firstVal.length > 0)
      return String(firstVal[0]);
    if (typeof firstVal === "string") return firstVal;
  }
  return typeof data.message === "string" ? data.message : null;
}

/**
 * A 500 carries no machine-readable discriminator, so the cleanup-pending case is
 * recognised by the backend's own wording (`CLEANUP_PENDING_ERROR`). It only
 * changes the message shown - both 500 shapes re-fetch and trust the server list.
 */
function isCleanupPending(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const text = message.toLowerCase();
  return (
    text.includes("permanently removed") &&
    text.includes("could not be cleared")
  );
}

interface Props {
  employeeId: number | string;
  readonly?: boolean;
  /**
   * Whether the viewer may manage documents rather than just read them -
   * permanent deletion and re-running OCR. Only HRManager and SystemAdmin hold
   * this on the backend, so it defaults to false: a mount that says nothing gets
   * no destructive or extraction-management controls. Upload and download are
   * governed by `readonly` as before.
   */
  canManageDocuments?: boolean;
}

export default function EmployeeDocumentArchive({
  employeeId,
  readonly = false,
  canManageDocuments = false,
}: Props) {
  const { t } = useI18n();
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [notifyingId, setNotifyingId] = useState<number | null>(null);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeDocument | null>(
    null,
  );
  const [previewTarget, setPreviewTarget] = useState<EmployeeDocument | null>(
    null,
  );
  const [previewKind, setPreviewKind] = useState<DocumentPreviewKind | null>(
    null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);

  const [form] = Form.useForm();
  const [docType, setDocType] = useState<DocumentType | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEmployeeDocuments(employeeId);
      if (!isApiError(res)) setDocs(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const clearPreview = useCallback(() => {
    previewRequestRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }, []);

  useEffect(
    () => () => {
      previewRequestRef.current += 1;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    },
    [],
  );

  /**
   * Keep polling while any extraction is still running. There is no attempt cap:
   * the previous 24-tick (60 s) limit stopped silently and left a pending row
   * looking stuck forever, so polling now ends only on a terminal status.
   */
  useEffect(() => {
    if (!docs.some(isExtractionPending)) return;
    const timer = window.setTimeout(load, 2500);
    return () => window.clearTimeout(timer);
  }, [docs, load]);

  const handleDownload = async (doc: EmployeeDocument) => {
    setDownloadingId(doc.id);
    try {
      const blob = await downloadEmployeeDocument(employeeId, doc.id);
      downloadBlob(blob, doc.original_filename || `document_${doc.id}`);
    } catch {
      notification.error({
        message: t("common.error"),
        description: t("common.tryAgain"),
      });
    } finally {
      setDownloadingId(null);
    }
  };

  /**
   * Preview never opens or fetches a document until the user asks for it. The
   * same authenticated download endpoint supplies a Blob, which becomes a
   * short-lived local object URL only while the modal is open.
   */
  const handlePreview = async (doc: EmployeeDocument) => {
    clearPreview();
    const kind = documentPreviewKind(doc.original_filename);
    setPreviewTarget(doc);
    setPreviewKind(kind);
    setPreviewError(null);
    if (!kind) {
      setPreviewError(
        t(
          "archive.previewUnavailable",
          "This document type cannot be previewed. Download the file to view it.",
        ),
      );
      return;
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreviewLoadingId(doc.id);
    try {
      const blob = await downloadEmployeeDocument(employeeId, doc.id);
      if (previewRequestRef.current !== requestId) return;
      // The selected extension is the allowlist decision. Normalising a generic
      // attachment MIME type lets the browser render a valid private PDF/image
      // without exposing its storage URL or accepting arbitrary content types.
      const url = URL.createObjectURL(
        new Blob([blob], {
          type: previewMimeType(doc.original_filename, kind),
        }),
      );
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch {
      if (previewRequestRef.current === requestId) {
        setPreviewError(
          t("archive.previewFailed", "Could not load the document preview."),
        );
      }
    } finally {
      if (previewRequestRef.current === requestId) setPreviewLoadingId(null);
    }
  };

  const closePreview = () => {
    clearPreview();
    setPreviewTarget(null);
    setPreviewKind(null);
    setPreviewError(null);
    setPreviewLoadingId(null);
  };

  const handleNotify = async (doc: EmployeeDocument) => {
    setNotifyingId(doc.id);
    try {
      const res = await notifyEmployeeDocumentExpiry(employeeId, doc.id);
      if (isApiError(res)) {
        notification.warning({
          message: t("archive.notifyFailed"),
          description: res.message,
        });
        return;
      }
      const delivery = res.data?.delivery;
      if (delivery?.sent === true || delivery?.success === true) {
        notification.success({
          message: t("archive.notifySent"),
          description: resolveDocumentTitle(doc, t),
        });
      } else {
        notification.warning({
          message: t("archive.notifyFailed"),
          description: delivery?.error || t("common.tryAgain"),
        });
      }
    } catch (e: any) {
      const validationMsg = extractApiErrorMessage(e?.response?.data);
      if (validationMsg) {
        notification.warning({
          message: t("archive.notifyFailed"),
          description: validationMsg,
        });
      } else {
        notification.error({
          message: t("common.error"),
          description: e?.message || t("common.tryAgain"),
        });
      }
    } finally {
      setNotifyingId(null);
    }
  };

  const handleExtract = async (doc: EmployeeDocument) => {
    setExtractingId(doc.id);
    try {
      const res = await extractEmployeeDocument(employeeId, doc.id);
      if (isApiError(res)) {
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
        return;
      }
      setDocs((current) =>
        current.map((item) => (item.id === doc.id ? res.data : item)),
      );
      notification.success({
        message: t("archive.extractionQueued", "Document extraction queued."),
      });
    } catch (e: any) {
      notification.error({
        message: t("common.error"),
        description: e?.message || t("common.tryAgain"),
      });
    } finally {
      setExtractingId(null);
    }
  };

  /**
   * Permanently delete a document.
   *
   * Every failure path ends by trusting the server list rather than local state.
   * That matters most for the `cleanup_pending` 500: the file is already gone and
   * the row is hidden for reconciliation, so it must never be restored here.
   */
  const handleDelete = async (doc: EmployeeDocument) => {
    setDeletingId(doc.id);
    try {
      const res = await deleteEmployeeDocument(employeeId, doc.id);
      if (isApiError(res)) {
        notification.error({
          message: t("archive.deleteFailed", "Delete failed"),
          description: res.message,
        });
        await load();
        return;
      }
      setDocs((current) => current.filter((item) => item.id !== doc.id));
      setDeleteTarget(null);
      notification.success({
        message: t("archive.deleteSuccess", "Document deleted permanently."),
        description: doc.original_filename,
      });
    } catch (e: any) {
      const status = e?.response?.status;
      const serverMessage =
        extractApiErrorMessage(e?.response?.data) || e?.message;
      let description: string;
      if (status === 403) {
        // A 403 is not necessarily the system-generated refusal: the backend
        // returns it for role and company-scope failures too. Prefer whatever the
        // backend said, and fall back to a permission message rather than to a
        // claim about the document that may be false.
        description =
          serverMessage ||
          t(
            "archive.deleteNotPermitted",
            "You do not have permission to delete this document.",
          );
      } else if (status === 404) {
        description = t(
          "archive.deleteNotFound",
          "This document is no longer available in the active company.",
        );
      } else if (status === 409) {
        description = t(
          "archive.deleteConflict",
          "This document is already being deleted, or another record still protects it.",
        );
      } else if (isCleanupPending(serverMessage)) {
        description = t(
          "archive.deleteCleanupPending",
          "The file was permanently removed, but the archive entry could not be cleared. It is hidden and will be cleaned up automatically.",
        );
      } else {
        description =
          serverMessage ||
          t(
            "archive.deleteStorageFailed",
            "The document file could not be deleted from storage. Nothing was removed; try again.",
          );
      }
      notification.error({
        message: t("archive.deleteFailed", "Delete failed"),
        description,
      });
      // The server decides what still exists - including for cleanup_pending,
      // where the hidden row simply does not come back.
      await load();
      setDeleteTarget(null);
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpload = async () => {
    // The form holds the authoritative selection, so the submitted document_type is
    // always the one the user picked (and antd reports a missing type inline).
    let values: { document_type?: DocumentType; custom_name?: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const documentType = (values.document_type ??
      docType) as DocumentType | null;
    if (!documentType) {
      notification.error({
        message: t("common.error"),
        description: t("common.required"),
      });
      return;
    }
    if (!selectedFile) {
      notification.error({
        message: t("common.error"),
        description: t(
          "archive.fileRequired",
          "Please select a file to upload.",
        ),
      });
      return;
    }
    setUploading(true);
    try {
      const res = await uploadEmployeeDocument(employeeId, {
        document_type: documentType,
        file: selectedFile,
        // custom_name only carries meaning for OTHER; a stale value from a previous
        // selection must not ride along with a classified document.
        custom_name:
          documentType === "OTHER" ? values.custom_name?.trim() : undefined,
      });
      if (isApiError(res)) {
        notification.error({
          message: t("common.error"),
          description: res.message,
        });
      } else {
        const warnings: string[] = (res as any).data?.extraction_warnings ?? [];
        setUploadModalOpen(false);
        resetForm();
        notification[warnings.length > 0 ? "warning" : "success"]({
          message: t(
            warnings.length > 0
              ? "archive.uploadNeedsReview"
              : "archive.uploadSuccess",
            warnings.length > 0
              ? "Document uploaded. OCR results need review."
              : "Document uploaded successfully.",
          ),
        });
        load();
      }
    } catch (e: any) {
      notification.error({
        message: t("common.error"),
        description: e?.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    form.resetFields();
    setDocType(null);
    setFileList([]);
    setSelectedFile(null);
  };

  /**
   * Metadata columns are decided per group: only the fields that classification
   * defines, and only those at least one document in the group actually fills.
   */
  const buildColumns = (
    documentType: string,
    items: EmployeeDocument[],
  ): ColumnsType<EmployeeDocument> => [
    {
      title: t("archive.docType", "Type"),
      key: "display_name",
      width: 140,
      render: (_, r) => (
        <Text strong data-testid={`document-type-${r.id}`}>
          {resolveDocumentTitle(r, t)}
        </Text>
      ),
    },
    {
      title: t("archive.filename", "File"),
      dataIndex: "original_filename",
      key: "original_filename",
      ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    ...metadataFieldsFor(documentType, items)
      .filter((field) => items.some((doc) => field.value(doc) !== ""))
      .map((field) => ({
        title: field.labelKey ? t(field.labelKey) : humanizeFieldKey(field.key),
        key: field.key,
        width: field.width ?? 130,
        render: (_: unknown, r: EmployeeDocument) =>
          field.value(r) || <Text type="secondary">—</Text>,
      })),
    {
      title: t("archive.extractionStatus", "Extraction"),
      dataIndex: "extraction_status",
      key: "extraction_status",
      width: 110,
      render: (v: string, r: EmployeeDocument) =>
        isSystemGenerated(r) ? (
          <Tag color="blue">{t("archive.systemGenerated", "Generated")}</Tag>
        ) : (
          <Tag color={extractionStatusColor[v] ?? "default"}>
            {extractionStatusLabel(t, v)}
          </Tag>
        ),
    },
    {
      title: t("archive.uploadedBy", "Uploaded By"),
      dataIndex: "uploaded_by_name",
      key: "uploaded_by_name",
      width: 120,
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    {
      title: t("archive.uploadedAt", "Date"),
      dataIndex: "created_at",
      key: "created_at",
      width: 100,
      render: (v) => (v ? String(v).split("T")[0] : "—"),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 190,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title={t("archive.preview", "Preview document")}>
            <Button
              size="small"
              icon={<EyeOutlined />}
              aria-label={t("archive.preview", "Preview document")}
              loading={previewLoadingId === r.id}
              onClick={() => handlePreview(r)}
            />
          </Tooltip>
          <Tooltip title={t("common.download")}>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={downloadingId === r.id}
              onClick={() => handleDownload(r)}
            />
          </Tooltip>
          {(r.extraction_status === "pending" ||
            r.extraction_status === "failed") &&
            !isSystemGenerated(r) &&
            !readonly &&
            canManageDocuments && (
              <Tooltip title={t("archive.runExtraction", "Run OCR extraction")}>
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  aria-label={t("archive.runExtraction", "Run OCR extraction")}
                  loading={extractingId === r.id}
                  onClick={() => handleExtract(r)}
                />
              </Tooltip>
            )}
          {canNotifyExpiry(r.exit_before) && (
            <Tooltip title={t("archive.whatsappNotification")}>
              <Button
                size="small"
                icon={<BellOutlined />}
                loading={notifyingId === r.id}
                onClick={() => handleNotify(r)}
              >
                {notifyingId === r.id
                  ? t("archive.notifySending")
                  : t("archive.notify")}
              </Button>
            </Tooltip>
          )}
          {!readonly && canManageDocuments && !isSystemGenerated(r) && (
            <Tooltip title={t("archive.delete", "Delete")}>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={t("archive.delete", "Delete")}
                loading={deletingId === r.id}
                disabled={deletingId !== null}
                onClick={() => setDeleteTarget(r)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const groups = groupDocumentsByType(docs);

  /** Shared by every group's table so the detail panel stays identical across types. */
  const expandable: TableProps<EmployeeDocument>["expandable"] = {
    expandedRowRender: (record) => {
      const visibleEntries = getVisibleExtractedFields(
        record.extracted_fields,
        isSystemGenerated(record),
      );
      const warnings = record.extraction_warnings ?? [];
      const systemGenerated = isSystemGenerated(record);
      const confidence =
        record.extraction_status === "partial"
          ? formatConfidence(record.extraction_confidence)
          : null;
      const completedAt = record.extraction_completed_at
        ? formatDateTime(record.extraction_completed_at, "")
        : null;
      const needsVerification =
        !systemGenerated &&
        (record.extraction_status === "partial" || warnings.length > 0);
      const extractionFailed =
        !systemGenerated && record.extraction_status === "failed";
      const extractionPending = !systemGenerated && isExtractionPending(record);
      return (
        <Space
          direction="vertical"
          style={{ width: "100%", padding: "8px 0" }}
          size={8}
        >
          {!systemGenerated && (
            <div
              style={{ fontSize: 12 }}
              data-testid={`extraction-status-${record.id}`}
            >
              <Space size={[16, 4]} wrap>
                <span>
                  <Text type="secondary">
                    {t("archive.extractionStatus", "Extraction")}:
                  </Text>{" "}
                  <Tag
                    color={
                      extractionStatusColor[record.extraction_status] ??
                      "default"
                    }
                  >
                    {extractionStatusLabel(t, record.extraction_status)}
                  </Tag>
                </span>
                {confidence && (
                  <span>
                    <Text type="secondary">
                      {t("archive.extractionConfidence", "Confidence")}:
                    </Text>{" "}
                    <Text>{confidence}</Text>
                  </span>
                )}
                {completedAt && (
                  <span>
                    <Text type="secondary">
                      {t("archive.extractionCompletedAt", "Completed")}:
                    </Text>{" "}
                    <Text>{completedAt}</Text>
                  </span>
                )}
              </Space>
            </div>
          )}
          {systemGenerated && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t(
                "archive.systemGeneratedNotice",
                "Generated by the system. No OCR ran on this document and it cannot be deleted.",
              )}
            </Text>
          )}
          {needsVerification && (
            <Alert
              type="warning"
              showIcon
              data-testid={`verification-required-${record.id}`}
              message={t(
                "archive.verificationRequired",
                "Verification required",
              )}
              description={t(
                "archive.partialNotice",
                "The scan produced only partial results. HR must verify every suggested value against the original document before relying on it.",
              )}
            />
          )}
          {extractionFailed && (
            <Alert
              type="error"
              showIcon
              message={t("archive.extractionStatusFailed", "Failed")}
              description={t(
                "archive.failedNotice",
                "OCR could not read this document. Review the original document or run OCR again.",
              )}
            />
          )}
          {extractionPending && (
            <Alert
              type="info"
              showIcon
              message={t("archive.extractionStatusProcessing", "Processing")}
              description={t(
                "archive.pendingNotice",
                "OCR is still processing this document. Refresh shortly to see the result.",
              )}
            />
          )}
          {visibleEntries.length > 0 && (
            <div
              style={{ fontSize: 13 }}
              data-testid={`extracted-fields-${record.id}`}
            >
              <Text strong style={{ display: "block" }}>
                {systemGenerated
                  ? t("archive.extractedFields", "Extracted Fields")
                  : t("archive.suggestedMetadata", "Suggested metadata (OCR)")}
              </Text>
              {!systemGenerated && (
                <Text
                  type="secondary"
                  style={{ display: "block", marginBottom: 8, fontSize: 12 }}
                >
                  {t(
                    "archive.suggestedMetadataHint",
                    "Read from the document automatically. Nothing here is approved employee data - verify it against the original before use.",
                  )}
                </Text>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: "6px 24px",
                }}
              >
                {visibleEntries.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 6 }}>
                    <Text type="secondary" style={{ whiteSpace: "nowrap" }}>
                      {extractedFieldLabel(t, k, record.document_type)}:
                    </Text>
                    <Text>{formatFieldValue(v)}</Text>
                  </div>
                ))}
              </div>
            </div>
          )}
          {visibleEntries.length === 0 &&
            !needsVerification &&
            !extractionFailed &&
            !extractionPending && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("archive.noExtractedData", "No extracted data.")}
              </Text>
            )}
        </Space>
      );
    },
    rowExpandable: (r) =>
      // Reliability signals make a row worth expanding even when the extractor
      // returned no usable field; a bare record with nothing to say stays flat.
      (!isSystemGenerated(r) && hasExtractionSignals(r)) ||
      getVisibleExtractedFields(r.extracted_fields, isSystemGenerated(r))
        .length > 0,
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <Button
          icon={<ReloadOutlined />}
          onClick={load}
          loading={loading}
          size="small"
        >
          {t("common.refresh", "Refresh")}
        </Button>
        {!readonly && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => {
              resetForm();
              setUploadModalOpen(true);
            }}
          >
            {t("archive.upload", "Upload Document")}
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <Table
          dataSource={[]}
          columns={buildColumns("OTHER", [])}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
          scroll={{ x: 900 }}
          locale={{
            emptyText: t("archive.empty", "No documents uploaded yet."),
          }}
        />
      ) : (
        <Spin spinning={loading}>
          {groups.map(({ type, items }) => (
            <div
              key={type}
              style={{ marginBottom: 20 }}
              data-testid={`document-group-${type}`}
            >
              <Text strong style={{ display: "block", marginBottom: 6 }}>
                {documentTypeLabel(t, type)} ({items.length})
              </Text>
              <Table
                dataSource={items}
                columns={buildColumns(type, items)}
                rowKey="id"
                pagination={false}
                size="small"
                scroll={{ x: 900 }}
                expandable={expandable}
              />
            </div>
          ))}
        </Spin>
      )}

      <Modal
        title={
          previewTarget
            ? `${t("archive.preview", "Preview document")}: ${previewTarget.original_filename}`
            : t("archive.preview", "Preview document")
        }
        open={previewTarget !== null}
        onCancel={closePreview}
        footer={null}
        width={900}
        destroyOnClose
      >
        {previewLoadingId !== null ? (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <Spin />
          </div>
        ) : previewError ? (
          <Alert type="warning" showIcon message={previewError} />
        ) : previewUrl && previewKind === "pdf" ? (
          <iframe
            title={t("archive.preview", "Preview document")}
            data-testid="document-preview-pdf"
            src={previewUrl}
            style={{ width: "100%", height: "70vh", border: 0 }}
          />
        ) : previewUrl && previewKind === "image" ? (
          <img
            src={previewUrl}
            alt={previewTarget?.original_filename || t("archive.preview")}
            data-testid="document-preview-image"
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "70vh",
              margin: "0 auto",
            }}
          />
        ) : null}
      </Modal>

      <Modal
        title={t("archive.uploadTitle", "Upload Document")}
        open={uploadModalOpen}
        onOk={handleUpload}
        onCancel={() => {
          setUploadModalOpen(false);
          resetForm();
        }}
        okText={t("archive.uploadBtn", "Upload")}
        confirmLoading={uploading}
        width={480}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="document_type"
            label={t("archive.docType", "Document Type")}
            rules={[{ required: true }]}
          >
            <Select
              data-testid="document-type-select"
              options={DOCUMENT_TYPE_ORDER.map((value) => ({
                value,
                label: documentTypeLabel(t, value),
              }))}
              onChange={(v: DocumentType) => setDocType(v)}
              placeholder={t("archive.selectType", "Select type")}
            />
          </Form.Item>

          {docType === "OTHER" && (
            <Form.Item
              name="custom_name"
              label={t("archive.customName", "Custom Name")}
              rules={[
                {
                  required: true,
                  message: t(
                    "archive.customNameRequired",
                    "Custom name is required for 'Other' type.",
                  ),
                },
              ]}
            >
              <Input
                placeholder={t(
                  "archive.customNamePlaceholder",
                  "e.g. Medical Certificate",
                )}
              />
            </Form.Item>
          )}

          <Form.Item label={t("archive.file", "File")} required>
            <Upload
              accept=".pdf,.PDF,.jpg,.jpeg,.png,.JPG,.JPEG,.PNG"
              maxCount={1}
              fileList={fileList}
              beforeUpload={(file) => {
                setSelectedFile(file);
                setFileList([
                  { uid: file.uid || "-1", name: file.name, status: "done" },
                ]);
                return false;
              }}
              onRemove={() => {
                setSelectedFile(null);
                setFileList([]);
              }}
            >
              <Button icon={<UploadOutlined />}>
                {t("archive.selectFile", "Select File")}
              </Button>
            </Upload>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t(
                "archive.fileHint",
                "PDF or image. Visa documents should be PDF.",
              )}
            </Text>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <span>
            <ExclamationCircleFilled
              style={{ color: "#ff4d4f", marginInlineEnd: 8 }}
            />
            {t("archive.deleteTitle", "Delete document permanently?")}
          </span>
        }
        open={deleteTarget !== null}
        onOk={() => deleteTarget && handleDelete(deleteTarget)}
        // Cancel closes the dialog and does nothing else.
        onCancel={() => setDeleteTarget(null)}
        okText={t("archive.deleteConfirm", "Delete permanently")}
        cancelText={t("common.cancel", "Cancel")}
        okButtonProps={{ danger: true }}
        confirmLoading={deletingId !== null}
        destroyOnClose
      >
        {deleteTarget && (
          <Space direction="vertical" size={8}>
            <Text strong data-testid="delete-target-filename">
              {deleteTarget.original_filename}
            </Text>
            <Text>
              {t(
                "archive.deleteWarning",
                "This permanently removes the file and its archive entry. This cannot be undone.",
              )}
            </Text>
          </Space>
        )}
      </Modal>
    </div>
  );
}
