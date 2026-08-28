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
 * `/hiring-requests/{id}` — and its API-shaped variants such as a trailing
 * slash or a `/cv/` suffix — as emitted by workflow deep links and hiring
 * request notifications.
 */
const LEGACY_HIRING_REQUEST = /^\/hiring-requests\/(\d+)(?:\/[^?#]*)?$/;

/**
 * Rewrites a legacy hiring-request link onto the compatibility route.
 *
 * The backend still sends `/hiring-requests/{id}`, which is the DRF endpoint
 * path and not a screen: followed as-is it 404s in the app, and hitting the API
 * directly from the browser 401s because there is no bearer header on a plain
 * navigation. `/hiring-requests/:id` is a real route that forwards to the CEO
 * or HR screen, so pointing at it keeps those links working. Any trailing API
 * segment (`/cv/`) is dropped for the same reason.
 */
export function normalizeNotificationPath(path: string): string {
  const [pathname, rest = ""] = splitPath(path);
  const match = LEGACY_HIRING_REQUEST.exec(pathname);
  if (!match) return path;
  return `/hiring-requests/${match[1]}${rest}`;
}

/** Splits a path into its pathname and its `?query#hash` remainder. */
function splitPath(path: string): [string, string] {
  const cut = path.search(/[?#]/);
  return cut === -1 ? [path, ""] : [path.slice(0, cut), path.slice(cut)];
}

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
  url: string | null | undefined,
): SafeNotificationUrl {
  if (typeof url !== "string") return { allowed: false, kind: "empty" };
  const trimmed = url.trim();
  if (!trimmed) return { allowed: false, kind: "empty" };

  // Protocol-relative ("//host/path") always resolves to an external origin.
  if (trimmed.startsWith("//")) return { allowed: false, kind: "blocked" };

  // No scheme -> a relative application path. React Router keeps it same-origin,
  // so it is inherently safe to navigate.
  if (!ABSOLUTE_SCHEME.test(trimmed)) {
    return {
      allowed: true,
      kind: "internal",
      path: normalizeNotificationPath(trimmed),
    };
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

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!origin || parsed.origin !== origin) {
    return { allowed: false, kind: "blocked" };
  }

  return {
    allowed: true,
    kind: "internal",
    path: normalizeNotificationPath(
      `${parsed.pathname}${parsed.search}${parsed.hash}`,
    ),
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
            "This link was blocked for your security.",
          ),
        );
        return;
      }
      navigate(resolved.path);
    },
    [navigate, t],
  );
}
