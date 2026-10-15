import { describe, expect, it } from "vitest";

import type { ApprovalFlowStage } from "./ApprovalFlowMap";
import {
  stageActorFromWorkflow,
  withCancellation,
} from "./workflowPresentation";
import type { WorkflowSnapshot } from "../../types/workflow";

const t = (key: string) => key;
const employee = { id: 1, full_name: "Zeyad Abdulhamid" };
const manager = { id: 2, full_name: "Sara Ali" };
const hr = { id: 3, full_name: "Huda Ali" };

const workflow = (
  overrides: Partial<WorkflowSnapshot> = {},
): WorkflowSnapshot => ({
  status: "in_review",
  current_stage: "hr",
  current_actor: hr,
  history: [
    { action: "submit", approver_role: "", actor: employee },
    { action: "approve", approver_role: "manager", actor: manager },
    // An owner edit is not a stage decision and names no stage actor.
    { action: "edit", approver_role: "manager", actor: employee },
  ],
  ...overrides,
});

describe("stageActorFromWorkflow", () => {
  it("reads the submitter, the deciding reviewer and the waiting actor", () => {
    const snapshot = workflow();
    expect(stageActorFromWorkflow(snapshot, "submitted")).toBe(employee);
    expect(stageActorFromWorkflow(snapshot, "manager")).toBe(manager);
    expect(stageActorFromWorkflow(snapshot, "hr")).toBe(hr);
    expect(stageActorFromWorkflow(snapshot, "ceo")).toBeNull();
  });

  it("names who cancelled, without crediting it to a review stage", () => {
    const snapshot = workflow({
      status: "cancelled",
      history: [
        { action: "submit", approver_role: "", actor: employee },
        { action: "cancel", approver_role: "hr", actor: hr },
      ],
    });
    expect(stageActorFromWorkflow(snapshot, "cancelled")).toBe(hr);
    expect(stageActorFromWorkflow(snapshot, "hr")).toBeNull();
  });
});

describe("withCancellation", () => {
  it("skips unreached stages and closes with who cancelled", () => {
    const stages: ApprovalFlowStage[] = [
      { key: "submitted", title: "s", state: "completed", note: "" },
      { key: "hr", title: "h", state: "current", note: "" },
    ];
    const result = withCancellation(
      stages,
      workflow({
        status: "cancelled",
        history: [
          {
            action: "cancel",
            approver_role: "",
            actor: employee,
            at: "2026-10-14T09:08:00Z",
          },
        ],
      }),
      t,
    );

    expect(result.map((stage) => stage.state)).toEqual([
      "completed",
      "skipped",
      "cancelled",
    ]);
    expect(result[2].actor).toBe(employee);
    expect(result[2].at).toBe("2026-10-14T09:08:00Z");
  });
});
