import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("../../services/api/announcementApi", () => ({
  getAnnouncements: vi.fn(),
  getAnnouncement: vi.fn(),
  getAnnouncementAttachment: vi.fn(),
}));

import AnnouncementWidget from "./AnnouncementWidget";
import * as announcementApi from "../../services/api/announcementApi";
import { useI18nStore } from "../../i18n/i18nStore";

const api = announcementApi as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

const item = {
  id: 9,
  title: "Office move",
  content_preview: "We move next week",
  announcement_type: "GENERAL",
  created_at: "2026-09-20T09:00:00Z",
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  useI18nStore.getState().setLanguage("en");
  api.getAnnouncements.mockResolvedValue({
    status: "success",
    data: { items: [item], count: 1 },
  });
  api.getAnnouncement.mockResolvedValue({
    status: "success",
    data: {
      announcement: {
        ...item,
        content: "We move next week",
        has_attachment: true,
        attachment_name: "plan.pdf",
      },
    },
  });
});

describe("AnnouncementWidget attachment", () => {
  it("previews the attachment inside the app, not in a new tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    // Not a PDF or image, so the viewer falls back to its download notice.
    api.getAnnouncementAttachment.mockResolvedValue(
      new Blob(["plain"], { type: "text/plain" }),
    );

    render(<AnnouncementWidget role="Employee" />);
    fireEvent.click(await screen.findByText("Office move"));
    fireEvent.click(await screen.findByRole("button", { name: /Preview/ }));

    await waitFor(() =>
      expect(api.getAnnouncementAttachment).toHaveBeenCalledWith(9, false),
    );
    const dialogs = await screen.findAllByRole("dialog");
    expect(
      await within(dialogs[dialogs.length - 1]).findByText(
        "This file cannot be previewed here. Download it to view.",
      ),
    ).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
