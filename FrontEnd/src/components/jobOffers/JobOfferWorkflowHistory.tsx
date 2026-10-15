import { Typography } from "antd";

import ApprovalFlowMap, {
  type ApprovalFlowStage,
} from "../requests/ApprovalFlowMap";
import type {
  JobOfferWorkflowActor,
  JobOfferWorkflowHistoryEntry,
} from "../../services/api/jobOffersApi";
import { useI18n } from "../../i18n/useI18n";

const { Text } = Typography;

function actorName(actor: JobOfferWorkflowActor | null | undefined): string {
  if (!actor) return "";
  return (actor.full_name || actor.email || "").trim();
}

// Recorded actions that read as "<verb> by <name>"; others keep "Handled by".
const ACTION_VERBS: Partial<Record<string, ApprovalFlowStage["actorVerb"]>> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
};

function getState(action: string): ApprovalFlowStage["state"] {
  if (action === "reject") return "rejected";
  if (action === "cancel") return "cancelled";
  return "completed";
}

/**
 * The approval trail exactly as the backend recorded it.
 *
 * Action names are translated when known and fall back to the raw action, so a
 * workflow step added later still shows up as a dated entry instead of
 * vanishing from the history.
 */
export default function JobOfferWorkflowHistory({
  history,
}: {
  history?: JobOfferWorkflowHistoryEntry[] | null;
}) {
  const { t } = useI18n();
  const entries = history || [];

  if (entries.length === 0) {
    return <Text type="secondary">{t("jobOffers.workflow.empty")}</Text>;
  }

  const stages: ApprovalFlowStage[] = entries.map((entry, index) => {
    const role = entry.approver_role || entry.stage || entry.to_stage;
    const who = actorName(entry.actor);
    const actorVerb = ACTION_VERBS[entry.action];
    const details = [
      role ? t(`workflow.role.${role}`, role.toUpperCase()) : "",
      who && !actorVerb ? t("workflow.handledBy", { name: who }) : "",
    ].filter(Boolean);

    return {
      key: `job-offer-event-${entry.id ?? index}`,
      title: t(`jobOffers.workflow.action.${entry.action}`, entry.action),
      state: getState(entry.action),
      detail: details.join(" · ") || undefined,
      actor: actorVerb ? entry.actor : null,
      actorVerb,
      note: entry.note || t("workflow.noUpdate", "No update yet"),
      at: entry.at,
    };
  });

  return (
    <ApprovalFlowMap
      eyebrow={t("jobOffers.workflow.eyebrow")}
      title={t("jobOffers.workflow.title")}
      stages={stages}
      t={t}
    />
  );
}
