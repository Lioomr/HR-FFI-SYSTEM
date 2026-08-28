import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import NotificationDeliveryAdminDetails from "./NotificationDeliveryAdminDetails";
import { canViewDeliveryTechnicalDetails } from "./notificationDeliveryUtils";
import type { NotificationDelivery } from "../../services/api/notificationsApi";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";
import type { AuthUser, Role } from "../../auth/authStore";

function setRole(role: Role | undefined) {
  useAuthStore.setState({
    isAuthenticated: !!role,
    user: role ? ({ id: "1", email: "u@ffi.test", role } as AuthUser) : null,
  });
}

const failedWhatsapp: NotificationDelivery = {
  channel: "whatsapp",
  status: "failed",
  provider: "evolution_whatsapp",
  provider_message_id: "",
  error: "Evolution WhatsApp provider is unavailable.",
  attempt_count: 2,
};

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  setRole(undefined);
});

describe("canViewDeliveryTechnicalDetails", () => {
  it("allows admins and HR, denies others", () => {
    expect(canViewDeliveryTechnicalDetails("SystemAdmin")).toBe(true);
    expect(canViewDeliveryTechnicalDetails("HRManager")).toBe(true);
    expect(canViewDeliveryTechnicalDetails("Employee")).toBe(false);
    expect(canViewDeliveryTechnicalDetails(undefined)).toBe(false);
  });
});

describe("NotificationDeliveryAdminDetails", () => {
  it("renders nothing for non-admin users", () => {
    setRole("Employee");
    const { container } = render(
      <NotificationDeliveryAdminDetails deliveries={[failedWhatsapp]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no deliveries", () => {
    setRole("SystemAdmin");
    const { container } = render(
      <NotificationDeliveryAdminDetails deliveries={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows provider, attempts and the redacted detail for admins", () => {
    setRole("SystemAdmin");
    render(<NotificationDeliveryAdminDetails deliveries={[failedWhatsapp]} />);

    expect(screen.getByText(/delivery details \(admin\)/i)).toBeInTheDocument();
    expect(screen.getByText("evolution_whatsapp")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // The backend already redacts this to a single safe line.
    expect(
      screen.getByText("Evolution WhatsApp provider is unavailable."),
    ).toBeInTheDocument();
  });

  it("uses a keyboard-accessible native disclosure", () => {
    setRole("HRManager");
    const { container } = render(
      <NotificationDeliveryAdminDetails deliveries={[failedWhatsapp]} />,
    );
    const details = container.querySelector("details");
    const summary = container.querySelector("summary");
    expect(details).not.toBeNull();
    expect(summary).not.toBeNull();
  });

  it("renders in Arabic for admins", () => {
    setRole("SystemAdmin");
    useI18nStore.getState().setLanguage("ar");
    render(<NotificationDeliveryAdminDetails deliveries={[failedWhatsapp]} />);
    expect(screen.getByText(/تفاصيل التسليم/)).toBeInTheDocument();
  });
});
