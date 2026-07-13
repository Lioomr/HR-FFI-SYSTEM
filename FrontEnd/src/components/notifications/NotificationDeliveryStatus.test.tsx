import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import NotificationDeliveryStatus from "./NotificationDeliveryStatus";
import {
  summarizeDeliveries,
  deliveryLabel,
} from "./notificationDeliveryUtils";
import NotificationItem from "./NotificationItem";
import type {
  NotificationDelivery,
  NotificationDto,
} from "../../services/api/notificationsApi";
import { useI18n } from "../../i18n/useI18n";
import { useI18nStore } from "../../i18n/i18nStore";

function d(overrides: Partial<NotificationDelivery>): NotificationDelivery {
  return { channel: "whatsapp", status: "sent", ...overrides };
}

function makeNotification(
  deliveries?: NotificationDelivery[]
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
    deliveries,
  };
}

// Small harness to exercise the pure helpers with the real translator.
function Harness({ deliveries }: { deliveries?: NotificationDelivery[] }) {
  const { t } = useI18n();
  return <div data-testid="summary">{summarizeDeliveries(t, deliveries)}</div>;
}

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
});

describe("NotificationDeliveryStatus", () => {
  it("renders WhatsApp sent", () => {
    render(<NotificationDeliveryStatus deliveries={[d({ status: "sent" })]} />);
    expect(screen.getByText("WhatsApp sent")).toBeInTheDocument();
  });

  it("renders WhatsApp failed with email fallback sent", () => {
    render(
      <NotificationDeliveryStatus
        deliveries={[
          d({ channel: "whatsapp", status: "failed" }),
          d({ channel: "email", status: "sent" }),
        ]}
      />
    );
    expect(screen.getByText("WhatsApp failed")).toBeInTheDocument();
    expect(screen.getByText("Email fallback sent")).toBeInTheDocument();
  });

  it("renders pending WhatsApp", () => {
    render(<NotificationDeliveryStatus deliveries={[d({ status: "pending" })]} />);
    expect(screen.getByText("WhatsApp pending")).toBeInTheDocument();
  });

  it("renders skipped WhatsApp", () => {
    render(<NotificationDeliveryStatus deliveries={[d({ status: "skipped" })]} />);
    expect(screen.getByText("WhatsApp skipped")).toBeInTheDocument();
  });

  it("renders both channels failed", () => {
    render(
      <NotificationDeliveryStatus
        deliveries={[
          d({ channel: "whatsapp", status: "failed" }),
          d({ channel: "email", status: "failed" }),
        ]}
      />
    );
    expect(screen.getByText("WhatsApp failed")).toBeInTheDocument();
    expect(screen.getByText("Email fallback failed")).toBeInTheDocument();
  });

  it("renders nothing for empty deliveries", () => {
    const { container } = render(<NotificationDeliveryStatus deliveries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when deliveries is undefined", () => {
    const { container } = render(<NotificationDeliveryStatus />);
    expect(container).toBeEmptyDOMElement();
  });

  it("orders WhatsApp before email regardless of input order", () => {
    render(
      <NotificationDeliveryStatus
        deliveries={[
          d({ channel: "email", status: "sent" }),
          d({ channel: "whatsapp", status: "failed" }),
        ]}
      />
    );
    const chips = screen.getAllByText(/WhatsApp failed|Email fallback sent/);
    expect(chips[0]).toHaveTextContent("WhatsApp failed");
    expect(chips[1]).toHaveTextContent("Email fallback sent");
  });

  it("never renders the raw provider error in the chips", () => {
    render(
      <NotificationDeliveryStatus
        deliveries={[
          d({ channel: "whatsapp", status: "failed", error: "TOP SECRET raw provider trace" }),
        ]}
      />
    );
    expect(screen.getByText("WhatsApp failed")).toBeInTheDocument();
    expect(screen.queryByText(/TOP SECRET/)).not.toBeInTheDocument();
  });

  it("renders delivery labels in Arabic", () => {
    useI18nStore.getState().setLanguage("ar");
    render(
      <NotificationDeliveryStatus
        deliveries={[
          d({ channel: "whatsapp", status: "failed" }),
          d({ channel: "email", status: "sent" }),
        ]}
      />
    );
    expect(screen.getByText("فشل الإرسال عبر واتساب")).toBeInTheDocument();
    expect(screen.getByText("تم الإرسال عبر البريد كبديل")).toBeInTheDocument();
  });

  it("summarizes deliveries for the accessible name", () => {
    render(
      <Harness
        deliveries={[
          d({ channel: "whatsapp", status: "failed" }),
          d({ channel: "email", status: "sent" }),
        ]}
      />
    );
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "Delivery status: WhatsApp failed, Email fallback sent."
    );
  });

  it("summary is empty for historical notifications with no deliveries", () => {
    render(<Harness deliveries={[]} />);
    expect(screen.getByTestId("summary")).toBeEmptyDOMElement();
  });

  it("exposes deliveries through the notification row's accessible label", () => {
    render(
      <NotificationItem
        notification={makeNotification([
          d({ channel: "whatsapp", status: "failed" }),
          d({ channel: "email", status: "sent" }),
        ])}
        onSelect={() => {}}
      />
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toContain("WhatsApp failed");
    expect(button.getAttribute("aria-label")).toContain("Email fallback sent");
  });

  it("provides a stable label helper", () => {
    const t = (_k: string, fb?: string) => fb ?? _k;
    expect(deliveryLabel(t, "whatsapp", "sent")).toBe("WhatsApp sent");
    expect(deliveryLabel(t, "email", "failed")).toBe("Email fallback failed");
    // Unknown values fall back gracefully.
    expect(deliveryLabel(t, "sms", "weird")).toBe("WhatsApp pending");
  });
});
