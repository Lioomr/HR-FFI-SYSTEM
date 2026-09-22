import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../../services/api/pendingRequestsApi", () => ({
  getPendingRequests: vi.fn(),
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
  fireEvent.click(await screen.findByRole("button", { name: /Review$/ }));
  expect(navigate).toHaveBeenCalledWith("/ceo/job-offers/123?review=1");
});

it("opens a contract rating from the employee name, not only the Review button", async () => {
  vi.mocked(getPendingRequests).mockResolvedValue({
    status: "success",
    data: {
      items: [
        {
          id: 15,
          workflow_id: 9,
          request_type: "CONTRACT_RATING",
          request_type_label: "Employee Contract Rating",
          name: "ZEYAD ABDELHAMID",
          action: "Employee Contract Rating",
          time: new Date().toISOString(),
          review_path: `${window.location.origin}/ceo/contract-ratings/15`,
          avatar: "",
          current_approver_role: "ceo",
        },
      ],
      count: 1,
      page: 1,
      page_size: 20,
    },
  });
  render(<PendingInboxPage />);
  // The Review button sits behind a horizontal scroll on narrow screens.
  fireEvent.click(await screen.findByRole("button", { name: "ZEYAD ABDELHAMID" }));
  expect(navigate).toHaveBeenCalledWith("/ceo/contract-ratings/15");
  // The type is a known one, so it renders its translated label.
  expect(screen.getByText("Contract Rating")).toBeTruthy();
});

it("shows a chip only for request types with pending items and filters by it", async () => {
  vi.mocked(getPendingRequests).mockResolvedValue({
    status: "success",
    data: {
      items: [],
      count: 5,
      total_count: 5,
      counts_by_type: { CONTRACT_RATING: 4, LEAVE: 1, LOAN: 0 },
      page: 1,
      page_size: 20,
    },
  });
  render(<PendingInboxPage />);

  const ratingChip = await screen.findByRole("button", {
    name: /Contract Rating\s*4/,
  });
  expect(screen.getByRole("button", { name: /All\s*5/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Leave\s*1/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Loan/ })).toBeNull();

  fireEvent.click(ratingChip);
  await waitFor(() =>
    expect(getPendingRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_type: "CONTRACT_RATING", page: 1 }),
    ),
  );
  expect(ratingChip.getAttribute("aria-pressed")).toBe("true");

  // Clicking the active chip again returns to every type.
  fireEvent.click(ratingChip);
  await waitFor(() =>
    expect(getPendingRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_type: undefined }),
    ),
  );
});
