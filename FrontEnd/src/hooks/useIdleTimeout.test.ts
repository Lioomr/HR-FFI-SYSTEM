import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "../services/api/settingsApi";
import { useAuthStore } from "../auth/authStore";
import { useIdleTimeout } from "./useIdleTimeout";

vi.mock("../services/api/settingsApi", () => ({
  getSettings: vi.fn(),
}));

const get = getSettings as unknown as ReturnType<typeof vi.fn>;

describe("useIdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockResolvedValue({
      status: "success",
      data: {
        session: { timeout_minutes: 120 },
      },
    });
    vi.spyOn(useAuthStore.getState(), "logout").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses the session timeout returned by system settings", async () => {
    renderHook(() => useIdleTimeout());

    await act(async () => {
      await Promise.resolve();
    });

    vi.advanceTimersByTime(119 * 60 * 1000);
    expect(useAuthStore.getState().logout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60 * 1000);
    expect(useAuthStore.getState().logout).toHaveBeenCalledTimes(1);
  });
});
