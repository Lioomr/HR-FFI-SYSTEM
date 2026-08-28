import { describe, it, expect } from "vitest";
import {
  normalizeNotificationPath,
  resolveSafeNotificationUrl,
} from "./notificationUrl";

// `window.location.origin` under jsdom — used to build a genuinely same-origin
// absolute URL so the test stays correct regardless of the configured host.
const ORIGIN = window.location.origin;

describe("resolveSafeNotificationUrl", () => {
  it("treats a relative application path as internal", () => {
    expect(resolveSafeNotificationUrl("/employee/leave/requests")).toEqual({
      allowed: true,
      kind: "internal",
      path: "/employee/leave/requests",
    });
  });

  it("keeps query strings and hashes on relative paths", () => {
    expect(resolveSafeNotificationUrl("/inbox?tab=unread#top")).toEqual({
      allowed: true,
      kind: "internal",
      path: "/inbox?tab=unread#top",
    });
  });

  it("allows a same-origin absolute URL, reduced to a router path", () => {
    const result = resolveSafeNotificationUrl(
      `${ORIGIN}/employee/leave/requests?x=1#h`,
    );
    expect(result).toEqual({
      allowed: true,
      kind: "internal",
      path: "/employee/leave/requests?x=1#h",
    });
  });

  it("blocks an external HTTPS URL", () => {
    expect(
      resolveSafeNotificationUrl("https://evil.example.com/steal"),
    ).toEqual({ allowed: false, kind: "blocked" });
  });

  it("blocks an external HTTP URL", () => {
    expect(resolveSafeNotificationUrl("http://attacker.test/phish")).toEqual({
      allowed: false,
      kind: "blocked",
    });
  });

  it("blocks a protocol-relative URL", () => {
    expect(resolveSafeNotificationUrl("//evil.example.com/x")).toEqual({
      allowed: false,
      kind: "blocked",
    });
  });

  it("blocks a javascript: URL", () => {
    expect(
      resolveSafeNotificationUrl("javascript:alert(document.cookie)"),
    ).toEqual({ allowed: false, kind: "blocked" });
  });

  it("blocks a data: URL", () => {
    expect(
      resolveSafeNotificationUrl("data:text/html,<script>alert(1)</script>"),
    ).toEqual({ allowed: false, kind: "blocked" });
  });

  it("blocks a blob: URL", () => {
    expect(resolveSafeNotificationUrl(`blob:${ORIGIN}/1234-5678`)).toEqual({
      allowed: false,
      kind: "blocked",
    });
  });

  it("blocks a malformed absolute URL", () => {
    expect(resolveSafeNotificationUrl("http://[not-a-real-url")).toEqual({
      allowed: false,
      kind: "blocked",
    });
  });

  it("treats an empty string as no link", () => {
    expect(resolveSafeNotificationUrl("")).toEqual({
      allowed: false,
      kind: "empty",
    });
  });

  it("treats whitespace-only input as no link", () => {
    expect(resolveSafeNotificationUrl("   ")).toEqual({
      allowed: false,
      kind: "empty",
    });
  });

  it("treats null / undefined as no link", () => {
    expect(resolveSafeNotificationUrl(null)).toEqual({
      allowed: false,
      kind: "empty",
    });
    expect(resolveSafeNotificationUrl(undefined)).toEqual({
      allowed: false,
      kind: "empty",
    });
  });

  it("is case-insensitive about the blocked scheme", () => {
    expect(resolveSafeNotificationUrl("JavaScript:alert(1)")).toEqual({
      allowed: false,
      kind: "blocked",
    });
  });
});

describe("legacy hiring-request links", () => {
  /**
   * The backend still emits `/hiring-requests/{id}` — the DRF path, not a
   * screen. It has to reach the compatibility route rather than 404 in the app
   * or 401 against the API.
   */
  it("keeps a legacy hiring-request link on the compatibility route", () => {
    expect(resolveSafeNotificationUrl("/hiring-requests/1")).toEqual({
      allowed: true,
      kind: "internal",
      path: "/hiring-requests/1",
    });
  });

  it("drops the API trailing slash", () => {
    expect(normalizeNotificationPath("/hiring-requests/12/")).toBe("/hiring-requests/12");
  });

  it("drops an API-only suffix so the browser never opens the endpoint", () => {
    expect(normalizeNotificationPath("/hiring-requests/12/cv/")).toBe("/hiring-requests/12");
  });

  it("preserves a query hint such as the CEO origin", () => {
    expect(normalizeNotificationPath("/hiring-requests/7?from=ceo")).toBe(
      "/hiring-requests/7?from=ceo",
    );
  });

  it("normalizes the same-origin absolute form too", () => {
    expect(resolveSafeNotificationUrl(`${ORIGIN}/hiring-requests/9/cv/`)).toEqual({
      allowed: true,
      kind: "internal",
      path: "/hiring-requests/9",
    });
  });

  it("still blocks a hiring-request link from another origin", () => {
    expect(resolveSafeNotificationUrl("https://evil.example.com/hiring-requests/1")).toEqual({
      allowed: false,
      kind: "blocked",
    });
  });

  it("leaves the already-correct screen paths alone", () => {
    expect(normalizeNotificationPath("/ceo/hiring-requests/1")).toBe("/ceo/hiring-requests/1");
    expect(normalizeNotificationPath("/hr/hiring-requests/1")).toBe("/hr/hiring-requests/1");
  });

  it("leaves unrelated paths alone", () => {
    expect(normalizeNotificationPath("/employee/leave/requests")).toBe(
      "/employee/leave/requests",
    );
  });
});
