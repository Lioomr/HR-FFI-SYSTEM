import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
} from "../../services/api/notificationsApi";

type TFn = (key: string, fallback?: string) => string;

/** Status → accent color, shared by chips and (indirectly) details. */
export const DELIVERY_STATUS_COLOR: Record<NotificationDeliveryStatus, string> =
  {
    sent: "#16a34a",
    failed: "#dc2626",
    pending: "#d97706",
    skipped: "#94a3b8",
  };

const KNOWN_STATUSES: NotificationDeliveryStatus[] = [
  "sent",
  "failed",
  "pending",
  "skipped",
];
const KNOWN_CHANNELS: NotificationDeliveryChannel[] = ["whatsapp", "email"];

/**
 * Human label for a channel+status pair, e.g. "WhatsApp failed" /
 * "Email fallback sent". Falls back gracefully for unknown values.
 */
export function deliveryLabel(t: TFn, channel: string, status: string): string {
  const ch = (KNOWN_CHANNELS as string[]).includes(channel)
    ? channel
    : "whatsapp";
  const st = (KNOWN_STATUSES as string[]).includes(status) ? status : "pending";
  const defaults: Record<string, string> = {
    "whatsapp.sent": "WhatsApp sent",
    "whatsapp.failed": "WhatsApp failed",
    "whatsapp.pending": "WhatsApp pending",
    "whatsapp.skipped": "WhatsApp skipped",
    "email.sent": "Email fallback sent",
    "email.failed": "Email fallback failed",
    "email.pending": "Email fallback pending",
    "email.skipped": "Email fallback skipped",
  };
  return t(`notifications.delivery.${ch}.${st}`, defaults[`${ch}.${st}`]);
}

/** Safe, non-sensitive hint per status (never the raw provider error). */
export function deliveryHint(t: TFn, status: string): string {
  switch (status) {
    case "sent":
      return t("notifications.delivery.sentHint", "Delivered successfully.");
    case "failed":
      return t(
        "notifications.delivery.failedSafe",
        "This channel couldn't be delivered.",
      );
    case "pending":
      return t("notifications.delivery.pendingHint", "Delivery in progress.");
    case "skipped":
    default:
      return t(
        "notifications.delivery.skippedHint",
        "This channel was not used.",
      );
  }
}

/** Defensive ordering: WhatsApp first, then email, then anything else. */
export function orderDeliveries(
  deliveries: NotificationDelivery[] | undefined,
): NotificationDelivery[] {
  if (!Array.isArray(deliveries) || deliveries.length === 0) return [];
  const rank = (c: string) => (c === "whatsapp" ? 0 : c === "email" ? 1 : 2);
  return [...deliveries].sort((a, b) => rank(a.channel) - rank(b.channel));
}

/** One-line summary for a row's accessible name, WhatsApp first. */
export function summarizeDeliveries(
  t: TFn,
  deliveries: NotificationDelivery[] | undefined,
): string {
  const list = orderDeliveries(deliveries);
  if (list.length === 0) return "";
  const parts = list.map((d) => deliveryLabel(t, d.channel, d.status));
  return `${t("notifications.delivery.statusLabel", "Delivery status")}: ${parts.join(
    ", ",
  )}.`;
}

/** Roles allowed to inspect the (already redacted) technical delivery details. */
export function canViewDeliveryTechnicalDetails(role?: string): boolean {
  return role === "SystemAdmin" || role === "HRManager";
}
