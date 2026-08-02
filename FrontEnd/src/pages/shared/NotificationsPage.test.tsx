import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../services/api/notificationsApi", () => ({
  listNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn().mockResolvedValue({
    status: "success",
    data: { unread_count: 0 },
  }),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

import NotificationsPage from "./NotificationsPage";
import * as api from "../../services/api/notificationsApi";
import type { NotificationDto } from "../../services/api/notificationsApi";
import { useNotificationStore } from "../../stores/notificationStore";
import { useI18nStore } from "../../i18n/i18nStore";

const listNotifications = api.listNotifications as unknown as ReturnType<
  typeof vi.fn
>;

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 1,
    title: "Leave approved",
    message: "Your leave was approved.",
    event_key: "leave.approved",
    category: "leave",
    action_url: "/employee/leave/requests",
    related_object_type: null,
    related_object_id: null,
    metadata: {},
    deduplication_key: "",
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const page = <T,>(items: T[], extra: Record<string, unknown> = {}) => ({
  status: "success" as const,
  data: { items, page: 1, page_size: 20, count: items.length, total_pages: 1, ...extra },
});

beforeEach(() => {
  navigateMock.mockClear();
  useI18nStore.getState().setLanguage("en");
  useNotificationStore.getState().reset();
  listNotifications.mockReset();
});

describe("NotificationsPage", () => {
  it("loads and renders notifications on mount", async () => {
    listNotifications.mockResolvedValue(
      page([makeNotification({ id: 1, title: "Inbox item" })])
    );
    render(<NotificationsPage />);
    expect(await screen.findByText("Inbox item")).toBeInTheDocument();
  });

  it("requests unread-only when the Unread filter is chosen", async () => {
    listNotifications.mockResolvedValue(page([makeNotification()]));
    render(<NotificationsPage />);
    await screen.findByText("Leave approved");

    fireEvent.click(screen.getByText("Unread"));

    await waitFor(() =>
      expect(listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ unread: true })
      )
    );
  });

  it("paginates through pages", async () => {
    listNotifications.mockResolvedValue(
      page([makeNotification({ id: 1, title: "Page one" })], { count: 40, total_pages: 2 })
    );
    render(<NotificationsPage />);
    await screen.findByText("Page one");

    fireEvent.click(screen.getByText("2"));

    await waitFor(() =>
      expect(listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      )
    );
  });

  it("shows an empty state for the unread filter", async () => {
    listNotifications.mockResolvedValue(page([]));
    useNotificationStore.setState({ filter: "unread" });
    render(<NotificationsPage />);
    expect(
      await screen.findByText(/no unread notifications/i)
    ).toBeInTheDocument();
  });

  it("shows an error state with a retry action", async () => {
    listNotifications.mockRejectedValue(new Error("Network down"));
    render(<NotificationsPage />);
    expect(
      await screen.findByText(/couldn't load notifications/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
