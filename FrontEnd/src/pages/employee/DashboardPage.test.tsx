import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import { getEmployee } from "../../services/api/employeesApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { getEmployeeCurrentRequests } from "../../services/api/employeeCurrentRequestsApi";
import {
  getAnnualLeaveEligibility,
  type AnnualLeaveEligibility,
} from "../../services/api/annualLeavePaymentsApi";

vi.mock("../../services/api/annualLeavePaymentsApi", async () => ({
  ...(await vi.importActual<
    typeof import("../../services/api/annualLeavePaymentsApi")
  >("../../services/api/annualLeavePaymentsApi")),
  getAnnualLeaveEligibility: vi.fn(),
}));

vi.mock("../../services/api/employeeCurrentRequestsApi", () => ({
  getEmployeeCurrentRequests: vi.fn(),
}));

vi.mock("../../services/api/employeesApi", () => ({ getEmployee: vi.fn() }));
vi.mock("../../components/announcements/AnnouncementWidget", () => ({
  default: () => null,
}));
function eligibility(
  overrides: Partial<AnnualLeaveEligibility> = {},
): AnnualLeaveEligibility {
  return {
    can_request: true,
    window_open: true,
    cycle_start: "2026-02-24",
    cycle_end: "2027-02-23",
    eligible_unused_days: "10.00",
    locked_unused_days: "33.00",
    salary_at_year_end: "3000.00",
    estimated_payment_amount: "1000.00",
    has_pending_annual_leave: false,
    reason: "",
    ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getEmployeeCurrentRequests).mockResolvedValue({
    requests: [],
    failed: [],
  });
  useI18nStore.getState().setLanguage("en");
  vi.mocked(getAnnualLeaveEligibility).mockResolvedValue({
    status: "success",
    data: eligibility({ can_request: false }),
  });
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
function LocationProbe() {
  const location = useLocation();
  return (
    <p data-testid="location">{`${location.pathname}${location.search}`}</p>
  );
}
const mountWithRoutes = () =>
  render(
    <MemoryRouter initialEntries={["/employee/dashboard"]}>
      <Routes>
        <Route path="/employee/dashboard" element={<DashboardPage />} />
        <Route path="/employee/leave/balance" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
it("prompts the employee when the Annual Leave settlement can be requested", async () => {
  vi.mocked(getAnnualLeaveEligibility).mockResolvedValue({
    status: "success",
    data: eligibility(),
  });
  mountWithRoutes();
  const prompt = await screen.findByRole("region", {
    name: "Annual leave settlement is open",
  });
  expect(prompt).toHaveTextContent("Your contract year ends on 2027-02-23.");
  expect(prompt).toHaveTextContent("You have 10 cash-eligible days.");
  fireEvent.click(screen.getByRole("button", { name: "Open Leave Balance" }));
  expect(await screen.findByTestId("location")).toHaveTextContent(
    "/employee/leave/balance?focus=settlement",
  );
});
it("hides the settlement prompt when the backend says it cannot be requested", async () => {
  mount();
  await screen.findByRole("heading", { name: /Omar/ });
  await vi.waitFor(() =>
    expect(getAnnualLeaveEligibility).toHaveBeenCalledTimes(1),
  );
  expect(
    screen.queryByRole("region", { name: "Annual leave settlement is open" }),
  ).not.toBeInTheDocument();
});
it("hides the settlement prompt when eligibility cannot be read", async () => {
  vi.mocked(getAnnualLeaveEligibility).mockRejectedValue(new Error("403"));
  mount();
  await screen.findByRole("heading", { name: /Omar/ });
  expect(
    screen.queryByRole("region", { name: "Annual leave settlement is open" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("shows the settlement prompt in Arabic", async () => {
  useI18nStore.getState().setLanguage("ar");
  vi.mocked(getAnnualLeaveEligibility).mockResolvedValue({
    status: "success",
    data: eligibility(),
  });
  mount();
  const prompt = await screen.findByRole("region", {
    name: "تسوية الإجازة السنوية متاحة الآن",
  });
  expect(prompt).toHaveTextContent("تنتهي سنة عقدك في 2027-02-23.");
  expect(
    screen.getByRole("button", { name: "فتح رصيد الإجازات" }),
  ).toBeInTheDocument();
});
