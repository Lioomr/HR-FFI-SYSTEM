import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotificationPollingManager,
  type NotificationPollingOptions,
} from "./notificationSocket";

let onStatus: ReturnType<typeof vi.fn>;
let onPoll: ReturnType<typeof vi.fn>;

function makeManager(): NotificationPollingManager {
  return new NotificationPollingManager({
    onStatus: onStatus as unknown as NotificationPollingOptions["onStatus"],
    onPoll: onPoll as unknown as NotificationPollingOptions["onPoll"],
    pollIntervalMs: 5000,
  });
}

beforeEach(() => {
  onStatus = vi.fn();
  onPoll = vi.fn();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotificationPollingManager", () => {
  it("polls REST immediately and at the configured interval", () => {
    const manager = makeManager();

    manager.start();

    expect(onStatus).toHaveBeenCalledWith("connecting");
    expect(onPoll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(onPoll).toHaveBeenCalledTimes(3);
    manager.stop();
  });

  it("reports connected after a successful poll", async () => {
    const manager = makeManager();

    manager.start();
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("connected"));
    manager.stop();
  });

  it("does not create duplicate polling intervals when started twice", () => {
    const manager = makeManager();

    manager.start();
    manager.start();
    vi.advanceTimersByTime(5000);

    expect(onPoll).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it("stops polling on logout or company-scope cleanup", () => {
    const manager = makeManager();
    manager.start();
    onPoll.mockClear();

    manager.stop();
    vi.advanceTimersByTime(60000);

    expect(manager.isRunning()).toBe(false);
    expect(onPoll).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith("offline");
  });

  it("continues polling after a non-fatal callback error", async () => {
    onPoll.mockImplementationOnce(() => {
      throw new Error("temporary REST failure");
    });
    const manager = makeManager();

    expect(() => manager.start()).not.toThrow();
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("reconnecting"));
    vi.advanceTimersByTime(5000);

    expect(onPoll).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it("has no URL, credential, or WebSocket construction option", () => {
    const manager = makeManager() as unknown as Record<string, unknown>;

    expect(manager).not.toHaveProperty("socket");
    expect(manager).not.toHaveProperty("getUrl");
    expect(manager).not.toHaveProperty("createSocket");
  });
});
