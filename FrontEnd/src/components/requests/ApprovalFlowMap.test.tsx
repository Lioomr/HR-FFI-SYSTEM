import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApprovalFlowMap, { type ApprovalFlowStage } from "./ApprovalFlowMap";

const t = (key: string) => key;
const stage = (
  key: string,
  state: ApprovalFlowStage["state"],
  at?: string,
): ApprovalFlowStage => ({ key, title: key, state, note: "", at });

describe("ApprovalFlowMap", () => {
  beforeEach(() => {
    // Desktop width: every stage renders as a full card.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("only says 'awaiting action' on the stage being waited on", () => {
    render(
      <ApprovalFlowMap
        eyebrow="e"
        title="t"
        t={t}
        stages={[
          stage("submitted", "completed", "2026-01-01T10:00:00Z"),
          stage("delegate", "skipped"),
          stage("manager", "completed"),
          stage("hr", "current"),
          stage("ceo", "upcoming"),
        ]}
      />,
    );

    expect(screen.getAllByText("leave.approvalMap.noDate")).toHaveLength(1);
    expect(screen.getAllByText("leave.approvalMap.notReached")).toHaveLength(1);
  });

  it("says how many stages were left out of the progress count", () => {
    render(
      <ApprovalFlowMap
        eyebrow="e"
        title="t"
        t={t}
        stages={[stage("a", "completed"), stage("b", "skipped")]}
      />,
    );

    expect(screen.getByText(/workflow\.progressSkipped/)).toBeInTheDocument();
  });
});
