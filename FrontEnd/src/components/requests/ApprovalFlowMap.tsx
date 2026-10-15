import { useEffect, useRef, useState } from "react";
import {
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DownOutlined,
  StopOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { Button, Card, Grid } from "antd";
import { useAuthStore } from "../../auth/authStore";
import type { WorkflowActor } from "../../types/workflow";
import { formatDateTime } from "../../utils/dateTime";
import { shortEmployeeName } from "../../utils/employeeName";
import "./ApprovalFlowMap.css";

type TranslateFn = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => string;

export type ApprovalFlowStage = {
  key: string;
  title: string;
  labelKey?: string;
  state:
    | "completed"
    | "current"
    | "rejected"
    | "upcoming"
    | "skipped"
    | "cancelled";
  note: string;
  detail?: string;
  /** Who acted on (or is holding) this stage; drives "Cancelled by you". */
  actor?: StageActor | null;
  /**
   * What the actor did, when the state alone can't say it (an event list
   * where "completed" may be a submission). Defaults from state and key.
   */
  actorVerb?: ActorVerb;
  at?: string | null;
};

export type StageActor = Omit<WorkflowActor, "id"> & { id?: number | null };
type ActorVerb =
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "current";

// Stages whose completion means the request was sent, not approved.
const SUBMISSION_STAGE_KEYS = new Set([
  "submitted",
  "manual_entry",
  "reported",
]);

const AVATAR_COLORS = ["#334155", "#7c3aed", "#0e7490", "#b45309", "#be185d"];

function isClosingState(state: ApprovalFlowStage["state"]) {
  return state === "rejected" || state === "cancelled";
}

// "Manager: Sara Ali" -> "Sara Ali": the detail line carries a role prefix.
function getActorName(detail: string) {
  return detail.includes(":")
    ? detail.slice(detail.lastIndexOf(":") + 1).trim()
    : detail.trim();
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

function getAvatarColor(name: string) {
  const sum = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function getStageIcon(state: ApprovalFlowStage["state"], number: number) {
  switch (state) {
    case "completed":
      return <CheckOutlined />;
    case "current":
      return <span className="afm-live-dot" />;
    case "rejected":
      return <CloseOutlined />;
    case "cancelled":
      return <StopOutlined />;
    default:
      return number;
  }
}

export default function ApprovalFlowMap({
  eyebrow,
  title,
  stages,
  t,
}: {
  eyebrow: string;
  title: string;
  stages: ApprovalFlowStage[];
  t: TranslateFn;
}) {
  const getStateLabel = (state: ApprovalFlowStage["state"]) => {
    if (state === "cancelled") {
      const translated = t("status.cancelled");
      return translated === "status.cancelled" ? "Cancelled" : translated;
    }
    return t(`leave.approvalMap.${state}`);
  };

  const getStageLabel = (stage: ApprovalFlowStage) =>
    stage.labelKey
      ? t(stage.labelKey, stage.title)
      : t(`workflow.role.${stage.key}`, stage.title);

  // An undated stage only says "Awaiting action" while it is the one being
  // waited on; a finished, skipped or closed stage must not claim that.
  const getTimeText = (stage: ApprovalFlowStage) =>
    stage.at
      ? `${t("workflow.updated")} ${formatDateTime(stage.at)}`
      : stage.state === "current"
        ? t("leave.approvalMap.noDate")
        : stage.state === "upcoming"
          ? t("leave.approvalMap.notReached")
          : "";

  const currentUser = useAuthStore((state) => state.user);
  const isCurrentUser = (actor: StageActor) =>
    !!currentUser &&
    // Some APIs only send a name, with a placeholder id of 0.
    ((!!actor.id && String(actor.id) === String(currentUser.id)) ||
      (!!actor.email &&
        actor.email.toLowerCase() === currentUser.email?.toLowerCase()));

  // "Cancelled by you" / "Approved by Sara Ali": names who acted on a stage.
  const getActorLine = (stage: ApprovalFlowStage) => {
    const actor = stage.actor;
    const name = shortEmployeeName(actor?.full_name) || actor?.email || "";
    if (!actor || !name) return "";
    const verb =
      stage.actorVerb ??
      (stage.state === "completed"
        ? SUBMISSION_STAGE_KEYS.has(stage.key)
          ? "submitted"
          : "approved"
        : stage.state === "upcoming" || stage.state === "skipped"
          ? ""
          : stage.state);
    if (!verb) return "";
    return isCurrentUser(actor)
      ? t(`workflow.actorLine.${verb}You`)
      : t(`workflow.actorLine.${verb}`, { name });
  };

  const activeStages = stages.filter((stage) => stage.state !== "skipped");
  const skippedStages = stages.filter((stage) => stage.state === "skipped");
  const completedStages = activeStages.filter(
    (stage) => stage.state === "completed",
  ).length;
  const currentStage = stages.find((stage) => stage.state === "current");
  const terminalStage = stages.find((stage) => isClosingState(stage.state));
  const tone = terminalStage
    ? "stop"
    : currentStage || completedStages < activeStages.length
      ? "live"
      : "done";
  const statusLabel = terminalStage
    ? getStateLabel(terminalStage.state)
    : currentStage
      ? getStateLabel("current")
      : getStateLabel("completed");
  const progressSummary = t("workflow.progressSummary", {
    completed: completedStages,
    total: activeStages.length,
  });

  // The panel spotlights the stage being waited on, or the one that closed
  // the flow; a fully approved flow shows its last stage.
  const focusStage =
    terminalStage ?? currentStage ?? activeStages[activeStages.length - 1];
  const focusIndex = focusStage ? activeStages.indexOf(focusStage) : -1;
  const historyStages = activeStages.filter((stage) => stage !== focusStage);

  // On phones the history list stays folded until asked for.
  const isMobile = !Grid.useBreakpoint().md;
  const [showAll, setShowAll] = useState(false);
  const showHistory = !isMobile || showAll;

  // When the stepper overflows (narrow screens, long flows), bring the focus
  // step into view instead of leaving it scrolled off to the side.
  const stepsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = stepsRef.current;
    const item = list?.children[focusIndex] as HTMLElement | undefined;
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const offset = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
    // RTL scroll positions run from 0 down to a negative maximum.
    const isRtl = getComputedStyle(list).direction === "rtl";
    list.scrollLeft = isRtl
      ? offset - (list.scrollWidth - list.clientWidth)
      : offset;
  }, [focusIndex, activeStages.length]);

  const renderFocusPanel = (stage: ApprovalFlowStage) => {
    const number = activeStages.indexOf(stage) + 1;
    const stateLabel = getStateLabel(stage.state);
    const stageLabel = getStageLabel(stage);
    const kicker =
      !currentStage && !terminalStage
        ? t("workflow.flowComplete")
        : stateLabel.trim().toLowerCase() === stageLabel.trim().toLowerCase()
          ? t("workflow.step", { number })
          : stateLabel;
    // Skip notes that only repeat the state label ("Cancelled" / "Cancelled").
    const note =
      stage.note &&
      stage.note.trim().toLowerCase() !== stateLabel.trim().toLowerCase()
        ? stage.note
        : "";
    const actorLine = getActorLine(stage);
    const actorName = actorLine
      ? shortEmployeeName(stage.actor?.full_name) || stage.actor?.email || ""
      : stage.detail
        ? getActorName(stage.detail)
        : "";
    const timeText = getTimeText(stage);

    return (
      <div
        className={`afm-panel afm-s-${stage.state}`}
        aria-current={stage.state === "current" ? "step" : undefined}
      >
        <div className="afm-panel-kicker">{kicker}</div>
        <div className="afm-panel-title">{stageLabel}</div>
        {actorLine || stage.detail ? (
          <div className="afm-actor">
            <span
              className="afm-avatar"
              aria-hidden="true"
              style={{ background: getAvatarColor(actorName) }}
            >
              {getInitials(actorName)}
            </span>
            <span className="afm-actor-name">{actorLine || stage.detail}</span>
          </div>
        ) : null}
        {note ? <p className="afm-panel-note">{note}</p> : null}
        {timeText ? (
          <div className="afm-time">
            <ClockCircleOutlined aria-hidden="true" />
            {timeText}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Card className="afm" bordered={false}>
      <div className="afm-top">
        <div style={{ minWidth: 0 }}>
          <span className="afm-eyebrow">{eyebrow}</span>
          <h3 className="afm-title">{title}</h3>
          <span className="afm-meta">
            {progressSummary}
            {skippedStages.length > 0
              ? ` · ${t("workflow.progressSkipped", { count: skippedStages.length })}`
              : ""}
          </span>
        </div>
        <span className={`afm-badge afm-t-${tone}`}>
          <span className="afm-badge-dot" aria-hidden="true" />
          {statusLabel} · {completedStages}/{activeStages.length}
        </span>
      </div>

      <ol ref={stepsRef} className="afm-steps" aria-label={progressSummary}>
        {activeStages.map((stage, index) => (
          <li
            key={stage.key}
            className={`afm-step afm-s-${stage.state}`}
            title={getStageLabel(stage)}
          >
            <span className="afm-dot" aria-hidden="true">
              {getStageIcon(stage.state, index + 1)}
            </span>
            <span className="afm-step-label">{getStageLabel(stage)}</span>
            <span className="afm-step-state">{getStateLabel(stage.state)}</span>
          </li>
        ))}
      </ol>

      {skippedStages.length > 0 ? (
        <div className="afm-skipped">
          <span className="afm-skipped-label">{getStateLabel("skipped")}</span>
          {skippedStages.map((stage) => (
            <span key={stage.key} className="afm-skipped-name">
              {getStageLabel(stage)}
            </span>
          ))}
        </div>
      ) : null}

      {focusStage ? renderFocusPanel(focusStage) : null}

      {showHistory && historyStages.length > 0 ? (
        <ul className="afm-history">
          {historyStages.map((stage) => {
            const number = activeStages.indexOf(stage) + 1;
            const timeText = getTimeText(stage);
            const actorText = getActorLine(stage) || stage.detail;
            const note =
              stage.note &&
              stage.note.trim().toLowerCase() !==
                getStateLabel(stage.state).trim().toLowerCase()
                ? stage.note
                : "";
            return (
              <li
                key={stage.key}
                className={`afm-history-item afm-s-${stage.state}`}
              >
                <span className="afm-history-icon" aria-hidden="true">
                  {getStageIcon(stage.state, number)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="afm-history-name">
                    {getStageLabel(stage)}
                  </span>
                  {actorText ? (
                    <>
                      <span className="afm-history-detail" aria-hidden="true">
                        {" · "}
                      </span>
                      <span className="afm-history-detail">{actorText}</span>
                    </>
                  ) : null}
                  {note ? (
                    <span className="afm-history-note">{note}</span>
                  ) : null}
                </span>
                {timeText ? (
                  <span className="afm-history-time">{timeText}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {isMobile && historyStages.length > 0 ? (
        <Button
          type="link"
          block
          className="afm-toggle"
          icon={
            showAll ? <UpOutlined aria-hidden /> : <DownOutlined aria-hidden />
          }
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? t("workflow.hideDetails") : t("workflow.showDetails")}
        </Button>
      ) : (
        <div style={{ height: 8 }} />
      )}
    </Card>
  );
}
