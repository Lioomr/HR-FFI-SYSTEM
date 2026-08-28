import type { ComponentProps } from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Form } from "antd";
import { MemoryRouter } from "react-router-dom";

import EmployeeForm from "./EmployeeForm";
import type { Employee } from "../../../services/api/employeesApi";

const employees = [
  { id: 1, employee_id: "E-001", full_name_en: "Alice Manager" },
  { id: 2, employee_id: "E-002", full_name_en: "Bilal Employee" },
] as unknown as Employee[];

type FormProps = ComponentProps<typeof EmployeeForm>;

function Harness(props: Omit<FormProps, "form">) {
  const [form] = Form.useForm();
  return (
    <MemoryRouter>
      <EmployeeForm form={form} {...props} />
    </MemoryRouter>
  );
}

function renderForm(props: Partial<FormProps> = {}) {
  return render(
    <Harness
      refOptions={{
        departments: [],
        positions: [],
        taskGroups: [],
        sponsors: [],
        employees,
      }}
      {...props}
    />,
  );
}

function openEmploymentTab() {
  fireEvent.click(screen.getByRole("tab", { name: /Employment Information/ }));
}

describe("EmployeeForm direct manager assignment", () => {
  it("explains that assigning a manager grants approval access for that employee", () => {
    renderForm();
    openEmploymentTab();

    expect(screen.getByText("Direct Manager")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Assigning a direct manager gives that person manager access for this employee's requests/,
      ),
    ).toBeInTheDocument();
  });

  it("renders a backend rejection inline on the manager field", async () => {
    renderForm({
      managerAssignmentError: "An employee cannot be their own manager.",
    });

    // The tab holding the field is selected automatically so the message shows.
    expect(
      await screen.findByRole("tab", {
        name: /Employment Information/,
        selected: true,
      }),
    ).toBeInTheDocument();
    // Both the field-level help and the explanatory banner are announced.
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((alert) =>
        alert.textContent?.includes("This manager cannot be assigned"),
      ),
    ).toBe(true);
    expect(
      alerts.some((alert) =>
        alert.textContent?.includes("An employee cannot be their own manager."),
      ),
    ).toBe(true);
  });

  it.each([
    "The selected manager must belong to the employee's company.",
    "The selected manager is archived.",
    "The selected manager must be an active employee.",
    "Manager assignment cannot create a reporting cycle.",
  ])("renders the backend message '%s' inline", async (message) => {
    renderForm({ managerAssignmentError: message });

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent?.includes(message))).toBe(
      true,
    );
  });

  it("never offers the employee being edited as their own manager", async () => {
    renderForm({ currentEmployeeId: 1 });
    openEmploymentTab();

    // antd derives the input id from the Form.Item name.
    const managerSelect = document.querySelector("#manager_profile_id");
    expect(managerSelect).not.toBeNull();
    fireEvent.mouseDown(managerSelect!);

    expect(await screen.findByTitle("Bilal Employee")).toBeInTheDocument();
    expect(screen.queryByTitle("Alice Manager")).not.toBeInTheDocument();
  });
});
