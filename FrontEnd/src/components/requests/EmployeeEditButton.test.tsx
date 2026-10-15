import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EmployeeEditButton from "./EmployeeEditButton";
import ApprovalTimeline from "./ApprovalTimeline";
import { useI18nStore } from "../../i18n/i18nStore";
import type { WorkflowSnapshot } from "../../types/workflow";

const snapshot = (can_edit?: boolean): WorkflowSnapshot => ({
  status: "in_review",
  can_edit,
  history: [],
});

function renderButton(request: { workflow?: WorkflowSnapshot }) {
  return render(
    <MemoryRouter initialEntries={["/list"]}>
      <Routes>
        <Route
          path="/list"
          element={<EmployeeEditButton request={request} to="/edit/5" />}
        />
        <Route path="/edit/5" element={<div>Edit page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => useI18nStore.getState().setLanguage("en"));

describe("EmployeeEditButton", () => {
  it.each([[false], [undefined]])("is hidden when can_edit is %s", (flag) => {
    renderButton({ workflow: snapshot(flag) });
    expect(
      screen.queryByRole("button", { name: "Edit request" }),
    ).not.toBeInTheDocument();
  });

  it("is hidden without a workflow snapshot", () => {
    renderButton({});
    expect(
      screen.queryByRole("button", { name: "Edit request" }),
    ).not.toBeInTheDocument();
  });

  it("navigates to the edit route when the server allows editing", () => {
    renderButton({ workflow: snapshot(true) });
    fireEvent.click(screen.getByRole("button", { name: "Edit request" }));
    expect(screen.getByText("Edit page")).toBeInTheDocument();
  });
});

describe("ApprovalTimeline edit rows", () => {
  const workflow: WorkflowSnapshot = {
    status: "in_review",
    history: [
      {
        id: 1,
        action: "edit",
        actor: { id: 2, full_name: "Sara Ahmed" },
        at: "2026-10-13T08:00:00Z",
        note: "reason, end_date",
      },
      { id: 2, action: "future_action", at: "2026-10-13T09:00:00Z" },
    ],
  };

  it("renders recorded edits as Edited by actor and tolerates unknown actions", () => {
    render(<ApprovalTimeline workflow={workflow} />);
    expect(screen.getByText(/Edited by Sara/)).toBeInTheDocument();
    expect(screen.getByText("reason, end_date")).toBeInTheDocument();
    expect(screen.getByText("future_action")).toBeInTheDocument();
  });

  it("renders the Arabic label", () => {
    useI18nStore.getState().setLanguage("ar");
    render(<ApprovalTimeline workflow={workflow} />);
    expect(screen.getByText(/عدّله/)).toBeInTheDocument();
  });
});
