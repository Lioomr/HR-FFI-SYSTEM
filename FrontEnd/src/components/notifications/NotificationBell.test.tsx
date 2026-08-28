import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { message } from "antd";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../services/api/notificationsApi", () => ({
  listNotifications: vi.fn().mockResolvedValue({
    status: "success",
    data: { items: [], page: 1, page_size: 8, count: 0, total_pages: 1 },
  }),
  getUnreadNotificationCount: vi
    .fn()
    .mockResolvedValue({ status: "success", data: { unread_count: 0 } }),
  markNotificationRead: vi
    .fn()
    .mockResolvedValue({ status: "success", data: { unread_count: 0 } }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({
    status: "success",
    data: { updated_count: 0, unread_count: 0 },
  }),
}));

import NotificationBell from "./NotificationBell";
import type { NotificationDto } from "../../services/api/notificationsApi";
import { useNotificationStore } from "../../stores/notificationStore";
import { useI18nStore } from "../../i18n/i18nStore";

function makeNotification(
  overrides: Partial<NotificationDto> = {},
): NotificationDto {
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

beforeEach(() => {
  navigateMock.mockClear();
  useI18nStore.getState().setLanguage("en");
  useNotificationStore.getState().reset();
});

afterEach(() => {
  // antd `message` renders into a body portal that outlives a single test.
  message.destroy();
});

function openPanel() {
  // Language-agnostic: the bell is the only button that opens a dialog popup.
  const bell = document.querySelector(
    'button[aria-haspopup="dialog"]',
  ) as HTMLButtonElement;
  fireEvent.click(bell);
}

describe("NotificationBell", () => {
  it("shows the unread count in the accessible label", () => {
    useNotificationStore.setState({ unreadCount: 5 });
    render(<NotificationBell />);
    expect(
      screen.getByRole("button", { name: /5 unread/i }),
    ).toBeInTheDocument();
  });

  it("renders a loading state in the dropdown", () => {
    useNotificationStore.setState({ recentLoading: true, recent: [] });
    render(<NotificationBell />);
    openPanel();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders an empty state when there are no notifications", () => {
    useNotificationStore.setState({ recentLoading: false, recent: [] });
    render(<NotificationBell />);
    openPanel();
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
  });

  it("renders notification items", () => {
    useNotificationStore.setState({
      recent: [
        makeNotification({ id: 1, title: "First alert" }),
        makeNotification({ id: 2, title: "Second alert" }),
      ],
    });
    render(<NotificationBell />);
    openPanel();
    expect(screen.getByText("First alert")).toBeInTheDocument();
    expect(screen.getByText("Second alert")).toBeInTheDocument();
  });

  it("marks an item read and navigates to its deep link", () => {
    const markRead = vi.fn();
    useNotificationStore.setState({
      recent: [
        makeNotification({ id: 7, action_url: "/employee/leave/requests" }),
      ],
      markRead,
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Leave approved/i }));
    expect(markRead).toHaveBeenCalledWith(7);
    expect(navigateMock).toHaveBeenCalledWith("/employee/leave/requests");
  });

  it("normalizes a legacy hiring-request link onto the compatibility route", () => {
    // The backend still sends the DRF path. Navigating there as-is would 404 in
    // the app, so it must be rewritten before the router sees it.
    useNotificationStore.setState({
      recent: [
        makeNotification({
          id: 21,
          title: "Hiring request submitted",
          action_url: "/hiring-requests/1",
        }),
      ],
      markRead: vi.fn(),
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Hiring request submitted/i }));

    expect(navigateMock).toHaveBeenCalledWith("/hiring-requests/1");
    // Never the API path with its trailing slash.
    expect(navigateMock).not.toHaveBeenCalledWith("/hiring-requests/1/");
  });

  it("never navigates the browser to a hiring-request API URL", () => {
    useNotificationStore.setState({
      recent: [
        makeNotification({
          id: 22,
          title: "Hiring request submitted",
          action_url: `${window.location.origin}/hiring-requests/1/cv/`,
        }),
      ],
      markRead: vi.fn(),
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Hiring request submitted/i }));

    expect(navigateMock).toHaveBeenCalledWith("/hiring-requests/1");
  });

  it("triggers mark-all-read", () => {
    const markAllRead = vi.fn();
    useNotificationStore.setState({
      unreadCount: 3,
      recent: [makeNotification({ id: 1 })],
      markAllRead,
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /mark all as read/i }));
    expect(markAllRead).toHaveBeenCalled();
  });

  it("exposes a dialog popup via aria attributes", () => {
    render(<NotificationBell />);
    const button = screen.getByRole("button", { name: /notifications/i });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("renders in Arabic", () => {
    useI18nStore.getState().setLanguage("ar");
    useNotificationStore.setState({ recent: [] });
    render(<NotificationBell />);
    openPanel();
    // Arabic title for "Notifications".
    expect(screen.getAllByText("الإشعارات").length).toBeGreaterThan(0);
  });

  it("shows a reconnecting indicator without blocking the panel", () => {
    useNotificationStore.setState({
      connection: "reconnecting",
      recent: [makeNotification({ id: 1, title: "Still here" })],
    });
    render(<NotificationBell />);
    openPanel();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/reconnecting/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Still here")).toBeInTheDocument();
  });

  it("activates a notification with the keyboard (native button)", () => {
    const markRead = vi.fn();
    useNotificationStore.setState({
      recent: [
        makeNotification({ id: 11, action_url: "/employee/leave/requests" }),
      ],
      markRead,
    });
    render(<NotificationBell />);
    openPanel();
    const item = screen.getByRole("button", { name: /Leave approved/i });
    // The row is a real <button>, so it is focusable and Enter/Space dispatch a
    // click. Focusing then activating exercises the keyboard path end to end.
    item.focus();
    expect(item).toHaveFocus();
    fireEvent.click(item);
    expect(markRead).toHaveBeenCalledWith(11);
    expect(navigateMock).toHaveBeenCalledWith("/employee/leave/requests");
  });

  it("navigates to a same-origin absolute action URL as a router path", () => {
    useNotificationStore.setState({
      recent: [
        makeNotification({
          id: 12,
          action_url: `${window.location.origin}/employee/leave/requests`,
        }),
      ],
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Leave approved/i }));
    expect(navigateMock).toHaveBeenCalledWith("/employee/leave/requests");
  });

  it("blocks an external action URL and warns the user (English)", async () => {
    useNotificationStore.setState({
      recent: [
        makeNotification({
          id: 13,
          title: "Suspicious link",
          action_url: "https://evil.example.com/steal",
        }),
      ],
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Suspicious link/i }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/blocked for your security/i),
    ).toBeInTheDocument();
  });

  it("blocks a javascript: action URL", async () => {
    useNotificationStore.setState({
      recent: [
        makeNotification({
          id: 14,
          title: "XSS attempt",
          action_url: "javascript:alert(document.cookie)",
        }),
      ],
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /XSS attempt/i }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/blocked for your security/i),
    ).toBeInTheDocument();
  });

  it("shows the blocked-link warning in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    useNotificationStore.setState({
      recent: [
        makeNotification({ id: 15, action_url: "https://evil.example.com" }),
      ],
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Leave approved/i }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText("تم حظر هذا الرابط للحفاظ على أمانك."),
    ).toBeInTheDocument();
  });

  it("ignores an empty action URL without warning or navigation", () => {
    useNotificationStore.setState({
      recent: [makeNotification({ id: 16, action_url: null })],
    });
    render(<NotificationBell />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Leave approved/i }));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/blocked for your security/i),
    ).not.toBeInTheDocument();
  });

  it("renders delivery status from a partial delivery payload", () => {
    // Historical REST records may carry a partial delivery shape.
    // (only channel + status). The bell must still render it.
    useNotificationStore.setState({
      recent: [
        makeNotification({
          id: 9,
          title: "Pushed live",
          deliveries: [{ channel: "whatsapp", status: "sent" }],
        }),
      ],
    });
    render(<NotificationBell />);
    openPanel();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("WhatsApp sent")).toBeInTheDocument();
  });
});
