import { useRef, useState } from "react";
import { Button, Flex, Tag, Typography } from "antd";
import {
  CameraOutlined,
  DeleteOutlined,
  FileOutlined,
  PaperClipOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../../i18n/useI18n";
import type { CaptureMetadata } from "../../../services/api/permissionRequestsApi";
import {
  EVIDENCE_ACCEPT,
  evidenceProblem,
  formatFileSize,
  normalizeEvidenceFile,
} from "./permissionRequestHelpers";

export type EvidenceItem = {
  uid: string;
  file: File;
  metadata?: CaptureMetadata;
};

type Props = {
  value?: EvidenceItem[];
  onChange?: (items: EvidenceItem[]) => void;
  disabled?: boolean;
  /** Set by Form.Item so the label points at the picker. */
  id?: string;
};

let nextUid = 0;

/**
 * Evidence files from the device or the camera. Files are checked against the
 * server's type and size rules before they are queued; camera captures carry
 * `{ source: "camera", captured_at }` metadata.
 */
export default function EvidencePicker({
  value = [],
  onChange,
  disabled,
  id,
}: Props) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [rejections, setRejections] = useState<string[]>([]);

  function addFiles(list: FileList | null, source: "upload" | "camera") {
    if (!list?.length) return;
    const accepted: EvidenceItem[] = [];
    const rejected: string[] = [];
    Array.from(list).forEach((raw) => {
      const file = normalizeEvidenceFile(raw);
      const problem = evidenceProblem(file);
      if (problem) {
        rejected.push(
          t(`permissionRequests.evidence.${problem}`, { name: file.name }),
        );
        return;
      }
      nextUid += 1;
      accepted.push({
        uid: `evidence-${nextUid}`,
        file,
        metadata:
          source === "camera"
            ? {
                source: "camera",
                captured_at: new Date(
                  file.lastModified || Date.now(),
                ).toISOString(),
              }
            : undefined,
      });
    });
    setRejections(rejected);
    if (accepted.length) onChange?.([...value, ...accepted]);
  }

  return (
    <Flex vertical gap={8}>
      <Flex wrap gap={8}>
        <Button
          id={id}
          icon={<PaperClipOutlined />}
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          {t("permissionRequests.evidence.choose")}
        </Button>
        <Button
          icon={<CameraOutlined />}
          disabled={disabled}
          onClick={() => cameraInput.current?.click()}
        >
          {t("permissionRequests.evidence.camera")}
        </Button>
      </Flex>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        // The app stylesheet overrides the `hidden` attribute for inputs.
        style={{ display: "none" }}
        accept={EVIDENCE_ACCEPT}
        data-testid="evidence-file-input"
        onChange={(event) => {
          addFiles(event.target.files, "upload");
          event.target.value = "";
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        hidden
        style={{ display: "none" }}
        accept="image/*"
        capture="environment"
        data-testid="evidence-camera-input"
        onChange={(event) => {
          addFiles(event.target.files, "camera");
          event.target.value = "";
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("permissionRequests.evidence.help")}
      </Typography.Text>
      {rejections.map((text) => (
        <Typography.Text key={text} type="danger">
          {text}
        </Typography.Text>
      ))}
      {value.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {value.map((item) => (
            <li
              key={item.uid}
              style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}
            >
              <Flex align="center" gap={8} wrap>
                <FileOutlined />
                <Typography.Text
                  ellipsis={{ tooltip: item.file.name }}
                  style={{ maxWidth: 220 }}
                >
                  {item.file.name}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <span dir="ltr">{formatFileSize(item.file.size)}</span>
                </Typography.Text>
                {item.metadata?.source === "camera" && (
                  <Tag style={{ marginInlineEnd: 0 }}>
                    {t("permissionRequests.evidence.cameraTag")}
                  </Tag>
                )}
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={disabled}
                  aria-label={t("permissionRequests.evidence.remove", {
                    name: item.file.name,
                  })}
                  onClick={() =>
                    onChange?.(value.filter((entry) => entry.uid !== item.uid))
                  }
                />
              </Flex>
            </li>
          ))}
        </ul>
      )}
    </Flex>
  );
}
