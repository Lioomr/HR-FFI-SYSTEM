import { Alert } from "antd";

import type { WorkflowSnapshot } from "../../types/workflow";

export default function PendingActionBanner({ workflow }: { workflow?: WorkflowSnapshot }) {
  if (!workflow || workflow.status !== "in_review") return null;
  const actor = workflow.current_actor?.full_name || workflow.current_actor?.email;
  const stage = workflow.current_stage?.replace(/_/g, " ");
  return (
    <Alert
      type="info"
      showIcon
      message={actor ? `Waiting for ${actor}` : `Waiting for ${stage || workflow.current_approver_role || "approval"}`}
    />
  );
}
