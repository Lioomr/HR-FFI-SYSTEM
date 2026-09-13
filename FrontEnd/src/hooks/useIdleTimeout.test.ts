import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "../services/api/settingsApi";
import { useAuthStore } from "../auth/authStore";
import { useIdleTimeout } from "./useIdleTimeout";

vi.mock("../services/api/settingsApi", () => ({
  getSettings: vi.fn(),
}));

const originalLogout = useAuthStore.getState().logout;

const get = getSettings as unknown as ReturnType<typeof vi.fn>;

describe("useIdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ isAuthenticated: true });
    get.mockResolvedValue({
      status: "success",
      data: {
        session: { timeout_minutes: 120 },
      },
    });
    vi.spyOn(useAuthStore.getState(), "logout").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ isAuthenticated: false, logout: originalLogout });
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

it("starts idle monitoring only after sign-in", async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: false, logout: originalLogout });
  const getMock = vi.mocked(getSettings);
  getMock.mockClear();
  getMock.mockResolvedValue({
    status: "success",
    data: { session: { timeout_minutes: 1 } },
  } as Awaited<ReturnType<typeof getSettings>>);
  const logout = vi.spyOn(useAuthStore.getState(), "logout");
  const { unmount } = renderHook(() => useIdleTimeout());
  expect(getMock).not.toHaveBeenCalled();
  await act(async () => {
    useAuthStore.setState({ isAuthenticated: true });
  });
  expect(getMock).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(logout).toHaveBeenCalledTimes(1);
  unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
