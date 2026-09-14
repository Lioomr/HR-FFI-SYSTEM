import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

import { api } from "./apiClient";
import { updateAttendancePolicy, withoutLegacyGraceAlias } from "./settingsApi";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.put).mockResolvedValue({
    data: { status: "success", data: {} },
  });
});

describe("attendance policy settings", () => {
  it("sends an attendance-only body with the canonical grace field", async () => {
    await updateAttendancePolicy({
      grace_window_minutes: 20,
      late_grace_minutes: 15,
      grace_use_limit_per_month: 3,
    });

    expect(api.put).toHaveBeenCalledWith("/settings/", {
      attendance: { grace_window_minutes: 20, grace_use_limit_per_month: 3 },
    });
  });

  it("promotes a legacy-only grace value to the canonical field", () => {
    expect(withoutLegacyGraceAlias({ late_grace_minutes: 10 })).toEqual({
      grace_window_minutes: 10,
    });
  });
});
