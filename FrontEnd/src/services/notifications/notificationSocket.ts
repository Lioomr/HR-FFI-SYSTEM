import type { ConnectionStatus } from "../../stores/notificationStore";

export interface NotificationPollingOptions {
  onStatus: (status: ConnectionStatus) => void;
  onPoll: () => void | Promise<void>;
  pollIntervalMs?: number;
}

const DEFAULT_POLL_MS = 20000;

/**
 * REST polling is the approved notification transport while realtime is deferred.
 * This lifecycle manager deliberately has no URL, credential, or WebSocket dependency.
 */
export class NotificationPollingManager {
  private readonly opts: Required<NotificationPollingOptions>;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: NotificationPollingOptions) {
    this.opts = {
      pollIntervalMs: DEFAULT_POLL_MS,
      ...options,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.opts.onStatus("connecting");
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.opts.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.opts.onStatus("offline");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      await this.opts.onPoll();
      if (this.running) this.opts.onStatus("connected");
    } catch {
      if (this.running) this.opts.onStatus("reconnecting");
    }
  }
}
