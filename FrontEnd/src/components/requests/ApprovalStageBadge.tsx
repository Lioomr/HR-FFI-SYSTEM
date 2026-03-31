import { Tag } from "antd";

import type { WorkflowSnapshot } from "../../types/workflow";

const colorMap: Record<string, string> = {
  approved: "green",
  rejected: "red",
  cancelled: "default",
  in_review: "orange",
  submitted: "blue",
  draft: "default",
};

export default function ApprovalStageBadge({ workflow }: { workflow?: WorkflowSnapshot }) {
  if (!workflow) return null;
  const label = workflow.current_stage
    ? `${workflow.status.replace(/_/g, " ")} · ${workflow.current_stage.replace(/_/g, " ")}`
    : workflow.status.replace(/_/g, " ");
  return <Tag color={colorMap[workflow.status] || "default"}>{label}</Tag>;
}
