import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { Tag } from "antd";
import type { ReactNode } from "react";

import { toneForStatus, type ApprovalStatusTone } from "./approvalStatusLabel";

export type { ApprovalStatusTone };

const TONE_PRESETS: Record<ApprovalStatusTone, { color: string; icon: ReactNode }> = {
  // Every tone pairs a colour with a distinct glyph so the state is still
  // readable without colour perception.
  pending: { color: "gold", icon: <ClockCircleOutlined aria-hidden /> },
  inProgress: { color: "processing", icon: <SyncOutlined aria-hidden /> },
  approved: { color: "green", icon: <CheckCircleOutlined aria-hidden /> },
  rejected: { color: "red", icon: <CloseCircleOutlined aria-hidden /> },
  neutral: { color: "default", icon: <MinusCircleOutlined aria-hidden /> },
};

/**
 * One status pill for every CEO approval screen. Renders an icon next to the
 * label so the meaning never depends on colour alone.
 */
export default function ApprovalStatusTag({
  label,
  status,
  tone,
}: {
  /** Already-translated text. */
  label: string;
  /** Raw backend status, used to derive the tone when `tone` is not given. */
  status?: string;
  tone?: ApprovalStatusTone;
}) {
  const preset = TONE_PRESETS[tone ?? toneForStatus(status)];
  return (
    <Tag
      color={preset.color}
      icon={preset.icon}
      style={{ marginInlineEnd: 0, borderRadius: 999, paddingInline: 10, fontWeight: 600 }}
    >
      {label}
    </Tag>
  );
}
