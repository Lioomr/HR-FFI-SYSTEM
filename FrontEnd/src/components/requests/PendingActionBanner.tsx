import { Alert } from "antd";

import type { WorkflowSnapshot } from "../../types/workflow";
import { useI18n } from "../../i18n/useI18n";

export default function PendingActionBanner({ workflow }: { workflow?: WorkflowSnapshot }) {
  const { t } = useI18n();
  if (!workflow || workflow.status !== "in_review") return null;
  const actor = workflow.current_actor?.full_name || workflow.current_actor?.email;
  const stage = workflow.current_stage;

  let message: string;
  if (actor) {
    message = t("pendingBanner.waitingForActor", { actor }, `Waiting for ${actor}`);
  } else if (stage === "hr_completion") {
    message = t("pendingBanner.waitingHrCompletion", "Waiting for HR to complete the request.");
  } else {
    const stageLabel = stage?.replace(/_/g, " ") || workflow.current_approver_role || "approval";
    message = t("pendingBanner.waitingForStage", { stage: stageLabel }, `Waiting for ${stageLabel}`);
  }

  return <Alert type="info" showIcon message={message} />;
}
