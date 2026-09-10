import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Form } from "antd";
import AnnouncementWhatsAppGroupField from "./AnnouncementWhatsAppGroupField";
import { getAnnouncementWhatsAppGroups } from "../../../services/api/announcementApi";

vi.mock("../../../services/api/announcementApi", () => ({
  getAnnouncementWhatsAppGroups: vi.fn(),
}));
vi.mock("../../../auth/authStore", () => ({ useAuthStore: () => 1 }));
const t = (key: string) => key;
vi.mock("../../../i18n/useI18n", () => ({ useI18n: () => ({ t }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("announcement group picker", () => {
  it("does not fetch or offer groups when WhatsApp is disabled", () => {
    render(
      <Form initialValues={{ publish_to_whatsapp: false }}>
        <AnnouncementWhatsAppGroupField />
      </Form>,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(getAnnouncementWhatsAppGroups).not.toHaveBeenCalled();
  });
  it("offers connected approved groups with explicit additional-recipient semantics", async () => {
    vi.mocked(getAnnouncementWhatsAppGroups).mockResolvedValue({
      state: "connected",
      groups: [{ id: "opaque", name: "Company group" }],
    });
    render(
      <Form initialValues={{ publish_to_whatsapp: true }}>
        <AnnouncementWhatsAppGroupField />
      </Form>,
    );
    expect(screen.getByText("hr.announcements.groupSemantics")).toBeTruthy();
    await waitFor(() =>
      expect(getAnnouncementWhatsAppGroups).toHaveBeenCalledOnce(),
    );
    fireEvent.mouseDown(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getAllByText("Company group").length).toBeGreaterThan(0),
    );
    expect(screen.getByRole("option", { name: "Company group" })).toBeTruthy();
  });
  it("handles disconnected groups and preserves an unavailable edit selection without displaying its ID", async () => {
    vi.mocked(getAnnouncementWhatsAppGroups).mockResolvedValue({
      state: "disconnected",
      groups: [],
    });
    render(
      <Form
        initialValues={{
          publish_to_whatsapp: true,
          whatsapp_group_id: "old-opaque",
        }}
      >
        <AnnouncementWhatsAppGroupField editing />
      </Form>,
    );
    await waitFor(() =>
      expect(
        screen.getByText("hr.announcements.groupUnavailable"),
      ).toBeTruthy(),
    );
    expect(screen.getByText("hr.announcements.groupEditHelp")).toBeTruthy();
    expect(screen.queryByText("old-opaque")).toBeNull();
    expect(
      screen.getAllByText("hr.announcements.groupUnavailableSelection").length,
    ).toBeGreaterThan(0);
  });
  it("keeps provider failures non-blocking and supports refresh", async () => {
    vi.mocked(getAnnouncementWhatsAppGroups).mockRejectedValue(
      new Error("unavailable"),
    );
    render(
      <Form initialValues={{ publish_to_whatsapp: true }}>
        <AnnouncementWhatsAppGroupField />
      </Form>,
    );
    await waitFor(() =>
      expect(
        screen.getByText("hr.announcements.groupUnavailable"),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("hr.announcements.groupRefresh"));
    await waitFor(() =>
      expect(getAnnouncementWhatsAppGroups).toHaveBeenCalledTimes(2),
    );
  });
});
