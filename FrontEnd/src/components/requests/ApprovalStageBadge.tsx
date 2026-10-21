import { Tag } from "antd";

import type { WorkflowSnapshot } from "../../types/workflow";
import { useI18n } from "../../i18n/useI18n";
import { approvalStageLabel, approvalStatusLabel } from "./approvalLabels";

const colorMap: Record<string, string> = {
  approved: "green",
  rejected: "red",
  cancelled: "default",
  in_review: "orange",
  submitted: "blue",
  draft: "default",
};

export default function ApprovalStageBadge({
  workflow,
}: {
  workflow?: WorkflowSnapshot;
}) {
  const { t } = useI18n();
  if (!workflow) return null;
  const status = approvalStatusLabel(t, workflow.status);
  const label = workflow.current_stage
    ? `${status} · ${approvalStageLabel(t, workflow.current_stage)}`
    : status;
  return <Tag color={colorMap[workflow.status] || "default"}>{label}</Tag>;
}
