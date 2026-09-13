import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ExecutiveNotifications from "./ExecutiveNotifications";
import { listNotifications } from "../../services/api/notificationsApi";
import { useI18nStore } from "../../i18n/i18nStore";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../../services/api/notificationsApi", () => ({
  listNotifications: vi.fn(),
}));
vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: () => null,
}));
vi.mock("../notifications/NotificationItem", () => ({
  default: ({
    notification,
    onSelect,
  }: {
    notification: { title: string };
    onSelect: (item: unknown) => void;
  }) => (
    <button onClick={() => onSelect(notification)}>{notification.title}</button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
});

describe("ExecutiveNotifications", () => {
  it("shows unread work and opens its actual review destination", async () => {
    vi.mocked(listNotifications).mockResolvedValue({
      status: "success",
      data: {
        count: 7,
        page: 1,
        page_size: 3,
        total_pages: 3,
        items: [
          {
            id: 1,
            title: "Loan requires review",
            action_url: "/cfo/loan-requests/42",
          },
        ],
      },
    } as never);
    render(<ExecutiveNotifications />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Loan requires review" }),
    );
    expect(navigate).toHaveBeenCalledWith("/cfo/loan-requests/42");
    expect(screen.getByText("Notifications · 7 Unread")).toBeInTheDocument();
    expect(listNotifications).toHaveBeenCalledWith({
      unread: true,
      page: 1,
      page_size: 3,
    });
  });

  it("offers retry instead of claiming an empty inbox on failure", async () => {
    vi.mocked(listNotifications)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        status: "success",
        data: { count: 0, page: 1, page_size: 3, total_pages: 0, items: [] },
      });
    render(<ExecutiveNotifications />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("No unread notifications"),
    ).toBeInTheDocument();
  });
});
