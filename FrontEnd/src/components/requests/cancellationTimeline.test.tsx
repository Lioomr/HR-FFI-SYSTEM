import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ApprovalTimeline from "./ApprovalTimeline";
import {
  buildStagesFromWorkflow,
  isNonStageAction,
} from "./workflowPresentation";
import { useI18nStore } from "../../i18n/i18nStore";
import type { WorkflowSnapshot } from "../../types/workflow";

const actor = { id: 1, full_name: "Sara Ahmed" };
const workflow: WorkflowSnapshot = {
  status: "approved",
  history: [
    { action: "cancellation_requested", stage: "hr", actor, at: null },
    { action: "cancellation_declined", stage: "hr", actor, at: null },
    { action: "cancellation_withdrawn", stage: "hr", actor, at: null },
    { action: "mystery_action", actor, at: null },
  ],
};

beforeEach(() => useI18nStore.getState().setLanguage("en"));

describe("cancellation request history rows", () => {
  it("renders the three actions with the actor and keeps unknown actions raw", () => {
    render(<ApprovalTimeline workflow={workflow} />);
    expect(
      screen.getByText("Cancellation requested by Sara Ahmed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cancellation declined by Sara Ahmed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cancellation request withdrawn by Sara Ahmed"),
    ).toBeInTheDocument();
    expect(screen.getByText("mystery_action")).toBeInTheDocument();
  });

  it("renders Arabic labels", async () => {
    await useI18nStore.getState().setLanguage("ar");
    render(<ApprovalTimeline workflow={workflow} />);
    expect(screen.getAllByText(/طلب الإلغاء بواسطة/).length).toBeGreaterThan(0);
  });

  it("does not mark approval stages as handled", () => {
    expect(isNonStageAction("cancellation_requested")).toBe(true);
    expect(isNonStageAction("approve")).toBe(false);
    const stages = buildStagesFromWorkflow(
      {
        status: "in_review",
        current_stage: "hr",
        history: [{ action: "cancellation_requested", stage: "hr", actor }],
      },
      ["manager", "hr"],
      ((key: string) => key) as never,
    );
    expect(stages?.find((stage) => stage.key === "hr")?.state).toBe("current");
  });
});
