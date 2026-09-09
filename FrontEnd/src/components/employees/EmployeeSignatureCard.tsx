import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Popconfirm,
  Skeleton,
  Space,
  Typography,
  Upload,
  message,
} from "antd";
import {
  DeleteOutlined,
  HighlightOutlined,
  UploadOutlined,
} from "@ant-design/icons";

import {
  SIGNATURE_ACCEPT,
  SIGNATURE_MAX_SIZE_MB,
  deleteMySignature,
  getMySignature,
  getMySignaturePreview,
  uploadMySignature,
  validateSignatureFile,
  type EmployeeSignatureState,
  type SignatureFileRejection,
} from "../../services/api/employeeSignatureApi";
import { isApiError } from "../../services/api/apiTypes";
import {
  getHttpErrorMessage,
  isForbidden,
  isUnauthorized,
} from "../../services/api/httpErrors";
import { useI18n } from "../../i18n/useI18n";
import { formatDateTime } from "../../utils/dateTime";

const { Text } = Typography;

/** One message key per client-side rejection reason. */
const REJECTION_KEYS: Record<SignatureFileRejection, string> = {
  type: "signature.invalidType",
  size: "signature.invalidSize",
  empty: "signature.invalidEmpty",
};

function formatSize(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Self-service management of the signed-in employee's reusable signature.
 *
 * The stored image is what the backend stamps onto the leave request, loan
 * request, job offer, starting-work acknowledgment, and annual entitlements
 * disbursement forms, so this card is deliberately explicit about where the
 * mark ends up and about what removing it means.
 *
 * Only the owner can reach these routes (`/api/employees/me/signature/`); the
 * bytes arrive as an authenticated blob and render from an object URL, so no
 * token and no storage path ever lands in the DOM.
 */
export default function EmployeeSignatureCard() {
  const { t } = useI18n();
  const [messageApi, messageContext] = message.useMessage();

  const [state, setState] = useState<EmployeeSignatureState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const previewUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const applyPreviewUrl = useCallback((url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await getMySignature();
      if (!mountedRef.current) return;
      if (isApiError(response)) {
        setLoadError(response.message || t("signature.loadError"));
        return;
      }
      setState(response.data);
      if (!response.data.has_signature) {
        applyPreviewUrl(null);
        setPreviewFailed(false);
        return;
      }
      // A stored signature is worth reporting even when its image will not
      // render: a broken preview is a display problem, not a reason to hide
      // the replace and remove actions.
      try {
        const blob = await getMySignaturePreview();
        if (!mountedRef.current) return;
        applyPreviewUrl(URL.createObjectURL(blob));
        setPreviewFailed(false);
      } catch {
        if (!mountedRef.current) return;
        applyPreviewUrl(null);
        setPreviewFailed(true);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(
        isUnauthorized(error)
          ? t("signature.unauthorized")
          : getHttpErrorMessage(error) || t("signature.loadError"),
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyPreviewUrl, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const reportActionError = useCallback(
    (error: unknown, fallbackKey: string) => {
      if (isUnauthorized(error)) {
        messageApi.error(t("signature.unauthorized"));
      } else if (isForbidden(error)) {
        messageApi.error(t("signature.forbidden"));
      } else {
        messageApi.error(getHttpErrorMessage(error) || t(fallbackKey));
      }
    },
    [messageApi, t],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      // Fast local feedback only; the backend re-validates extension, claimed
      // content type, and magic bytes and stays the authority.
      const rejection = validateSignatureFile(file);
      if (rejection) {
        messageApi.error(t(REJECTION_KEYS[rejection]));
        return;
      }
      setBusy(true);
      try {
        const response = await uploadMySignature(file);
        if (isApiError(response)) {
          messageApi.error(response.message || t("signature.uploadFailed"));
          return;
        }
        messageApi.success(t("signature.uploaded"));
        await load();
      } catch (error) {
        reportActionError(error, "signature.uploadFailed");
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [load, messageApi, reportActionError, t],
  );

  const handleRemove = useCallback(async () => {
    setBusy(true);
    try {
      const response = await deleteMySignature();
      if (isApiError(response)) {
        messageApi.error(response.message || t("signature.removeFailed"));
        return;
      }
      messageApi.success(t("signature.removed"));
      await load();
    } catch (error) {
      reportActionError(error, "signature.removeFailed");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [load, messageApi, reportActionError, t]);

  const hasSignature = Boolean(state?.has_signature);
  const savedAt = state?.uploaded_at ? formatDateTime(state.uploaded_at) : null;
  const savedSize = formatSize(state?.size_bytes ?? null);

  return (
    <Card
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <HighlightOutlined style={{ color: "#722ed1" }} aria-hidden />
          <span>{t("signature.title")}</span>
        </div>
      }
      style={{
        borderRadius: 16,
        border: "none",
        boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
      }}
    >
      {messageContext}
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("signature.usedOn")}
        </Text>

        {loading ? (
          <Skeleton active title={false} paragraph={{ rows: 3 }} />
        ) : loadError ? (
          <Alert
            type="error"
            showIcon
            message={t("signature.loadError")}
            description={loadError}
            action={
              <Button size="small" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : (
          <>
            {hasSignature ? (
              <div
                style={{
                  padding: 12,
                  background: "#fff",
                  border: "1px solid #f0f0f0",
                  borderRadius: 8,
                  textAlign: "center",
                }}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={t("signature.previewAlt")}
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: 120,
                      margin: "0 auto",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {previewFailed
                      ? t("signature.previewFailed")
                      : t("common.loading")}
                  </Text>
                )}
              </div>
            ) : (
              <Alert
                type="info"
                showIcon
                message={t("signature.none")}
                description={t("signature.noneHint")}
              />
            )}

            {hasSignature && (savedAt || savedSize) && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {savedAt ? `${t("signature.savedAt")}: ${savedAt}` : ""}
                {savedAt && savedSize ? " · " : ""}
                {savedSize ? `${t("signature.size")}: ${savedSize}` : ""}
              </Text>
            )}

            <Space wrap>
              <Upload
                accept={SIGNATURE_ACCEPT}
                showUploadList={false}
                maxCount={1}
                disabled={busy}
                beforeUpload={(file) => {
                  void handleUpload(file as unknown as File);
                  // The API service owns the request; never auto-post.
                  return false;
                }}
              >
                <Button
                  type={hasSignature ? "default" : "primary"}
                  icon={<UploadOutlined aria-hidden />}
                  loading={busy}
                >
                  {hasSignature
                    ? t("signature.replace")
                    : t("signature.upload")}
                </Button>
              </Upload>

              {hasSignature && (
                <Popconfirm
                  title={t("signature.removeConfirm")}
                  description={t("signature.removeConfirmHint")}
                  okText={t("common.yes")}
                  cancelText={t("common.no")}
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleRemove()}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined aria-hidden />}
                    disabled={busy}
                  >
                    {t("signature.remove")}
                  </Button>
                </Popconfirm>
              )}
            </Space>

            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("signature.fileRules", { max: SIGNATURE_MAX_SIZE_MB })}
            </Text>
          </>
        )}
      </Space>
    </Card>
  );
}
