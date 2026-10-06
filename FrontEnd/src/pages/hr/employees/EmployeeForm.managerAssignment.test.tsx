import { useEffect } from "react";
import type { ComponentProps } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Form } from "antd";
import type { FormInstance } from "antd";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../services/api/employeesApi", () => ({
  listManagerOptions: vi.fn(),
}));

import EmployeeForm from "./EmployeeForm";
import * as employeesApi from "../../../services/api/employeesApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const listManagerOptions =
  employeesApi.listManagerOptions as unknown as ReturnType<typeof vi.fn>;

const OPTIONS = [
  {
    id: 2,
    employee_id: "E-002",
    full_name: "Bilal Employee",
    full_name_en: "Bilal Employee",
    full_name_ar: "بلال الموظف",
  },
  {
    id: 3,
    employee_id: "E-003",
    full_name: "Carla Lead",
    full_name_en: "Carla Lead",
    full_name_ar: "",
  },
];

function page(items: typeof OPTIONS) {
  return {
    status: "success",
    data: {
      items,
      page: 1,
      page_size: 20,
      count: items.length,
      total_pages: 1,
    },
  };
}

type FormProps = ComponentProps<typeof EmployeeForm>;

type HarnessProps = Omit<FormProps, "form"> & {
  initialManagerId?: number | null;
  onForm?: (form: FormInstance) => void;
};

let formRef: FormInstance | null = null;

function Harness({ initialManagerId, onForm, ...props }: HarnessProps) {
  const [form] = Form.useForm();
  useEffect(() => {
    // Mirrors EditEmployeePage prefilling the saved manager id.
    form.setFieldsValue({ manager_profile_id: initialManagerId ?? null });
    onForm?.(form);
  }, [form, initialManagerId, onForm]);
  return (
    <MemoryRouter>
      <EmployeeForm form={form} {...props} />
    </MemoryRouter>
  );
}

function renderForm(props: Partial<HarnessProps> = {}) {
  return render(
    <Harness
      onForm={(form) => {
        formRef = form;
      }}
      refOptions={{
        departments: [],
        positions: [],
        taskGroups: [],
        sponsors: [],
      }}
      {...props}
    />,
  );
}

function openEmploymentTab() {
  fireEvent.click(screen.getByRole("tab", { name: /Employment Information/ }));
}

function managerInput() {
  // antd derives the input id from the Form.Item name.
  const input = document.querySelector<HTMLInputElement>("#manager_profile_id");
  expect(input).not.toBeNull();
  return input!;
}

beforeEach(() => {
  formRef = null;
  listManagerOptions.mockReset();
  listManagerOptions.mockResolvedValue(page(OPTIONS));
  useI18nStore.getState().setLanguage("en");
});

describe("EmployeeForm manager picker", () => {
  it("shows a single Manager field with no cross-company fields", () => {
    renderForm();
    openEmploymentTab();

    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Assigning a manager gives that person manager access for this employee's requests/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/organization scope/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/assignment expiry/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cross-company/i)).not.toBeInTheDocument();
    // Options are fetched lazily, on first open.
    expect(listManagerOptions).not.toHaveBeenCalled();
  });

  it("lists options as name and employee number, excluding the edited employee server-side", async () => {
    renderForm({ currentEmployeeId: 1 });
    openEmploymentTab();

    fireEvent.mouseDown(managerInput());

    expect(
      await screen.findByTitle("Bilal Employee (E-002)"),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Carla Lead (E-003)")).toBeInTheDocument();
    expect(listManagerOptions).toHaveBeenCalledWith(
      expect.objectContaining({ employee_profile_id: 1 }),
    );
  });

  it("searches the server with the typed text (debounced)", async () => {
    renderForm({ currentEmployeeId: 1 });
    openEmploymentTab();

    const input = managerInput();
    fireEvent.mouseDown(input);
    await screen.findByTitle("Bilal Employee (E-002)");

    listManagerOptions.mockResolvedValue(page([OPTIONS[1]]));
    fireEvent.change(input, { target: { value: "Car" } });

    await waitFor(() =>
      expect(listManagerOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Car", employee_profile_id: 1 }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTitle("Bilal Employee (E-002)"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTitle("Carla Lead (E-003)")).toBeInTheDocument();
  });

  it("stores only the chosen manager id in the form", async () => {
    renderForm({ currentEmployeeId: 1 });
    openEmploymentTab();

    fireEvent.mouseDown(managerInput());
    fireEvent.click(await screen.findByTitle("Carla Lead (E-003)"));

    await waitFor(() =>
      expect(formRef!.getFieldValue("manager_profile_id")).toBe(3),
    );
  });

  it("preselects the saved manager by name and can be cleared to null", async () => {
    renderForm({
      currentEmployeeId: 1,
      initialManagerId: 9,
      managerLabel: "Saved Manager",
    });
    openEmploymentTab();

    expect(await screen.findByText("Saved Manager")).toBeInTheDocument();
    expect(listManagerOptions).not.toHaveBeenCalled();

    const clear = managerInput()
      .closest(".ant-select")!
      .querySelector(".ant-select-clear");
    expect(clear).not.toBeNull();
    fireEvent.mouseDown(clear!);
    fireEvent.click(clear!);

    await waitFor(() =>
      expect(formRef!.getFieldValue("manager_profile_id")).toBeNull(),
    );
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
    ["The selected manager is archived.", "The selected manager is archived."],
    [
      "The selected manager must be an active employee.",
      "The selected manager must be an active employee with an active user account.",
    ],
    [
      "The selected manager must be linked to an active user account.",
      "The selected manager must have an active user account.",
    ],
    [
      "Manager assignment cannot create a reporting cycle.",
      "Manager assignment cannot create a reporting cycle.",
    ],
  ])(
    "renders the localized backend message '%s' inline",
    async (message, displayedMessage) => {
      renderForm({ managerAssignmentError: message });

      const alerts = await screen.findAllByRole("alert");
      expect(
        alerts.some((alert) => alert.textContent?.includes(displayedMessage)),
      ).toBe(true);
    },
  );
});
