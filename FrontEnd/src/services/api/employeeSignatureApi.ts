import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * Reusable employee signature (`EmployeeProfile.signature`).
 *
 * The web client only ever uses the `me` alias, so no profile identifier is
 * held or transmitted and an employee cannot address anybody else's row. JWT
 * and `x-active-company-id` are injected by `apiClient`; nothing here adds
 * either header. Ownership, company scope, and file validation all stay
 * server-side — the checks in this module are fast feedback, not a boundary.
 */
const SIGNATURE_URL = "/api/employees/me/signature/";
const SIGNATURE_PREVIEW_URL = "/api/employees/me/signature/preview/";

/** Read-only state returned by every signature route. Never a storage path. */
export interface EmployeeSignatureState {
  has_signature: boolean;
  uploaded_at: string | null;
  content_type: string | null;
  size_bytes: number | null;
  /** Authenticated API path, or null when nothing is stored. */
  preview_url: string | null;
}

/** Mirrors `MAX_EMPLOYEE_SIGNATURE_SIZE_BYTES` (2 MB) on the backend. */
export const SIGNATURE_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const SIGNATURE_MAX_SIZE_MB = SIGNATURE_MAX_SIZE_BYTES / (1024 * 1024);

/**
 * Raster formats only, matching `EMPLOYEE_SIGNATURE_ALLOWED_EXTENSIONS`. SVG
 * and PDF are excluded deliberately: the signature is drawn straight onto
 * official forms, and SVG is executable markup rather than an image.
 */
export const SIGNATURE_ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg"] as const;
export const SIGNATURE_ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;

/** `accept` for the file picker. Extensions and MIME types, never a wildcard. */
export const SIGNATURE_ACCEPT = [
  ...SIGNATURE_ALLOWED_EXTENSIONS,
  ...SIGNATURE_ALLOWED_CONTENT_TYPES,
].join(",");

/** Why a locally picked file was refused before it reached the network. */
export type SignatureFileRejection = "type" | "size" | "empty";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Pre-flight check so an obviously wrong file is refused without a round trip.
 * The backend re-validates extension, claimed content type, and magic bytes,
 * and remains the authority on what is stored.
 */
export function validateSignatureFile(
  file: File,
): SignatureFileRejection | null {
  const extension = extensionOf(file.name || "");
  const allowedExtension = (
    SIGNATURE_ALLOWED_EXTENSIONS as readonly string[]
  ).includes(extension);
  const claimedType = (file.type || "").toLowerCase().split(";")[0].trim();
  const allowedType =
    !claimedType ||
    (SIGNATURE_ALLOWED_CONTENT_TYPES as readonly string[]).includes(
      claimedType,
    );
  if (!allowedExtension || !allowedType) return "type";
  if (!file.size) return "empty";
  if (file.size > SIGNATURE_MAX_SIZE_BYTES) return "size";
  return null;
}

export async function getMySignature(): Promise<
  ApiResponse<EmployeeSignatureState>
> {
  const { data } =
    await api.get<ApiResponse<EmployeeSignatureState>>(SIGNATURE_URL);
  return data;
}

/**
 * Stores or replaces the caller's signature. The backend answers 201 for a
 * first upload and 200 for a replacement; both carry the same state envelope.
 */
export async function uploadMySignature(
  file: File,
): Promise<ApiResponse<EmployeeSignatureState>> {
  const form = new FormData();
  form.append("signature", file);
  const { data } = await api.post<ApiResponse<EmployeeSignatureState>>(
    SIGNATURE_URL,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function deleteMySignature(): Promise<
  ApiResponse<EmployeeSignatureState>
> {
  const { data } =
    await api.delete<ApiResponse<EmployeeSignatureState>>(SIGNATURE_URL);
  return data;
}

/**
 * Fetches the stored image as an authenticated blob. It is served
 * `private, no-store` with `nosniff`, so the bytes must come through the API
 * client — an `<img src>` pointing at the route would carry no token.
 */
export async function getMySignaturePreview(): Promise<Blob> {
  const { data } = await api.get(SIGNATURE_PREVIEW_URL, {
    responseType: "blob",
  });
  return data;
}
