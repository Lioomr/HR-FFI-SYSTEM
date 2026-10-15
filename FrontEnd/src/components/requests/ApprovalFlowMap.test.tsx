import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../../auth/authStore";
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

  it("names who acted, and says 'you' for the signed-in user", () => {
    useAuthStore.setState({
      user: { id: "7", email: "zeyad@ffi.test", role: "Employee" },
    });
    const tWithName = (key: string, params?: unknown) =>
      params && typeof params === "object" && "name" in params
        ? `${key}:${(params as { name: string }).name}`
        : key;
    render(
      <ApprovalFlowMap
        eyebrow="e"
        title="t"
        t={tWithName}
        stages={[
          {
            ...stage("submitted", "completed"),
            actor: { id: 7, full_name: "Zeyad Abdulhamid" },
          },
          {
            ...stage("manager", "completed"),
            actor: { id: 9, full_name: "Sara Ali" },
          },
          {
            ...stage("cancelled", "cancelled"),
            actor: { id: 7, full_name: "Zeyad Abdulhamid" },
          },
        ]}
      />,
    );

    expect(
      screen.getByText("workflow.actorLine.cancelledYou"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workflow.actorLine.submittedYou"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workflow.actorLine.approved:Sara Ali"),
    ).toBeInTheDocument();
    useAuthStore.setState({ user: null });
  });
});
