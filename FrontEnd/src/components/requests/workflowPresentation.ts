import type { ApprovalFlowStage } from "./ApprovalFlowMap";
import type { WorkflowActor, WorkflowSnapshot } from "../../types/workflow";

type TranslateFn = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => string;

function toTitle(stage: string, t: TranslateFn) {
  const normalized = (stage || "").toLowerCase();
  const key = `workflow.stage.${normalized}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toState(
  stepKey: string,
  workflow?: WorkflowSnapshot,
): ApprovalFlowStage["state"] {
  if (!workflow) return "upcoming";
  if (stepKey === "cancelled") {
    return workflow.status === "cancelled" ? "cancelled" : "upcoming";
  }
  if (workflow.status === "rejected") {
    return workflow.current_stage === stepKey ||
      workflow.history.some(
        (item) =>
          item.action === "reject" &&
          (item.from_stage === stepKey || item.stage === stepKey),
      )
      ? "rejected"
      : workflow.history.some(
            (item) => item.stage === stepKey || item.from_stage === stepKey,
          )
        ? "completed"
        : "upcoming";
  }
  if (workflow.status === "cancelled") {
    return workflow.history.some(
      (item) =>
        item.stage === stepKey ||
        item.from_stage === stepKey ||
        item.to_stage === stepKey,
    )
      ? "completed"
      : "skipped";
  }
  if (
    workflow.status === "approved" ||
    workflow.history.some(
      (item) => item.stage === stepKey || item.from_stage === stepKey,
    )
  ) {
    if (workflow.current_stage === stepKey && workflow.status === "in_review")
      return "current";
    if (
      workflow.current_stage !== stepKey &&
      workflow.history.some(
        (item) => item.stage === stepKey || item.from_stage === stepKey,
      )
    ) {
      return "completed";
    }
  }
  if (workflow.current_stage === stepKey) return "current";
  return workflow.history.some(
    (item) => item.stage === stepKey || item.from_stage === stepKey,
  )
    ? "completed"
    : "upcoming";
}

/**
 * Recorded rows that are not stage decisions (owner edit and the employee
 * cancellation-request lifecycle). They must not mark a stage as handled.
 */
const NON_STAGE_ACTIONS = new Set([
  "edit",
  "cancellation_requested",
  "cancellation_declined",
  "cancellation_withdrawn",
]);

const ACTOR_LINE_ACTIONS = new Set(["submit", "approve", "reject", "cancel"]);

/**
 * Who acted on a stage, read from the recorded workflow history: "submitted"
 * and "cancelled" come from those actions, any other key from the reviewer
 * role that decided it. A stage still waiting falls back to its current actor.
 */
export function stageActorFromWorkflow(
  workflow:
    | (Pick<WorkflowSnapshot, "history" | "current_stage" | "current_actor"> & {
        status?: string;
      })
    | undefined
    | null,
  stageKey: string,
): WorkflowActor | null {
  if (!workflow) return null;
  const history = [...(workflow.history || [])].reverse();
  const find = (match: (item: (typeof history)[number]) => boolean) =>
    history.find((item) => !isNonStageAction(item.action) && match(item))
      ?.actor ?? null;

  if (stageKey === "submitted" || stageKey === "reported") {
    return find((item) => item.action === "submit");
  }
  if (stageKey === "cancelled") {
    return find((item) => item.action === "cancel");
  }
  if (
    workflow.current_stage === stageKey &&
    workflow.status === "in_review" &&
    workflow.current_actor
  ) {
    return workflow.current_actor;
  }
  return find(
    (item) =>
      item.action !== "submit" &&
      item.action !== "cancel" &&
      (item.approver_role === stageKey ||
        item.from_stage === stageKey ||
        item.stage === stageKey),
  );
}

/**
 * A cancelled request never reaches its remaining stages: they become
 * skipped, and a closing "Cancelled" step names who cancelled and when.
 */
export function withCancellation(
  stages: ApprovalFlowStage[],
  workflow: Parameters<typeof stageActorFromWorkflow>[0],
  t: TranslateFn,
  fallbackAt?: string | null,
): ApprovalFlowStage[] {
  const cancelEntry = [...(workflow?.history || [])]
    .reverse()
    .find((item) => item.action === "cancel");
  return [
    ...stages.map((stage) =>
      stage.state === "upcoming" || stage.state === "current"
        ? {
            ...stage,
            state: "skipped" as const,
            note: t("leave.approvalMap.notRequired"),
          }
        : stage,
    ),
    {
      key: "cancelled",
      title: t("status.cancelled"),
      state: "cancelled",
      note: cancelEntry?.note || "",
      actor: cancelEntry?.actor ?? null,
      at: cancelEntry?.at ?? fallbackAt,
    },
  ];
}

export function isNonStageAction(action: string | undefined): boolean {
  return action !== undefined && NON_STAGE_ACTIONS.has(action);
}

/** Per-actor timeline sentence key for rows that read "<what> by <actor>". */
export function actorSentenceKey(action: string): string | null {
  switch (action) {
    case "edit":
      return "workflow.action.editedBy";
    case "cancellation_requested":
      return "workflow.action.cancellationRequestedBy";
    case "cancellation_declined":
      return "workflow.action.cancellationDeclinedBy";
    case "cancellation_withdrawn":
      return "workflow.action.cancellationWithdrawnBy";
    default:
      return null;
  }
}

export function buildStagesFromWorkflow(
  recorded: WorkflowSnapshot | undefined,
  order: string[],
  t: TranslateFn,
): ApprovalFlowStage[] | null {
  if (!recorded) return null;
  // An owner edit is a recorded row, not a stage decision: it must not mark a
  // stage as handled or supply that stage's actor and note.
  const workflow: WorkflowSnapshot = {
    ...recorded,
    history: recorded.history.filter((item) => !isNonStageAction(item.action)),
  };
  const stageOrder =
    workflow.status === "cancelled" ? [...order, "cancelled"] : order;
  const cancellationEntry = [...workflow.history]
    .reverse()
    .find((item) => item.action === "cancel" || item.to_status === "cancelled");
  return stageOrder.map((stepKey) => {
    const latest = [...workflow.history]
      .reverse()
      .find(
        (item) =>
          item.stage === stepKey ||
          item.from_stage === stepKey ||
          item.to_stage === stepKey,
      );
    if (stepKey === "cancelled") {
      return {
        key: stepKey,
        title: toTitle(stepKey, t),
        state: "cancelled",
        note: cancellationEntry?.note || "Request cancelled by employee.",
        actor: cancellationEntry?.actor ?? null,
        at: cancellationEntry?.at,
      };
    }
    return {
      key: stepKey,
      title: toTitle(stepKey, t),
      state: toState(stepKey, workflow),
      detail:
        latest?.actor?.full_name || latest?.actor?.email
          ? t("workflow.handledBy", {
              name: latest.actor.full_name || latest.actor.email || "",
            })
          : workflow.current_stage === stepKey &&
              (workflow.current_actor?.full_name ||
                workflow.current_actor?.email)
            ? t("workflow.waitingFor", {
                name:
                  workflow.current_actor.full_name ||
                  workflow.current_actor.email ||
                  "",
              })
            : undefined,
      note:
        latest?.note ||
        (workflow.current_stage === stepKey
          ? t("workflow.currentAction", stepKey)
          : t("workflow.noUpdate", "No update yet")),
      // Only decisions read as "Approved by"/"Rejected by"; other moves such
      // as "advance" keep the neutral "Handled by" detail line.
      actor:
        (latest && ACTOR_LINE_ACTIONS.has(latest.action)
          ? latest.actor
          : null) ??
        (workflow.current_stage === stepKey ? workflow.current_actor : null) ??
        null,
      at: latest?.at,
    };
  });
}
