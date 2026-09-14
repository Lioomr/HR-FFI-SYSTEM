import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Tag,
  Typography,
  notification,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import EvidencePicker, { type EvidenceItem } from "./EvidencePicker";
import { formatFileSize } from "./permissionRequestHelpers";
import { useI18n } from "../../../i18n/useI18n";
import { isApiError } from "../../../services/api/apiTypes";
import { getHttpErrorMessage } from "../../../services/api/httpErrors";
import {
  addPermissionRequestAttachments,
  downloadPermissionRequestAttachment,
  parseCaptureMetadata,
  type PermissionAttachment,
  type PermissionRequest,
} from "../../../services/api/permissionRequestsApi";
import { formatDateTime } from "../../../utils/dateTime";

type Props = {
  request: PermissionRequest;
  /** The owner may add evidence while the request is pending. */
  canAdd: boolean;
  onUpdated: (request: PermissionRequest) => void;
};

/** Private evidence: authenticated downloads only, never a plain link. */
export default function PermissionAttachmentsSection({
  request,
  canAdd,
  onUpdated,
}: Props) {
  const { t } = useI18n();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [pending, setPending] = useState<EvidenceItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const attachments = request.attachments ?? [];

  async function download(attachment: PermissionAttachment) {
    setDownloadingId(attachment.id);
    try {
      await downloadPermissionRequestAttachment(request.id, attachment);
    } catch (error) {
      notification.error({
        message: t("permissionRequests.evidence.downloadFailed"),
        description: getHttpErrorMessage(error),
      });
    } finally {
      setDownloadingId(null);
    }
  }

  async function upload() {
    if (!pending.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      const response = await addPermissionRequestAttachments(
        request.id,
        pending.map((item) => item.file),
        pending.map((item) => item.metadata),
      );
      if (isApiError(response)) {
        setUploadError(response.message);
        return;
      }
      onUpdated(response.data);
      setPending([]);
      notification.success({
        message: t("permissionRequests.evidence.added"),
      });
    } catch (error) {
      setUploadError(getHttpErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card
      title={t("permissionRequests.detail.attachments", {
        count: request.attachment_count ?? attachments.length,
      })}
      style={{ marginTop: 16 }}
    >
      {attachments.length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {attachments.map((attachment) => {
            const metadata = parseCaptureMetadata(attachment.capture_metadata);
            return (
              <li
                key={attachment.id}
                style={{ padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}
              >
                <Flex justify="space-between" align="center" gap={8} wrap>
                  <Flex vertical gap={2} style={{ minWidth: 0 }}>
                    <Typography.Text strong style={{ wordBreak: "break-all" }}>
                      {attachment.original_filename}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      <span dir="ltr">
                        {formatFileSize(attachment.size_bytes)}
                      </span>{" "}
                      · {formatDateTime(attachment.created_at)}
                    </Typography.Text>
                    {metadata?.source === "camera" && (
                      <Flex gap={6} align="center" wrap>
                        <Tag style={{ marginInlineEnd: 0 }}>
                          {t("permissionRequests.evidence.cameraTag")}
                        </Tag>
                        {typeof metadata.captured_at === "string" && (
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {t("permissionRequests.evidence.capturedAt", {
                              time: formatDateTime(metadata.captured_at),
                            })}
                          </Typography.Text>
                        )}
                      </Flex>
                    )}
                  </Flex>
                  <Button
                    icon={<DownloadOutlined />}
                    loading={downloadingId === attachment.id}
                    onClick={() => void download(attachment)}
                    aria-label={`${t("permissionRequests.evidence.download")} ${attachment.original_filename}`}
                  >
                    {t("permissionRequests.evidence.download")}
                  </Button>
                </Flex>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("permissionRequests.evidence.empty")}
        />
      )}
      {canAdd && (
        <Flex vertical gap={8} style={{ marginTop: 16 }}>
          <Typography.Text strong>
            {t("permissionRequests.evidence.add")}
          </Typography.Text>
          <EvidencePicker
            value={pending}
            onChange={setPending}
            disabled={uploading}
          />
          {uploadError && (
            <Alert
              type="error"
              showIcon
              title={t("permissionRequests.evidence.addFailed")}
              description={uploadError}
            />
          )}
          <Button
            type="primary"
            disabled={!pending.length}
            loading={uploading}
            onClick={() => void upload()}
            style={{ alignSelf: "flex-start" }}
          >
            {t("permissionRequests.evidence.addSelected")}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
