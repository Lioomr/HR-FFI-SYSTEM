import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  NotificationSocketManager,
  type WebSocketLike,
  type NotificationSocketOptions,
} from "./notificationSocket";
import type { NotificationDto } from "../api/notificationsApi";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  closed = false;
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // Test helpers
  emitOpen() {
    this.readyState = 1;
    this.onopen?.(null);
  }
  emitMessage(data: unknown) {
    this.onmessage?.({ data });
  }
  emitClose() {
    this.onclose?.(null);
  }
}

function notif(): NotificationDto {
  return {
    id: 42,
    title: "t",
    message: "m",
    event_key: "leave.approved",
    category: "leave",
    action_url: null,
    related_object_type: null,
    related_object_id: null,
    metadata: {},
    deduplication_key: "",
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
  };
}

let onCreated: ReturnType<typeof vi.fn>;
let onStatus: ReturnType<typeof vi.fn>;
let onPoll: ReturnType<typeof vi.fn>;

function makeManager(getUrl: () => string | null = () => "ws://x/ws/notifications/") {
  return new NotificationSocketManager({
    getUrl,
    onCreated: onCreated as unknown as NotificationSocketOptions["onCreated"],
    onStatus: onStatus as unknown as NotificationSocketOptions["onStatus"],
    onPoll: onPoll as unknown as NotificationSocketOptions["onPoll"],
    createSocket: (url) => new FakeSocket(url),
    pollIntervalMs: 5000,
    baseReconnectMs: 1000,
    maxReconnectMs: 8000,
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
  onCreated = vi.fn();
  onStatus = vi.fn();
  onPoll = vi.fn();
  vi.useFakeTimers();
  // Deterministic backoff.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("NotificationSocketManager", () => {
  it("opens a single connection and reports connected", () => {
    const m = makeManager();
    m.start();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(onStatus).toHaveBeenCalledWith("connecting");

    FakeSocket.instances[0].emitOpen();
    expect(onStatus).toHaveBeenCalledWith("connected");
    m.stop();
  });

  it("does not create duplicate sockets when started twice", () => {
    const m = makeManager();
    m.start();
    m.start();
    expect(FakeSocket.instances).toHaveLength(1);
    m.stop();
  });

  it("forwards valid notification.created frames", () => {
    const m = makeManager();
    m.start();
    FakeSocket.instances[0].emitOpen();
    FakeSocket.instances[0].emitMessage(
      JSON.stringify({ type: "notification.created", notification: notif(), unread_count: 4 })
    );
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      4
    );
    m.stop();
  });

  it("ignores malformed and irrelevant frames", () => {
    const m = makeManager();
    m.start();
    FakeSocket.instances[0].emitOpen();
    FakeSocket.instances[0].emitMessage("{not json");
    FakeSocket.instances[0].emitMessage(JSON.stringify({ type: "ping" }));
    FakeSocket.instances[0].emitMessage(
      JSON.stringify({ type: "notification.created" })
    );
    expect(onCreated).not.toHaveBeenCalled();
    m.stop();
  });

  it("reconnects with backoff and starts polling after an unexpected close", () => {
    const m = makeManager();
    m.start();
    FakeSocket.instances[0].emitOpen();
    onPoll.mockClear();

    FakeSocket.instances[0].emitClose();
    expect(onStatus).toHaveBeenCalledWith("reconnecting");
    expect(onPoll).toHaveBeenCalledTimes(1); // immediate poll on fallback

    // Backoff = base (jitter 0) => 1000ms.
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    m.stop();
  });

  it("keeps polling on the interval while disconnected", () => {
    const m = makeManager();
    m.start();
    FakeSocket.instances[0].emitOpen();
    onPoll.mockClear();

    FakeSocket.instances[0].emitClose(); // immediate poll (1)
    vi.advanceTimersByTime(5000); // interval poll (2)
    expect(onPoll).toHaveBeenCalledTimes(2);
    m.stop();
  });

  it("stops polling once the socket reconnects", () => {
    const m = makeManager();
    m.start();
    FakeSocket.instances[0].emitOpen();
    FakeSocket.instances[0].emitClose();
    vi.advanceTimersByTime(1000); // reconnect -> instance 2
    onPoll.mockClear();
    FakeSocket.instances[1].emitOpen(); // connected again -> polling stops
    vi.advanceTimersByTime(20000);
    expect(onPoll).not.toHaveBeenCalled();
    m.stop();
  });

  it("cleans up on stop with no further reconnects", () => {
    const m = makeManager();
    m.start();
    FakeSocket.instances[0].emitOpen();
    m.stop();
    expect(onStatus).toHaveBeenLastCalledWith("offline");
    expect(FakeSocket.instances[0].closed).toBe(true);

    vi.advanceTimersByTime(60000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("falls back to polling when no auth token is available", () => {
    const m = makeManager(() => null);
    m.start();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(onStatus).toHaveBeenCalledWith("reconnecting");
    expect(onPoll).toHaveBeenCalled();
    m.stop();
  });
});
