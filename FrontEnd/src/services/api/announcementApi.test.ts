import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnnouncement,
  updateAnnouncement,
  getAnnouncementWhatsAppGroups,
} from "./announcementApi";
import { api } from "./apiClient";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
beforeEach(() => {
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
});

describe("announcement audience API", () => {
  it("sends an explicit company flag independently from empty roles", async () => {
    await createAnnouncement({
      title: "Notice",
      content: "Policy",
      whole_company: true,
      publish_to_dashboard: true,
      publish_to_email: false,
    });
    const data = vi.mocked(api.post).mock.lastCall![1] as FormData;
    expect(data.get("whole_company")).toBe("true");
    expect(data.get("target_roles")).toBe("[]");
    expect(data.has("target_user_ids")).toBe(false);
  });
  it.each(["GENERAL", "MEETING"] as const)(
    "serializes selected %s employees on edit",
    async (announcement_type) => {
      await updateAnnouncement(7, {
        announcement_type,
        whole_company: false,
        target_roles: [],
        target_user_ids: [11, 12],
      });
      const data = vi.mocked(api.patch).mock.lastCall![1] as FormData;
      expect(data.get("whole_company")).toBe("false");
      expect(data.getAll("target_user_ids")).toEqual(["11", "12"]);
      expect(data.get("target_roles")).toBe("[]");
    },
  );
  it("serializes CEO targeting", async () => {
    await updateAnnouncement(7, {
      whole_company: false,
      target_roles: ["CEO"],
    });
    const data = vi.mocked(api.patch).mock.lastCall![1] as FormData;
    expect(data.get("target_roles")).toBe('["CEO"]');
    expect(data.has("target_user_ids")).toBe(false);
  });
});

describe("announcement group API", () => {
  it("loads approved groups from the announcement-specific endpoint", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          state: "connected",
          groups: [{ id: "opaque-id", name: "Team" }],
        },
      },
    });
    expect(await getAnnouncementWhatsAppGroups()).toEqual({
      state: "connected",
      groups: [{ id: "opaque-id", name: "Team" }],
    });
    expect(api.get).toHaveBeenCalledWith("/api/announcements/whatsapp-groups");
  });
  it("sends and explicitly clears the opaque group selection", async () => {
    await updateAnnouncement(7, {
      publish_to_whatsapp: true,
      whatsapp_group_id: "opaque-id",
    });
    expect(
      (vi.mocked(api.patch).mock.lastCall![1] as FormData).get(
        "whatsapp_group_id",
      ),
    ).toBe("opaque-id");
    await updateAnnouncement(7, {
      publish_to_whatsapp: false,
      whatsapp_group_id: "",
    });
    expect(
      (vi.mocked(api.patch).mock.lastCall![1] as FormData).get(
        "whatsapp_group_id",
      ),
    ).toBe("");
  });
});
