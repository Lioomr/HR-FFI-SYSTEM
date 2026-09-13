import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import { getEmployee } from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { getEmployeeCurrentRequests } from "../../services/api/employeeCurrentRequestsApi";

vi.mock("../../services/api/employeeCurrentRequestsApi", () => ({
  getEmployeeCurrentRequests: vi.fn(),
}));

vi.mock("../../services/api/employeesApi", () => ({ getEmployee: vi.fn() }));
vi.mock("../../components/announcements/AnnouncementWidget", () => ({
  default: () => null,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getEmployeeCurrentRequests).mockResolvedValue({
    requests: [],
    failed: [],
  });
  useI18nStore.getState().setLanguage("en");
  vi.mocked(getEmployee).mockResolvedValue({
    status: "success",
    data: {
      id: 1,
      employee_id: "1",
      user_id: 1,
      full_name: "Omar",
      full_name_ar: "عمر",
      email: "test@example.test",
      is_archived: false,
    },
  });
});
const mount = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
it("separates request creation from tracking", async () => {
  mount();
  await screen.findByRole("heading", { name: /Omar/ });
  for (const [name, create, track] of [
    ["My Leaves", "/employee/leave/request", "/employee/leave/requests"],
    [
      "Exit Permission",
      "/employee/permission-requests/new",
      "/employee/permission-requests",
    ],
    ["Loan requests", "/employee/loans/request", "/employee/loans"],
  ]) {
    expect(
      screen.getByRole("link", { name: `New request: ${name}` }),
    ).toHaveAttribute("href", create);
    expect(
      screen.getByRole("link", { name: `Track my requests: ${name}` }),
    ).toHaveAttribute("href", track);
  }
});
it("filters services and lets employees recover from an empty search", async () => {
  mount();
  await screen.findByRole("heading", { name: /Omar/ });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "payslips" },
  });
  expect(screen.getByRole("link", { name: /My Payslips/ })).toHaveAttribute(
    "href",
    "/employee/payslips",
  );
  expect(
    screen.queryByRole("link", { name: /My attendance/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzz" } });
  expect(
    screen.getByText("No services match your search."),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /^New request:/ })).toHaveLength(
    3,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show all services" }));
  expect(
    screen.getByRole("link", { name: /My attendance/ }),
  ).toBeInTheDocument();
});
it("keeps services available when profile loading fails and supports retry", async () => {
  vi.mocked(getEmployee).mockRejectedValueOnce(new Error("offline"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t load your profile",
  );
  expect(screen.getAllByRole("link", { name: /^New request:/ })).toHaveLength(
    3,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: /Omar/ });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("renders Arabic navigation and employee name with RTL layout", async () => {
  useI18nStore.getState().setLanguage("ar");
  const { container } = mount();
  await screen.findByRole("heading", { name: /عمر/ });
  expect(container.querySelector(".employee-dashboard")).toHaveAttribute(
    "dir",
    "rtl",
  );
  expect(
    screen.getByRole("link", { name: "متابعة طلباتي: إجازاتي" }),
  ).toHaveAttribute("href", "/employee/leave/requests");
});
