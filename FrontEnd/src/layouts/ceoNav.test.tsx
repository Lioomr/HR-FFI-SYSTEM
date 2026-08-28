import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Menu } from "antd";
import type { MenuProps } from "antd";

import { buildCeoMenuItems, getCeoOpenKeysForPath } from "./ceoNav";
import { getSelectedKey } from "./menuUtils";
import { translations } from "../i18n/translations";

const t =
  (language: "en" | "ar") =>
  (
    key: string,
    params?: Record<string, unknown> | string,
    fallback?: string,
  ) => {
    const actualFallback = typeof params === "string" ? params : fallback;
    return translations[language]?.[key] ?? actualFallback ?? key;
  };

/** Flattens the menu tree into [key, ...] so structure is easy to assert on. */
function collectKeys(items: MenuProps["items"], out: string[] = []): string[] {
  items?.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const key = (item as { key?: unknown }).key;
    if (typeof key === "string") out.push(key);
    collectKeys((item as { children?: MenuProps["items"] }).children, out);
  });
  return out;
}

function groupTitles(items: MenuProps["items"]): string[] {
  const { container } = render(
    <MemoryRouter>
      <Menu mode="inline" items={items} />
    </MemoryRouter>,
  );
  // The group heading stacks a title over a caption; assert on the title line.
  return Array.from(
    container.querySelectorAll(".ant-menu-item-group-title"),
  ).map((node) => node.querySelector("span")?.textContent ?? "");
}

describe("CEO navigation", () => {
  it("groups entries into Overview, Approvals, Operations, Team & Communication and Profile", () => {
    expect(groupTitles(buildCeoMenuItems(t("en")))).toEqual([
      "Overview",
      "Approvals",
      "Operations",
      "Team & Communication",
      "Profile",
    ]);
  });

  it("uses Arabic group headings in Arabic", () => {
    expect(groupTitles(buildCeoMenuItems(t("ar")))).toEqual([
      "نظرة عامة",
      "الموافقات",
      "العمليات",
      "الفريق والتواصل",
      "الملف الشخصي",
    ]);
  });

  it("lists every CEO route exactly once", () => {
    const keys = collectKeys(buildCeoMenuItems(t("en"))).filter((key) =>
      key.startsWith("/"),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "/ceo/dashboard",
        "/ceo/leave/requests",
        "/ceo/loan-requests",
        "/ceo/attendance",
        "/ceo/assets/damage-reports",
        "/ceo/assets/return-requests",
        "/ceo/employees/deletion-requests",
        "/ceo/team",
        "/ceo/team-requests",
        "/ceo/announcements",
        "/ceo/announcements/create",
        "/ceo/profile",
      ]),
    );
  });

  it("drops the manager links that render the very same page as a CEO route", () => {
    const keys = collectKeys(buildCeoMenuItems(t("en")));
    expect(keys).not.toContain("/manager/team");
    expect(keys).not.toContain("/manager/team-requests");
  });

  it("keeps the manager queues that show different data, under distinct labels", () => {
    const items = buildCeoMenuItems(t("en"));
    expect(collectKeys(items)).toEqual(
      expect.arrayContaining(["/manager/dashboard", "/manager/loan-requests"]),
    );

    render(
      <MemoryRouter>
        <Menu mode="inline" items={items} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Team Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Team Loan Requests")).toBeInTheDocument();
    // ...and stay distinguishable from the CEO's own loan queue.
    expect(screen.getByText("Loan Requests")).toBeInTheDocument();
  });

  it.each([
    ["/ceo/dashboard", "/ceo/dashboard"],
    ["/ceo/leave/requests", "/ceo/leave/requests"],
    // Detail routes stay highlighted on their list entry.
    ["/ceo/loan-requests/17", "/ceo/loan-requests"],
    ["/ceo/employees/deletion-requests/3", "/ceo/employees/deletion-requests"],
    // The longer prefix wins, so team-requests never lights up "Leadership Team".
    ["/ceo/team-requests", "/ceo/team-requests"],
    ["/ceo/team", "/ceo/team"],
    ["/ceo/announcements", "/ceo/announcements"],
    ["/ceo/announcements/create", "/ceo/announcements/create"],
    ["/ceo/assets/return-requests", "/ceo/assets/return-requests"],
  ])("highlights %s as %s", (pathname, expected) => {
    expect(getSelectedKey(pathname, buildCeoMenuItems(t("en")))).toBe(expected);
  });

  it("opens the submenu that contains the current route", () => {
    expect(getCeoOpenKeysForPath("/ceo/assets/damage-reports")).toEqual([
      "ceo-assets-sub",
    ]);
    expect(getCeoOpenKeysForPath("/ceo/announcements/create")).toEqual([
      "ceo-announcements-sub",
    ]);
    expect(getCeoOpenKeysForPath("/ceo/dashboard")).toEqual([]);
  });
});
