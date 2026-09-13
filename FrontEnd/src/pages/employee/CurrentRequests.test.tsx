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
it("does not show an empty inbox when loading fails, and retries", async () => {
  vi.mocked(getEmployeeCurrentRequests)
    .mockResolvedValueOnce({ requests: [], failed: ["loan"] })
    .mockResolvedValueOnce({ requests: [], failed: [] });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Loan requests");
  expect(
    screen.queryByText(
      "You have no ongoing leave, exit permission, or loan requests.",
    ),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(
    await screen.findByText(
      "You have no ongoing leave, exit permission, or loan requests.",
    ),
  ).toBeInTheDocument();
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
      "ليس لديك طلبات إجازة أو إذن خروج أو سلف قيد الإجراء.",
    ),
  ).toBeInTheDocument();
});
