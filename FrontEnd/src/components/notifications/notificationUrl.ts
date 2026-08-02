import { message } from "antd";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n";

/**
 * Result of validating a notification `action_url`.
 *
 * - `internal` — safe to hand to React Router (`navigate(path)`). Covers both
 *   relative application paths and same-origin absolute URLs (reduced to a path).
 * - `blocked`  — an external origin or an unsafe/unknown protocol
 *   (`javascript:`, `data:`, `blob:`, protocol-relative, malformed, …). Never
 *   navigate to these.
 * - `empty`    — no actionable link; do nothing (no warning).
 */
export interface SafeNotificationUrl {
  allowed: boolean;
  kind: "internal" | "blocked" | "empty";
  path?: string;
}

/** Matches a leading URL scheme, e.g. `https:`, `javascript:`, `data:`. */
const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Pure classifier for a notification action URL.
 *
 * Security rules:
 * - Relative application paths ("/employee/leave") stay internal — React Router
 *   can never leave the current origin, so they are always safe.
 * - Absolute URLs are internal only when their origin matches
 *   `window.location.origin`; they are then reduced to a path for the router.
 * - Any other origin, protocol-relative ("//host"), non-http(s) protocol
 *   (`javascript:`, `data:`, `blob:`, …), or malformed URL is blocked.
 * - Empty / whitespace / non-string input is treated as "no link".
 *
 * This function performs no navigation and has no side effects.
 */
export function resolveSafeNotificationUrl(
  url: string | null | undefined
): SafeNotificationUrl {
  if (typeof url !== "string") return { allowed: false, kind: "empty" };
  const trimmed = url.trim();
  if (!trimmed) return { allowed: false, kind: "empty" };

  // Protocol-relative ("//host/path") always resolves to an external origin.
  if (trimmed.startsWith("//")) return { allowed: false, kind: "blocked" };

  // No scheme -> a relative application path. React Router keeps it same-origin,
  // so it is inherently safe to navigate.
  if (!ABSOLUTE_SCHEME.test(trimmed)) {
    return { allowed: true, kind: "internal", path: trimmed };
  }

  // Has a scheme: it must be a well-formed http(s) URL on our own origin.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { allowed: false, kind: "blocked" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, kind: "blocked" };
  }

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  if (!origin || parsed.origin !== origin) {
    return { allowed: false, kind: "blocked" };
  }

  return {
    allowed: true,
    kind: "internal",
    path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
  };
}

/**
 * Shared safe-navigation handler for notification deep links. Both the header
 * bell and the inbox page use this so URL validation lives in exactly one place.
 *
 * Returns a stable callback that navigates to internal targets, shows a
 * translated warning for blocked (external / unsafe) links, and silently ignores
 * empty ones.
 */
export function useNotificationNavigate() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return useCallback(
    (url: string | null | undefined) => {
      const resolved = resolveSafeNotificationUrl(url);
      if (resolved.kind === "empty") return;
      if (!resolved.allowed || !resolved.path) {
        message.warning(
          t(
            "notifications.blockedLink",
            "This link was blocked for your security."
          )
        );
        return;
      }
      navigate(resolved.path);
    },
    [navigate, t]
  );
}
