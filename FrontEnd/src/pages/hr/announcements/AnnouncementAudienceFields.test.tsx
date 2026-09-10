// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Form } from "antd";
import AnnouncementAudienceFields from "./AnnouncementAudienceFields";

vi.mock("../../../services/api/employeesApi", () => ({
  listDelegationCandidates: vi.fn().mockResolvedValue({
    status: "success",
    data: [{ id: 41, full_name: "Employee One", employee_id: "E01" }],
  }),
}));
const t = (key: string, fallback?: string) => fallback || key;
vi.mock("../../../i18n/useI18n", () => ({ useI18n: () => ({ t }) }));
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(cleanup);

describe("shared create/edit audience selector", () => {
  it("offers company, selected employees, and CEO without retired roles", async () => {
    render(
      <Form initialValues={{ audience: "COMPANY" }}>
        <AnnouncementAudienceFields />
      </Form>,
    );
    fireEvent.mouseDown(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getAllByText("CEO").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Whole company").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("hr.announcements.selectedEmployeesLabel").length,
    ).toBeGreaterThan(0);
    for (const role of ["ADMIN", "MANAGER", "HR_MANAGER", "CFO", "EMPLOYEE"])
      expect(screen.queryByText(role)).toBeNull();
  });
  it("loads selected employees independently of announcement type", async () => {
    render(
      <Form
        initialValues={{ audience: "SELECTED", announcement_type: "GENERAL" }}
      >
        <AnnouncementAudienceFields />
      </Form>,
    );
    const selectors = screen.getAllByRole("combobox");
    expect(selectors).toHaveLength(2);
    fireEvent.mouseDown(selectors[1]);
    await waitFor(() =>
      expect(screen.getAllByText("Employee One (E01)").length).toBeGreaterThan(
        0,
      ),
    );
  });
});
