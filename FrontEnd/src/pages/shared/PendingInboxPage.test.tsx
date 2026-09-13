import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../../services/api/pendingRequestsApi", () => ({
  getPendingRequests: vi.fn(),
}));
vi.mock("../../services/api/notificationsApi", () => ({
  listNotifications: vi
    .fn()
    .mockResolvedValue({ status: "success", data: { items: [] } }),
}));
import PendingInboxPage from "./PendingInboxPage";
import { getPendingRequests } from "../../services/api/pendingRequestsApi";
import { useI18nStore } from "../../i18n/i18nStore";
beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
});
it("opens an absolute review URL as an application path", async () => {
  vi.mocked(getPendingRequests).mockResolvedValue({
    status: "success",
    data: {
      items: [
        {
          id: 1,
          workflow_id: 1,
          request_type: "LEAVE",
          request_type_label: "Leave",
          name: "Review employee",
          action: "Review",
          time: new Date().toISOString(),
          avatar: "",
          review_path: `${window.location.origin}/ceo/job-offers/123?review=1`,
          current_approver_role: "ceo",
        },
      ],
      count: 1,
      page: 1,
      page_size: 20,
    },
  });
  render(<PendingInboxPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Review/i }));
  expect(navigate).toHaveBeenCalledWith("/ceo/job-offers/123?review=1");
});
