import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getEmployeeCurrentRequests } from "../../services/api/employeeCurrentRequestsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import CurrentRequests from "./CurrentRequests";
vi.mock("../../services/api/employeeCurrentRequestsApi", () => ({
  getEmployeeCurrentRequests: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  useI18nStore.getState().setLanguage("en");
});
const mount = () =>
  render(
    <MemoryRouter>
      <CurrentRequests />
    </MemoryRouter>,
  );
it("shows ongoing status and a direct details link", async () => {
  vi.mocked(getEmployeeCurrentRequests).mockResolvedValue({
    failed: [],
    requests: [
      {
        id: 3,
        kind: "leave",
        reference: "#3",
        path: "/employee/leave/requests/3",
        status: "pending_hr_completion",
        createdAt: "2026-09-13",
      },
    ],
  });
  mount();
  expect(
    await screen.findByRole("link", { name: /My Leaves #3/ }),
  ).toHaveAttribute("href", "/employee/leave/requests/3");
  expect(screen.getByText("Pending HR completion")).toBeInTheDocument();
});
it("shows an in-flight Annual Leave settlement with its cycle and preference", async () => {
  vi.mocked(getEmployeeCurrentRequests).mockResolvedValue({
    failed: [],
    requests: [
      {
        id: 11,
        kind: "settlement",
        reference: "#11",
        path: "/employee/leave/balance",
        status: "pending_ceo",
        createdAt: "2026-09-05T08:00:00Z",
        cycle: { start: "2025-09-10", end: "2026-09-09" },
        preference: "take_as_leave",
      },
    ],
  });
  mount();
  expect(
    await screen.findByRole("link", { name: /Annual Leave settlement #11/ }),
  ).toHaveAttribute("href", "/employee/leave/balance");
  expect(screen.getByText("Pending CEO")).toBeInTheDocument();
  expect(screen.getByText(/Your preference: Take as leave/)).toHaveTextContent(
    "Contract year 2025-09-10 → 2026-09-09",
  );
});
it("links a pending profile change to the profile page", async () => {
  vi.mocked(getEmployeeCurrentRequests).mockResolvedValue({
    failed: [],
    requests: [
      {
        id: 8,
        kind: "profile",
        reference: "#8",
        path: "/employee/profile#profile-change",
        status: "pending_hr",
        createdAt: "2026-09-04",
      },
    ],
  });
  mount();
  expect(
    await screen.findByRole("link", { name: /Profile change #8/ }),
  ).toHaveAttribute("href", "/employee/profile#profile-change");
  expect(screen.getByText("Pending HR")).toBeInTheDocument();
});
it("does not show an empty inbox when loading fails, and retries", async () => {
  vi.mocked(getEmployeeCurrentRequests)
    .mockResolvedValueOnce({ requests: [], failed: ["loan"] })
    .mockResolvedValueOnce({ requests: [], failed: [] });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Loan requests");
  const emptyText =
    "You have no ongoing leave, exit permission, loan, Annual Leave settlement, or profile change requests.";
  expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText(emptyText)).toBeInTheDocument();
});
it("translates the current request section into Arabic", async () => {
  useI18nStore.getState().setLanguage("ar");
  vi.mocked(getEmployeeCurrentRequests).mockResolvedValue({
    requests: [],
    failed: [],
  });
  mount();
  expect(
    screen.getByRole("heading", { name: "الطلبات الجارية" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(
      "ليس لديك طلبات إجازة أو إذن خروج أو سلف أو تسوية إجازة سنوية أو تعديل بيانات قيد الإجراء.",
    ),
  ).toBeInTheDocument();
});
