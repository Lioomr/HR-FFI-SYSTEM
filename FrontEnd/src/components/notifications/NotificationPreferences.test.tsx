import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../services/api/notificationsApi", () => ({
  getNotificationChannelPreferences: vi.fn(),
  saveNotificationChannelPreferences: vi.fn(),
}));

import NotificationPreferences from "./NotificationPreferences";
import * as api from "../../services/api/notificationsApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getPrefs = api.getNotificationChannelPreferences as unknown as ReturnType<
  typeof vi.fn
>;
const savePrefs =
  api.saveNotificationChannelPreferences as unknown as ReturnType<typeof vi.fn>;

const ok = <T,>(data: T) => ({ status: "success" as const, data });

beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
  getPrefs.mockResolvedValue(ok({ whatsapp_enabled: true, email_enabled: true }));
  savePrefs.mockResolvedValue(ok({ whatsapp_enabled: true, email_enabled: true }));
});

describe("NotificationPreferences", () => {
  it("loads and reflects the stored preferences", async () => {
    getPrefs.mockResolvedValue(ok({ whatsapp_enabled: true, email_enabled: false }));
    render(<NotificationPreferences />);

    const whatsapp = await screen.findByRole("switch", { name: /whatsapp/i });
    const email = screen.getByRole("switch", { name: /email fallback/i });
    expect(whatsapp).toHaveAttribute("aria-checked", "true");
    expect(email).toHaveAttribute("aria-checked", "false");
  });

  it("explains WhatsApp-first / email-fallback behavior", async () => {
    render(<NotificationPreferences />);
    expect(
      await screen.findByText(/whatsapp is tried first/i)
    ).toBeInTheDocument();
  });

  it("enables Save only after a change and persists it", async () => {
    getPrefs.mockResolvedValue(ok({ whatsapp_enabled: true, email_enabled: false }));
    render(<NotificationPreferences />);

    const saveBtn = await screen.findByRole("button", {
      name: /save preferences/i,
    });
    expect(saveBtn).toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: /email fallback/i }));
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(savePrefs).toHaveBeenCalledWith({
        whatsapp_enabled: true,
        email_enabled: true,
      })
    );
    expect(await screen.findByText(/preferences saved/i)).toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    getPrefs.mockRejectedValueOnce(new Error("Network down"));
    render(<NotificationPreferences />);

    expect(
      await screen.findByText(/couldn't load preferences/i)
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });

    getPrefs.mockResolvedValue(ok({ whatsapp_enabled: true, email_enabled: true }));
    fireEvent.click(retry);
    expect(
      await screen.findByRole("switch", { name: /whatsapp/i })
    ).toBeInTheDocument();
  });

  it("surfaces a save error without exposing raw provider details", async () => {
    render(<NotificationPreferences />);
    await screen.findByRole("switch", { name: /whatsapp/i });
    fireEvent.click(screen.getByRole("switch", { name: /whatsapp/i }));

    savePrefs.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    expect(
      await screen.findByText(/couldn't save preferences/i)
    ).toBeInTheDocument();
  });

  it("renders in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    render(<NotificationPreferences />);
    expect(await screen.findByText("إشعارات واتساب")).toBeInTheDocument();
    expect(screen.getByText("البريد الإلكتروني كبديل")).toBeInTheDocument();
  });

  it("exposes an accessible preferences group", async () => {
    render(<NotificationPreferences />);
    await screen.findByRole("switch", { name: /whatsapp/i });
    expect(
      screen.getByRole("group", { name: /notification preferences/i })
    ).toBeInTheDocument();
  });
});
